import {
  buildSiteverifyBody,
  clientIp,
  FAILURE_MESSAGE,
  isCaptchaForm,
  parseAllowedHostnames,
  readSiteverifyResult,
  SITEVERIFY_URL,
  turnstileConfigFromEnv,
} from '../../../supabase/functions/_shared/turnstile';

describe('Turnstile siteverify request', () => {
  it('posts to the Cloudflare endpoint', () => {
    expect(SITEVERIFY_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('includes the address and idempotency key when known', () => {
    const body = buildSiteverifyBody({ secret: 's3cret', token: 'tok', ip: '203.0.113.9', idempotencyKey: 'key-1' });
    expect(Object.fromEntries(body)).toEqual({ secret: 's3cret', response: 'tok', remoteip: '203.0.113.9', idempotency_key: 'key-1' });
  });

  it('leaves out the address and idempotency key when absent', () => {
    expect(Object.fromEntries(buildSiteverifyBody({ secret: 's', token: 't' }))).toEqual({ secret: 's', response: 't' });
    expect(Object.fromEntries(buildSiteverifyBody({ secret: 's', token: 't', ip: null, idempotencyKey: '' }))).toEqual({
      secret: 's',
      response: 't',
    });
  });

  it('encodes as a form body', () => {
    expect(buildSiteverifyBody({ secret: 'a b', token: 'x&y' }).toString()).toBe('secret=a+b&response=x%26y');
  });
});

describe('clientIp', () => {
  it('prefers the Cloudflare header, then x-real-ip, then the first forwarded address', () => {
    expect(
      clientIp(new Headers({ 'cf-connecting-ip': '198.51.100.7', 'x-real-ip': '192.0.2.1', 'x-forwarded-for': '203.0.113.9' })),
    ).toBe('198.51.100.7');
    expect(clientIp(new Headers({ 'x-real-ip': '192.0.2.1', 'x-forwarded-for': '203.0.113.9' }))).toBe('192.0.2.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('returns null without any address', () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '' }))).toBeNull();
  });
});

describe('readSiteverifyResult', () => {
  const ok = { success: true, hostname: 'eliteeducation.me', action: 'enquiry', 'error-codes': [] };

  it('accepts a successful check', () => {
    expect(readSiteverifyResult(ok)).toEqual({ ok: true });
    expect(readSiteverifyResult(ok, { expectedAction: 'enquiry', allowedHostnames: ['eliteeducation.me'] })).toEqual({ ok: true });
  });

  it('reports Cloudflare error codes on failure', () => {
    expect(readSiteverifyResult({ success: false, 'error-codes': ['invalid-input-response', 'timeout-or-duplicate'] })).toEqual({
      ok: false,
      reason: 'invalid-input-response,timeout-or-duplicate',
    });
    expect(readSiteverifyResult({ success: false })).toEqual({ ok: false, reason: 'not-successful' });
  });

  it('rejects the wrong hostname only when hostnames are configured', () => {
    const other = { ...ok, hostname: 'evil.example' };
    expect(readSiteverifyResult(other, { allowedHostnames: ['eliteeducation.me'] })).toEqual({ ok: false, reason: 'hostname-mismatch' });
    expect(readSiteverifyResult({ success: true }, { allowedHostnames: ['eliteeducation.me'] })).toEqual({
      ok: false,
      reason: 'hostname-mismatch',
    });
    expect(readSiteverifyResult(other, { allowedHostnames: [] })).toEqual({ ok: true });
    expect(readSiteverifyResult({ ...ok, hostname: 'WWW.EliteEducation.me' }, { allowedHostnames: ['www.eliteeducation.me'] })).toEqual({
      ok: true,
    });
  });

  it('rejects the wrong action but tolerates a missing one', () => {
    expect(readSiteverifyResult(ok, { expectedAction: 'application' })).toEqual({ ok: false, reason: 'action-mismatch' });
    expect(readSiteverifyResult({ success: true }, { expectedAction: 'application' })).toEqual({ ok: true });
  });

  it('treats anything unexpected as a failure', () => {
    for (const junk of [null, undefined, 'success', 42, [], [{ success: true }], { success: 'true' }, {}]) {
      expect(readSiteverifyResult(junk).ok).toBe(false);
    }
  });
});

describe('configuration', () => {
  it('is off without a secret', () => {
    expect(turnstileConfigFromEnv(() => undefined)).toBeNull();
    expect(turnstileConfigFromEnv((k) => (k === 'TURNSTILE_SECRET_KEY' ? '   ' : undefined))).toBeNull();
  });

  it('reads the secret and allowed hostnames', () => {
    const env: Record<string, string> = {
      TURNSTILE_SECRET_KEY: ' 0x4AAA ',
      TURNSTILE_ALLOWED_HOSTNAMES: ' eliteeducation.me, WWW.EliteEducation.me ,,',
    };
    expect(turnstileConfigFromEnv((k) => env[k])).toEqual({
      secret: '0x4AAA',
      allowedHostnames: ['eliteeducation.me', 'www.eliteeducation.me'],
    });
    expect(turnstileConfigFromEnv((k) => (k === 'TURNSTILE_SECRET_KEY' ? 'x' : undefined))).toEqual({ secret: 'x', allowedHostnames: [] });
  });

  it('parses hostnames', () => {
    expect(parseAllowedHostnames()).toEqual([]);
    expect(parseAllowedHostnames('')).toEqual([]);
    expect(parseAllowedHostnames(' A.com ,b.COM')).toEqual(['a.com', 'b.com']);
  });

  it('knows the two forms and the failure wording', () => {
    expect(isCaptchaForm('enquiry')).toBe(true);
    expect(isCaptchaForm('application')).toBe(true);
    expect(isCaptchaForm('login')).toBe(false);
    expect(isCaptchaForm(undefined)).toBe(false);
    expect(FAILURE_MESSAGE).toBe('We could not complete the security check. Please try again, or email craig@craigobrieneducation.com.');
  });
});
