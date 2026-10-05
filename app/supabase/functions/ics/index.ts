// Personal calendar feed: GET /functions/v1/ics?token=<profiles.ics_token>
// Subscribed to from Apple/Google Calendar, so it authenticates by the secret token, not a session.
// Deploy with --no-verify-jwt. Each event is titled with the lesson's subject (lessons.subject), e.g. 'Chemistry: Zara'.
// Open admissions key dates appear too, as all-day events (or 30-minute events when a UAE time is set):
// parents see their children's cases, students their own, tutors the cases they advise and admins every case.
// Each is titled with the student's first name, e.g. 'Admissions · Omar: Oxford interview (University of Oxford)'.
import { adminClient } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = (date: string) => date.replace(/-/g, '');
const nextDay = (date: string) => day(new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));

type AdmissionsDate = {
  id: string;
  title: string;
  due_on: string;
  time_of_day: string | null;
  admissions_targets: { institution: string } | null;
  admissions_cases: { student_id: string; family_id: string; adviser_tutor_id: string | null; status: string } | null;
};

Deno.serve(withMonitoring('ics', adminClient, async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return new Response('Not found', { status: 404 });
  const db = adminClient();
  const { data: me } = await db.from('profiles').select('*').eq('ics_token', token).maybeSingle();
  if (!me) return new Response('Not found', { status: 404 });

  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 180 * 86_400_000).toISOString();
  let query = db.from('lessons').select('*').gte('start_at', from).lte('start_at', to).in('status', ['scheduled', 'completed']);
  if (me.role === 'tutor') query = query.eq('tutor_id', me.tutor_id);
  if (me.role === 'student') query = query.contains('student_ids', [me.student_id]);
  if (me.role === 'parent') {
    const { data: kids } = await db.from('students').select('id').eq('family_id', me.family_id);
    query = query.overlaps('student_ids', (kids ?? []).map((k) => k.id));
  }
  const { data: lessons } = await query;
  const [{ data: students }, { data: tutors }, { data: services }] = await Promise.all([
    db.from('students').select('id, full_name'),
    db.from('tutors').select('id, full_name'),
    db.from('services').select('id, name'),
  ]);
  const name = (list: { id: string; full_name?: string; name?: string }[] | null, id: string) =>
    list?.find((x) => x.id === id)?.full_name ?? list?.find((x) => x.id === id)?.name ?? '';

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Elite Education//Tutoring//EN', 'X-WR-CALNAME:Elite Education', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const l of lessons ?? []) {
    const who = (l.student_ids as string[]).map((id) => name(students, id).split(' ')[0]).join(' & ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${l.id}@eliteeducation`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(l.start_at)}`,
      `DTEND:${stamp(l.end_at)}`,
      `SUMMARY:${esc(`${(l.subject as string | null)?.trim() || 'Lesson'}: ${who}`)}`,
      `DESCRIPTION:${esc(`${name(services, l.service_id)} with ${name(tutors, l.tutor_id)}`)}`,
    );
    const where = l.location === 'online' ? l.meeting_url : l.address;
    if (where) lines.push(`LOCATION:${esc(where)}`);
    lines.push('END:VEVENT');
  }

  // Admissions key dates (not done) on active or paused cases, in the same window.
  // Filtered to the viewer's cases in the query itself, so only their own key dates are ever loaded.
  let dateQuery = db
    .from('admissions_dates')
    .select('id, title, due_on, time_of_day, admissions_targets(institution), admissions_cases!inner(student_id, family_id, adviser_tutor_id, status)')
    .eq('done', false)
    .in('admissions_cases.status', ['active', 'on-hold'])
    .gte('due_on', from.slice(0, 10))
    .lte('due_on', to.slice(0, 10));
  const scope: Record<string, [string, unknown]> = {
    tutor: ['admissions_cases.adviser_tutor_id', me.tutor_id],
    parent: ['admissions_cases.family_id', me.family_id],
    student: ['admissions_cases.student_id', me.student_id],
  };
  if (me.role !== 'admin') {
    const [column, value] = scope[me.role] ?? ['admissions_cases.family_id', null];
    // A profile without a link sees no key dates: match an id that cannot exist.
    dateQuery = dateQuery.eq(column, value ?? '00000000-0000-0000-0000-000000000000');
  }
  const { data: keyDates } = await dateQuery;
  for (const d of (keyDates ?? []) as unknown as AdmissionsDate[]) {
    const c = d.admissions_cases;
    if (!c || (c.status !== 'active' && c.status !== 'on-hold')) continue;
    const mine =
      me.role === 'admin' ||
      (me.role === 'tutor' && !!me.tutor_id && c.adviser_tutor_id === me.tutor_id) ||
      (me.role === 'parent' && !!me.family_id && c.family_id === me.family_id) ||
      (me.role === 'student' && !!me.student_id && c.student_id === me.student_id);
    if (!mine) continue;
    const institution = d.admissions_targets?.institution;
    lines.push('BEGIN:VEVENT', `UID:${d.id}@eliteeducation-admissions`, `DTSTAMP:${stamp(new Date().toISOString())}`);
    if (d.time_of_day) {
      // UAE time (UTC+4, no daylight saving).
      const start = new Date(`${d.due_on}T${d.time_of_day}:00+04:00`).toISOString();
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(Date.parse(start) + 30 * 60_000).toISOString())}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(d.due_on)}`, `DTEND;VALUE=DATE:${nextDay(d.due_on)}`);
    }
    const student = name(students, c.student_id).split(' ')[0];
    lines.push(
      `SUMMARY:${esc(`Admissions${student ? ` · ${student}` : ''}: ${d.title}${institution ? ` (${institution})` : ''}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}));
