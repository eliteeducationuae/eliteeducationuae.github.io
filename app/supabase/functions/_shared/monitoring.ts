// Monitoring for the Edge Functions: scrubbing, health alerts, backup naming and the withMonitoring wrapper.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and tested with Jest
// (src/lib/__tests__/monitoring-shared.test.ts). The database client is passed in by each function.
//
// Never log request bodies, card details, bank details, email addresses or phone numbers here: every message is
// passed through scrubText() before it is stored.

// ---------------------------------------------------------------------------
// Scrubbing (the same rules as public.scrub_error_text in the launch migration)
// ---------------------------------------------------------------------------

/** Removes email addresses, phone-like numbers (7 or more digits), login tokens and other long codes. */
export function scrubText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,2}/g, '[token]')
    .replace(/[0-9a-fA-F]{32,}/g, '[token]')
    .replace(/(?=[A-Za-z+_=-]*[0-9])[A-Za-z0-9+_=-]{32,}/g, '[token]')
    .replace(/\+?[0-9](?:[ -]?[0-9]){6,}/g, '[number]');
}

/** A readable message from anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e) ?? 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

// ---------------------------------------------------------------------------
// System health (the shape returned by public.system_health_report())
// ---------------------------------------------------------------------------

export type HealthStatus = 'ok' | 'warning' | 'failing';
export type HealthCheck = { key: string; label: string; status: HealthStatus; detail: string; count: number };
export type HealthJob = {
  name: string;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
};
export type HealthReport = {
  checkedAt: string;
  status: HealthStatus;
  checks: HealthCheck[];
  jobs: HealthJob[];
  database: {
    latest: string | null;
    latestName: string | null;
    count: number;
    migrations: { version: string; name: string | null; appliedAt: string | null }[];
  };
};

/** Hours between reminders while the same problem continues. */
export const ALERT_REPEAT_HOURS = 6;

/** A stable key for the problems in a report, e.g. 'calendar:failing,notifications:warning'; '' when all is well. */
export function healthAlertKey(report: Pick<HealthReport, 'checks'>): string {
  return report.checks
    .filter((c) => c.status !== 'ok')
    .map((c) => `${c.key}:${c.status}`)
    .sort()
    .join(',');
}

export type AlertDecision = { alert: boolean; kind: 'problem' | 'recovery' | null; key: string };

/**
 * Whether health-check should email the office. A new or changed problem alerts at once; the same problem again after
 * ALERT_REPEAT_HOURS; and one 'all clear' is sent when everything returns to ok after an alert. The caller stores
 * `key` as the new last_alert_key whenever `alert` is true ('' after an all clear, so it is sent once).
 */
