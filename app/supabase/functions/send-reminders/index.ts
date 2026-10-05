// Push reminders ~24 hours before each lesson, to the tutor and the family.
// Optional secret: CRON_SECRET (then each scheduled call must send it in the x-cron-secret header).
// Schedule hourly (Supabase → Integrations → Cron, or the pg_cron SQL in the README's Round 4 setup checklist).
// It also queues WhatsApp reminders (lessons, overdue invoices, homework due) for people who opted in;
// send-notifications delivers those within a minute. The database holds them back overnight (quiet hours, UAE time).
// Admissions advisory reminders (key dates and tasks) are queued as push and email notifications, 08:00–20:59 UAE time.
import { adminClient } from '../_shared/supabase.ts';
import { isAuthorisedCronCall, refuseCronCall } from '../_shared/cron.ts';

Deno.serve(async (req) => {
  if (!isAuthorisedCronCall(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) return refuseCronCall();
  const db = adminClient();
  const { data: queued, error: queueError } = await db.rpc('queue_whatsapp_reminders');
  if (queueError) console.error('queue_whatsapp_reminders failed', queueError.message);
  const { data: admissionsQueued, error: admissionsError } = await db.rpc('queue_admissions_reminders');
  if (admissionsError) console.error('queue_admissions_reminders failed', admissionsError.message);
  const whatsapp =
    `queued ${typeof queued === 'number' ? queued : 0} WhatsApp messages` +
    ` and ${typeof admissionsQueued === 'number' ? admissionsQueued : 0} admissions reminders`;
  const now = Date.now();
  const { data: lessons } = await db
    .from('lessons')
    .select('*') // includes subject
    .eq('status', 'scheduled')
    .is('reminded_at', null)
    .gte('start_at', new Date(now + 23 * 3_600_000).toISOString())
    .lte('start_at', new Date(now + 25 * 3_600_000).toISOString());
  if (!lessons?.length) return new Response(`no pushes to send, ${whatsapp}`);

  const { data: students } = await db.from('students').select('id, full_name, family_id');
  const { data: profiles } = await db.from('profiles').select('role, tutor_id, family_id, student_id, push_token').not('push_token', 'is', null);
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });

  const messages = [];
  for (const l of lessons) {
    const subject = (l.subject as string | null)?.trim() || null;
    const kids = (students ?? []).filter((s) => (l.student_ids as string[]).includes(s.id));
    const names = kids.map((k) => k.full_name.split(' ')[0]).join(' & ');
    const families = new Set(kids.map((k) => k.family_id));
    for (const p of profiles ?? []) {
      const relevant =
        (p.role === 'tutor' && p.tutor_id === l.tutor_id) ||
        (p.role === 'parent' && families.has(p.family_id)) ||
        (p.role === 'student' && (l.student_ids as string[]).includes(p.student_id));
      if (!relevant) continue;
      messages.push({
        to: p.push_token,
        title: 'Lesson tomorrow',
        body: p.role === 'tutor' ? `${subject ? `${subject} with ` : ''}${names} at ${time(l.start_at)}` : `${subject ?? 'Your lesson'} with Elite Education at ${time(l.start_at)}`,
        data: { url: `/lesson/${l.id}` },
      });
    }
  }
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
  await db.from('lessons').update({ reminded_at: new Date().toISOString() }).in('id', lessons.map((l) => l.id));
  return new Response(`sent ${messages.length} pushes, ${whatsapp}`);
});
