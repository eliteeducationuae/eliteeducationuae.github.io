import type { AppErrorInput } from '@/domain/types';

import {
  buildErrorInput,
  configureErrorReporting,
  createRateLimiter,
  describeError,
  errorFingerprint,
  installGlobalErrorHandlers,
  isExpectedError,
  isNetworkError,
  registerErrorSink,
  reportError,
  resetErrorReportingForTests,
  scrubPII,
} from '../error-reporting';

describe('scrubPII', () => {
  it('removes email addresses, phone numbers and account numbers', () => {
    const out = scrubPII('Could not email fatima@example.com or call +971 50 123 4567 about AE070331234567890123456');
    expect(out).not.toMatch(/fatima|example\.com/);
    expect(out).not.toMatch(/123 4567|4567890/);
    expect(out).toContain('[email]');
    expect(out).toContain('[number]');
  });

  it('removes tokens and query strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF_123-xyz';
    const out = scrubPII(`Bearer ${jwt} failed at https://x.supabase.co/rest/v1/profiles?email=eq.a@b.com&select=* with apikey=sb_secret_abc and ${'k'.repeat(40)}`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain('a@b.com');
    expect(out).not.toContain('select=*');
    expect(out).not.toContain('sb_secret_abc');
    expect(out).not.toContain('k'.repeat(40));
    expect(out).toContain('https://x.supabase.co/rest/v1/profiles?[query]');
  });

  it('keeps ordinary messages and short numbers such as line numbers', () => {
    expect(scrubPII("Cannot read properties of undefined (reading 'name')")).toBe("Cannot read properties of undefined (reading 'name')");
    expect(scrubPII('at render (bundle.js:1234:56)')).toBe('at render (bundle.js:1234:56)');
    expect(scrubPII(undefined)).toBe('');
  });
});

describe('errorFingerprint', () => {
  it('is short, stable and depends on source, first line and route', () => {
    const a = errorFingerprint('query', 'Boom\nstack', 'lessons');
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(errorFingerprint('query', 'Boom\nother stack', 'lessons')).toBe(a);
    expect(errorFingerprint('mutation', 'Boom', 'lessons')).not.toBe(a);
    expect(errorFingerprint('query', 'Boom', 'invoices')).not.toBe(a);
  });
});

describe('createRateLimiter', () => {
  it('allows ten reports a minute', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t });
    const results = Array.from({ length: 12 }, (_, i) => limiter.allow(`fp${i}`));
    expect(results.filter(Boolean)).toHaveLength(10);
    t = 61_000;
    expect(limiter.allow('fresh')).toBe(true);
  });

  it('sends the same error at most once every five minutes', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t });
    expect(limiter.allow('same')).toBe(true);
    t = 4 * 60_000;
    expect(limiter.allow('same')).toBe(false);
    t = 5 * 60_000 + 1;
    expect(limiter.allow('same')).toBe(true);
  });
});

describe('expected and network errors', () => {
  it('ignores aborted requests', () => {
    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    expect(isExpectedError(abort)).toBe(true);
    expect(isExpectedError(new Error('Aborted'))).toBe(true);
    expect(isExpectedError(new Error('Boom'))).toBe(false);
  });
  it('recognises a lost connection', () => {
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('Boom'))).toBe(false);
  });
});

