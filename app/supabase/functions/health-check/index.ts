// Watches the background services and emails the office when something stops working.
// Schedule every 15 minutes (Supabase → Edge Functions → Schedules) with Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
// Reads public.system_health_report(), purges error reports older than 90 days, and emails HEALTH_ALERT_EMAIL (or every
// administrator when it is not set) when a problem starts, again every 6 hours while it continues, and once when all is
// clear (shouldAlert in _shared/monitoring.ts). Alerts hold counts only, never personal details.
// Returns { status, alerted }.
// Secrets: RESEND_API_KEY, EMAIL_FROM, APP_URL (default https://eliteeducation.me), HEALTH_ALERT_EMAIL (optional).
import { adminClient, json } from '../_shared/supabase.ts';
import { healthEmail, recordRun, shouldAlert, withMonitoring, type HealthReport, type MonitorDb } from '../_shared/monitoring.ts';

const NAME = 'health-check';

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(withMonitoring(NAME, adminClient, async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) {
    return json({ error: 'Only the schedule can run the health check.' }, 403);
  }
  const db = adminClient();

  const { data, error } = await db.rpc('system_health_report');
  if (error || !data) throw new Error(`system_health_report failed: ${error?.message ?? 'no report'}`);
  const report = data as HealthReport;

  const { error: purgeError } = await db.rpc('purge_old_errors');
  if (purgeError) console.error('purge_old_errors failed', purgeError.message);

  const { data: run } = await db.from('function_runs').select('last_alert_at, last_alert_key').eq('function_name', NAME).maybeSingle();
  const now = new Date();
  const decision = shouldAlert({ previousKey: run?.last_alert_key, lastAlertAt: run?.last_alert_at, report, now });
  if (!decision.alert) return json({ status: report.status, alerted: false });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM') ?? 'Elite Education <hello@eliteeducation.me>';
  const appUrl = Deno.env.get('APP_URL') ?? 'https://eliteeducation.me';
  let to = (Deno.env.get('HEALTH_ALERT_EMAIL') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) {
    const { data: admins } = await db.from('profiles').select('email').eq('role', 'admin');
    to = (admins ?? []).map((a) => a.email as string).filter(Boolean);
  }
  if (!resendKey) throw new Error('RESEND_API_KEY is not set, so the health alert could not be sent.');
  if (!to.length) throw new Error('No HEALTH_ALERT_EMAIL or administrator email to send the health alert to.');

  const email = healthEmail(report, appUrl);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: email.subject, text: email.text, html: email.html }),
  });
  if (!res.ok) throw new Error(`Sending the health alert failed (email ${res.status}).`);

  await recordRun(db as unknown as MonitorDb, NAME, { last_alert_at: now.toISOString(), last_alert_key: decision.key });
  return json({ status: report.status, alerted: true });
}));