export function shouldAlert(args: {
  previousKey: string | null | undefined;
  lastAlertAt: string | Date | null | undefined;
  report: Pick<HealthReport, 'status' | 'checks'>;
  now: Date;
}): AlertDecision {
  const key = healthAlertKey(args.report);
  const previous = args.previousKey ?? '';
  if (args.report.status === 'ok' || key === '') {
    return previous ? { alert: true, kind: 'recovery', key: '' } : { alert: false, kind: null, key: '' };
  }
  if (key !== previous) return { alert: true, kind: 'problem', key };
  const last = args.lastAlertAt ? new Date(args.lastAlertAt).getTime() : NaN;
  if (Number.isNaN(last) || args.now.getTime() - last >= ALERT_REPEAT_HOURS * 3_600_000) {
    return { alert: true, kind: 'problem', key };
  }
  return { alert: false, kind: null, key };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The System health page in the app. */
export function systemHealthUrl(appUrl: string) {
  return `${appUrl.replace(/\/+$/, '')}/app/manage/system-health`;
}

/**
 * The alert email. Counts and check names only: never names, contact details or message contents (details are
 * scrubbed again here as a precaution).
 */
export function healthEmail(report: Pick<HealthReport, 'status' | 'checks' | 'checkedAt'>, appUrl: string) {
  const link = systemHealthUrl(appUrl);
  const problems = report.checks.filter((c) => c.status !== 'ok');
  const allClear = report.status === 'ok' || problems.length === 0;
  const subject = allClear
    ? 'Elite Education: all systems are working normally again'
    : report.status === 'failing'
      ? 'Elite Education: action needed on system health'
      : 'Elite Education: system health needs attention';
  const intro = allClear
    ? 'Every background service is working normally again. No action is needed.'
    : report.status === 'failing'
      ? 'One or more background services are not working. Families and tutors may be affected until this is resolved.'
      : 'One or more background services need attention. Nothing has stopped yet, but please take a look.';
  const lines = problems.map((c) => `${c.label} (${c.status === 'failing' ? 'not working' : 'needs attention'}): ${scrubText(c.detail)}`);
  const text = [
    'Good day,',
    '',
    intro,
    ...(lines.length ? ['', ...lines.map((l) => `- ${l}`)] : []),
    '',
    `Open System health: ${link}`,
    '',
    'Elite Education | eliteeducation.me',
  ].join('\n');

  const serif = "Georgia,'Times New Roman',serif";
  const sans = "Calibri,Carlito,'Segoe UI',Arial,sans-serif";
  const rows = problems
    .map(
      (c) => `<tr>
        <td style="padding:10px 12px;border-top:1px solid #E5E0D4;font-weight:700;color:#0A0A0A;vertical-align:top">${esc(c.label)}</td>
        <td style="padding:10px 12px;border-top:1px solid #E5E0D4;color:#0A0A0A;vertical-align:top">
          <span style="text-transform:uppercase;letter-spacing:1px;font-size:11px;color:#6B6B6B">${c.status === 'failing' ? 'Not working' : 'Needs attention'}</span><br>${esc(scrubText(c.detail))}
        </td>
      </tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#F9F8F5;font-family:${sans};color:#0A0A0A">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#0A0A0A;color:#FFFFFF;padding:20px 24px;border-bottom:2px solid #C9A84C;font-family:${serif};font-size:20px;letter-spacing:0.5px">Elite Education</div>
    <div style="background:#FFFFFF;border:1px solid #E5E0D4;border-top:0;padding:24px;font-size:15px;line-height:1.6">
      <h2 style="margin:0 0 16px;font-family:${serif};font-weight:700;font-size:19px;color:#0A0A0A">${esc(allClear ? 'All systems are working normally' : 'System health')}</h2>
      <p style="margin:0 0 14px">Good day,</p>
      <p style="margin:0 0 14px">${esc(intro)}</p>
      ${rows ? `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 14px">${rows}</table>` : ''}
      <p style="margin:20px 0 0"><a href="${esc(link)}" style="background:#0A0A0A;color:#FFFFFF;border:1px solid #C9A84C;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:700">Open System health</a></p>
    </div>
    <p style="color:#6B6B6B;font-size:12px;text-align:center;letter-spacing:0.5px">Elite Education | eliteeducation.me</p>
  </div></body></html>`;
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/** UAE time (UTC+4, no daylight saving): backups are named after the UAE calendar day. */
const UAE_OFFSET_MS = 4 * 3_600_000;

function uaeDay(date: Date) {
  return new Date(date.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);
}

/** The folder for one night's backup in the 'backups' bucket, e.g. '2026-10-05/'. */
export function backupPrefix(date: Date): string {
  return `${uaeDay(date)}/`;
}

/** Backup folders (as listed, with or without the trailing slash) older than keepDays, to be deleted. */
export function expiredBackupPrefixes(prefixes: string[], now: Date, keepDays = 35): string[] {
  const cutoff = uaeDay(new Date(now.getTime() - keepDays * 86_400_000));
  return prefixes.filter((p) => {
    const m = /^(\d{4}-\d{2}-\d{2})\/?$/.exec(p);
    return !!m && m[1] < cutoff;
  });
}

/**
 * Tables copied by backup-export each night, with the columns to read and a key to page by. Tables missing from the
 * database are skipped. Never calendar tokens, OAuth states, tutor bank details, autopay requests or push tokens.
 */
export const BACKUP_TABLES: readonly { table: string; columns: string; orderBy: string }[] = [
  { table: 'settings', columns: '*', orderBy: 'id' },
  { table: 'db_migrations', columns: '*', orderBy: 'version' },
  { table: 'families', columns: '*', orderBy: 'id' },
  { table: 'students', columns: '*', orderBy: 'id' },
  { table: 'student_notes', columns: '*', orderBy: 'student_id' },
  { table: 'profiles', columns: 'id, role, full_name, email, phone, tutor_id, family_id, student_id', orderBy: 'id' },
  { table: 'tutors', columns: '*', orderBy: 'id' },
  { table: 'services', columns: '*', orderBy: 'id' },
  { table: 'lessons', columns: '*', orderBy: 'id' },
  { table: 'lesson_notes', columns: '*', orderBy: 'lesson_id' },
  { table: 'homework', columns: '*', orderBy: 'id' },
  { table: 'enrolments', columns: '*', orderBy: 'id' },
  { table: 'packages', columns: '*', orderBy: 'id' },
  { table: 'invoices', columns: '*', orderBy: 'id' },
  { table: 'charges', columns: '*', orderBy: 'id' },
  { table: 'payments', columns: '*', orderBy: 'id' },
  { table: 'tutor_invoices', columns: '*', orderBy: 'id' },
  { table: 'expenses', columns: '*', orderBy: 'id' },
  { table: 'student_reports', columns: '*', orderBy: 'id' },
  { table: 'report_cycles', columns: '*', orderBy: 'id' },
];

// ---------------------------------------------------------------------------
// Recording runs and errors (needs a service-role client)
// ---------------------------------------------------------------------------

type DbResult = PromiseLike<{ error: { message: string } | null }>;
/** The part of the Supabase client used here. */
export interface MonitorDb {
  from(table: string): {
    upsert(values: Record<string, unknown>, options?: { onConflict?: string }): DbResult;
    insert(values: Record<string, unknown>): DbResult;
  };
}

/** Shown to the caller when a function fails unexpectedly; the detail is in function_errors. */
export const GENERIC_ERROR = 'Something went wrong. Please try again shortly.';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Updates this function's row in function_runs. Never throws. */
export async function recordRun(
  db: MonitorDb | null,
  name: string,
  patch: Partial<Record<'last_started_at' | 'last_succeeded_at' | 'last_failed_at' | 'last_error' | 'last_alert_at' | 'last_alert_key', string | null>>,
) {
  if (!db) return;
  try {
    await db.from('function_runs').upsert({ function_name: name, ...patch }, { onConflict: 'function_name' });
  } catch {
    // Monitoring must never break the function it watches.
  }
}

/** Adds a row to function_errors, scrubbed of personal details. Never throws. */
export async function logFunctionError(
  db: MonitorDb | null,
  name: string,
  message: string,
  status: number | null = 500,
  context: Record<string, string | number | boolean | null> = {},
) {
  if (!db) return;
  try {
    const safeContext: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(context)) safeContext[k] = typeof v === 'string' ? scrubText(v).slice(0, 200) : v;
    await db.from('function_errors').insert({
      function_name: name,
      message: scrubText(message).slice(0, 1000) || 'Unknown error',
      status,
      context: safeContext,
    });
  } catch {
    // Monitoring must never break the function it watches.
  }
}

/** The error text of a failed response, without consuming the original body. */
async function responseError(res: Response): Promise<string> {
  try {
    const text = await res.clone().text();
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const msg = body?.error ?? body?.message;
      if (typeof msg === 'string' && msg) return msg;
    } catch {
      // not JSON
    }
    return text || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Wraps an Edge Function handler: records when it started, succeeded or failed (function_runs), logs failures to
 * function_errors, and turns an unexpected exception into a 500 with a courteous message. Pre-flight (OPTIONS)
 * requests are passed straight through. Usage: Deno.serve(withMonitoring('send-reminders', adminClient, async (req) => ...)).
 */
export function withMonitoring(
  name: string,
  makeDb: () => unknown,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return handler(req);
    let db: MonitorDb | null = null;
    try {
      db = makeDb() as MonitorDb;
    } catch {
      db = null;
    }
    await recordRun(db, name, { last_started_at: new Date().toISOString() });
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      const message = scrubText(errorMessage(e)).slice(0, 1000);
      await logFunctionError(db, name, message, 500);
      await recordRun(db, name, { last_failed_at: new Date().toISOString(), last_error: message.slice(0, 500) });
      return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (res.status >= 500) {
      const message = scrubText(await responseError(res)).slice(0, 1000);
      await logFunctionError(db, name, message, res.status);
      await recordRun(db, name, { last_failed_at: new Date().toISOString(), last_error: message.slice(0, 500) });
    } else {
      await recordRun(db, name, { last_succeeded_at: new Date().toISOString() });
    }
    return res;
  };
}
