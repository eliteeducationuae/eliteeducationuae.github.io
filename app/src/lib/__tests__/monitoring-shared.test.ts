import {
  BACKUP_TABLES,
  backupPrefix,
  errorMessage,
  expiredBackupPrefixes,
  GENERIC_ERROR,
  healthAlertKey,
  healthEmail,
  scrubText,
  shouldAlert,
  withMonitoring,
  type HealthCheck,
  type HealthReport,
  type HealthStatus,
} from '../../../supabase/functions/_shared/monitoring';

const ok = (key: string): HealthCheck => ({ key, label: key, status: 'ok', detail: 'Fine.', count: 0 });

function report(problems: Partial<Record<string, HealthStatus>> = {}, detail = 'Something needs a look.'): HealthReport {
  const keys = ['notifications', 'whatsapp', 'calendar', 'autopay', 'stripe', 'server-errors', 'app-errors', 'backups'];
  const checks = keys.map((key) => (problems[key] ? { ...ok(key), label: `Label ${key}`, status: problems[key]!, detail, count: 3 } : ok(key)));
  const status: HealthStatus = checks.some((c) => c.status === 'failing')
    ? 'failing'
    : checks.some((c) => c.status === 'warning')
      ? 'warning'
      : 'ok';
  return {
    checkedAt: '2026-10-04T10:00:00Z',
    status,
    checks,
    jobs: [],
    database: { latest: '20261020000000', latestName: 'launch', count: 13, migrations: [] },
  };
}

describe('scrubText', () => {
  it('removes email addresses, phone numbers and tokens', () => {
    expect(scrubText('Could not save for mona.ahmed@example.co.uk, phone +971 50 123 4567')).toBe('Could not save for [email], phone [number]');
    expect(scrubText('call 0501234567 or +44-20-7946-0958')).toBe('call [number] or [number]');
    expect(scrubText('auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl failed')).toBe('auth [token] failed');
    expect(scrubText('key 3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d end')).toBe('key [token] end');
    expect(scrubText('id 9b1c6c0e-1111-4c2a-9d7e-2f3a4b5c6d7e')).toBe('id [token]');
  });

  it('keeps ordinary text, short numbers and long words', () => {
    expect(scrubText('Lesson 12 at 16:30 failed with status 500')).toBe('Lesson 12 at 16:30 failed with status 500');
    expect(scrubText('useSomeVeryLongHookNameThatHasNoDigitsInIt broke')).toBe('useSomeVeryLongHookNameThatHasNoDigitsInIt broke');
    expect(scrubText(null)).toBe('');
  });
});

describe('errorMessage', () => {
  it('reads errors, strings and objects', () => {
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
    expect(errorMessage('Plain')).toBe('Plain');
    expect(errorMessage({ message: 'From PostgREST' })).toBe('From PostgREST');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });
});

describe('shouldAlert', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('stays quiet while everything is ok', () => {
    expect(shouldAlert({ previousKey: null, lastAlertAt: null, report: report(), now })).toEqual({ alert: false, kind: null, key: '' });
  });

  it('alerts at once for a new problem', () => {
    const r = report({ notifications: 'failing' });
    expect(healthAlertKey(r)).toBe('notifications:failing');
    expect(shouldAlert({ previousKey: '', lastAlertAt: null, report: r, now })).toEqual({ alert: true, kind: 'problem', key: 'notifications:failing' });
  });

  it('does not repeat the same problem within six hours, and reminds after six hours', () => {
    const r = report({ notifications: 'failing' });
    expect(shouldAlert({ previousKey: 'notifications:failing', lastAlertAt: '2026-10-04T08:00:00Z', report: r, now }).alert).toBe(false);
    expect(shouldAlert({ previousKey: 'notifications:failing', lastAlertAt: '2026-10-04T05:59:00Z', report: r, now })).toEqual({
      alert: true,
      kind: 'problem',
      key: 'notifications:failing',
    });
  });

  it('alerts when the problem changes', () => {
    const r = report({ notifications: 'failing', calendar: 'warning' });
    expect(healthAlertKey(r)).toBe('calendar:warning,notifications:failing');
    expect(shouldAlert({ previousKey: 'notifications:failing', lastAlertAt: '2026-10-04T11:55:00Z', report: r, now }).alert).toBe(true);
  });

  it('sends one all clear when it recovers', () => {
    const first = shouldAlert({ previousKey: 'notifications:failing', lastAlertAt: '2026-10-04T11:00:00Z', report: report(), now });
    expect(first).toEqual({ alert: true, kind: 'recovery', key: '' });
    // The caller stores key '' after sending, so the next run is quiet.
    expect(shouldAlert({ previousKey: first.key, lastAlertAt: now, report: report(), now }).alert).toBe(false);
  });
});

