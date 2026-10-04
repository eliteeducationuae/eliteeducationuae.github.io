// Personal calendar feed: GET /functions/v1/ics?token=<profiles.ics_token>
// Subscribed to from Apple/Google Calendar, so it authenticates by the secret token, not a session.
// Deploy with --no-verify-jwt. Each event is titled with the lesson's subject (lessons.subject), e.g. 'Chemistry: Zara'.
import { adminClient } from '../_shared/supabase.ts';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

Deno.serve(async (req) => {
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
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
});