describe('buildErrorInput', () => {
  it('scrubs the message, stack and route and adds the platform and version', () => {
    const err = new Error('No account for omar@example.com');
    const input = buildErrorInput(err, { source: 'query', route: '/parent/account?token=abc' }, { platform: 'web', appVersion: '1.2.0' });
    expect(input.message).toBe('No account for [email]');
    expect(input.route).toBe('/parent/account');
    expect(input.platform).toBe('web');
    expect(input.appVersion).toBe('1.2.0');
    expect(input.source).toBe('query');
    expect(input.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(input.stack ?? '').not.toContain('omar@example.com');
  });
  it('handles things that are not errors', () => {
    expect(buildErrorInput('plain text', { source: 'manual' }, { platform: 'ios' }).message).toBe('plain text');
    expect(buildErrorInput({ message: 'object' }, { source: 'manual' }, { platform: 'ios' }).message).toBe('object');
  });
});

describe('reportError', () => {
  beforeEach(() => resetErrorReportingForTests());

  it('sends to the server and to registered sinks', () => {
    const sent: AppErrorInput[] = [];
    const extra: AppErrorInput[] = [];
    configureErrorReporting({ platform: 'android', appVersion: '1.0.0', send: async (i) => sent.push(i), now: () => 0 });
    const remove = registerErrorSink((i) => {
      extra.push(i);
    });
    reportError(new Error('Boom'), { source: 'boundary', route: 'home' });
    expect(sent).toHaveLength(1);
    expect(extra).toHaveLength(1);
    expect(sent[0]).toMatchObject({ message: 'Boom', platform: 'android', source: 'boundary', route: 'home' });
    remove();
    reportError(new Error('Another'), { source: 'boundary' });
    expect(extra).toHaveLength(1);
  });

  it('queues reports made before it is configured', () => {
    reportError(new Error('Early'), { source: 'global' });
    const sent: AppErrorInput[] = [];
    configureErrorReporting({ platform: 'web', send: async (i) => sent.push(i) });
    expect(sent.map((s) => s.message)).toEqual(['Early']);
  });

  it('never throws, even when a sink or the server fails', () => {
    configureErrorReporting({ platform: 'web', send: () => Promise.reject(new Error('offline')) });
    registerErrorSink(() => {
      throw new Error('sink broke');
    });
    expect(() => reportError(new Error('Boom'), { source: 'manual' })).not.toThrow();
  });

  it('does not report its own failures', () => {
    const sent: AppErrorInput[] = [];
    configureErrorReporting({
      platform: 'web',
      send: async (i) => {
        sent.push(i);
        reportError(new Error('recursive'), { source: 'manual' });
      },
    });
    registerErrorSink(() => reportError(new Error('from sink'), { source: 'manual' }));
    reportError(new Error('Boom'), { source: 'manual' });
    expect(sent.map((s) => s.message)).toEqual(['Boom']);
  });

  it('ignores expected errors and reports a lost connection once', () => {
    const sent: AppErrorInput[] = [];
    configureErrorReporting({ platform: 'web', send: async (i) => sent.push(i) });
    reportError(Object.assign(new Error('aborted'), { name: 'AbortError' }), { source: 'query' });
    reportError(new TypeError('Network request failed'), { source: 'query', route: 'lessons' });
    reportError(new TypeError('Network request failed'), { source: 'query', route: 'invoices' });
    expect(sent).toHaveLength(1);
  });

  it('rate limits repeated errors', () => {
    const sent: AppErrorInput[] = [];
    configureErrorReporting({ platform: 'web', send: async (i) => sent.push(i), now: () => 0 });
    for (let i = 0; i < 5; i++) reportError(new Error('Same'), { source: 'query', route: 'x' });
    for (let i = 0; i < 20; i++) reportError(new Error(`Different ${i}`), { source: 'query', route: 'x' });
    expect(sent).toHaveLength(10);
  });
});

describe('installGlobalErrorHandlers', () => {
  beforeEach(() => resetErrorReportingForTests());

  it('chains the previous React Native handler, once', () => {
    const g = globalThis as unknown as { ErrorUtils?: unknown };
    const previous = jest.fn();
    let handler: ((e: unknown, fatal?: boolean) => void) | undefined = previous;
    const setGlobalHandler = jest.fn((h: (e: unknown, fatal?: boolean) => void) => {
      handler = h;
    });
    g.ErrorUtils = { getGlobalHandler: () => handler, setGlobalHandler };
    const sent: AppErrorInput[] = [];
    configureErrorReporting({ platform: 'ios', send: async (i) => sent.push(i) });
    installGlobalErrorHandlers();
    installGlobalErrorHandlers();
    expect(setGlobalHandler).toHaveBeenCalledTimes(1);
    handler!(new Error('Uncaught'), true);
    expect(sent[0]).toMatchObject({ message: 'Uncaught', source: 'global' });
    expect(previous).toHaveBeenCalledWith(expect.any(Error), true);
    delete g.ErrorUtils;
  });
});

describe('errors shown with a calm message', () => {
  it('are logged with the original server text kept as the cause', () => {
    const err = new Error('We could not reach Elite Education. Please check your connection and try again.', { cause: 'TypeError: Failed to fetch' });
    expect(describeError(err).message).toBe('TypeError: Failed to fetch');
    expect(isNetworkError(err)).toBe(true);
  });
});