describe('healthEmail', () => {
  it('lists the problems with a link to System health and the footer, without personal details', () => {
    const r = report({ stripe: 'failing', backups: 'warning' }, 'Problem reported by someone@example.com on +971 50 123 4567.');
    const email = healthEmail(r, 'https://eliteeducation.me/');
    expect(email.subject).toBe('Elite Education: action needed on system health');
    for (const part of [email.text, email.html]) {
      expect(part).toContain('https://eliteeducation.me/app/manage/system-health');
      expect(part).toContain('Elite Education | eliteeducation.me');
      expect(part).toContain('Label stripe');
      expect(part).not.toMatch(/@example\.com/);
      expect(part).not.toMatch(/123 4567/);
    }
    expect(email.html).toContain('#0A0A0A');
    expect(email.html).toContain('#C9A84C');
  });

  it('writes an all clear', () => {
    const email = healthEmail(report(), 'https://eliteeducation.me');
    expect(email.subject).toBe('Elite Education: all systems are working normally again');
    expect(email.text).toContain('No action is needed.');
  });
});

describe('backups', () => {
  it('names the folder after the UAE date', () => {
    expect(backupPrefix(new Date('2026-10-04T22:10:00Z'))).toBe('2026-10-05/');
    expect(backupPrefix(new Date('2026-10-04T10:00:00Z'))).toBe('2026-10-04/');
  });

  it('expires folders older than 35 days and ignores anything else', () => {
    const now = new Date('2026-10-04T22:10:00Z'); // 5 October in the UAE; the cut-off is 31 August
    expect(expiredBackupPrefixes(['2026-08-30', '2026-08-31/', '2026-09-01', '2026-10-05', 'manual', '2026-8-1'], now)).toEqual(['2026-08-30']);
    expect(expiredBackupPrefixes(['2026-10-01'], now, 3)).toEqual(['2026-10-01']);
  });

  it('never backs up secrets', () => {
    const tables = BACKUP_TABLES.map((t) => t.table);
    for (const secret of ['calendar_connections', 'calendar_oauth_states', 'tutor_payment_details', 'autopay_requests']) {
      expect(tables).not.toContain(secret);
    }
    const profiles = BACKUP_TABLES.find((t) => t.table === 'profiles')!;
    expect(profiles.columns).not.toMatch(/push_token|ics_token|whatsapp/);
  });
});

describe('withMonitoring', () => {
  function fakeDb() {
    const calls: { table: string; op: string; values: Record<string, unknown> }[] = [];
    const db = {
      from: (table: string) => ({
        upsert: async (values: Record<string, unknown>) => {
          calls.push({ table, op: 'upsert', values });
          return { error: null };
        },
        insert: async (values: Record<string, unknown>) => {
          calls.push({ table, op: 'insert', values });
          return { error: null };
        },
      }),
    };
    return { db, calls };
  }
  const request = () => new Request('https://example.com/functions/v1/x', { method: 'POST' });

  it('records a successful run', async () => {
    const { db, calls } = fakeDb();
    const res = await withMonitoring('send-reminders', () => db, async () => new Response('ok'))(request());
    expect(res.status).toBe(200);
    expect(calls.map((c) => Object.keys(c.values).filter((k) => k !== 'function_name')[0])).toEqual(['last_started_at', 'last_succeeded_at']);
  });

  it('logs a thrown error, scrubbed, and answers courteously', async () => {
    const { db, calls } = fakeDb();
    const res = await withMonitoring('ai-assist', () => db, async () => {
      throw new Error('Failed for jane@example.com');
    })(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR });
    const logged = calls.find((c) => c.table === 'function_errors')!;
    expect(logged.values).toMatchObject({ function_name: 'ai-assist', message: 'Failed for [email]', status: 500 });
    expect(calls.some((c) => c.values.last_failed_at)).toBe(true);
  });

  it('logs a 500 response but returns it unchanged', async () => {
    const { db, calls } = fakeDb();
    const res = await withMonitoring('stripe-webhook', () => db, async () => new Response(JSON.stringify({ error: 'Database down' }), { status: 500 }))(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Database down' });
    expect(calls.find((c) => c.table === 'function_errors')!.values.message).toBe('Database down');
  });

  it('never breaks the function when monitoring itself fails', async () => {
    const res = await withMonitoring('charge-invoice', () => {
      throw new Error('no client');
    }, async () => new Response('fine'))(request());
    expect(await res.text()).toBe('fine');
    const broken = { from: () => ({ upsert: () => Promise.reject(new Error('down')), insert: () => Promise.reject(new Error('down')) }) };
    const res2 = await withMonitoring('charge-invoice', () => broken, async () => new Response('still fine'))(request());
    expect(await res2.text()).toBe('still fine');
  });
});
