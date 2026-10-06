/**
 * Edge Function security review (20261114000300_sec_fn): PKCE and return addresses for Google Calendar, the calendar
 * feed's scope and escaping, notification email escaping, and the rate limit's fail-open behaviour.
 */
import { appLink, emailHtml, emailSubject, escapeHtml, isSingleEmail } from '../../../supabase/functions/_shared/email';
import {
  allowedReturnTo,
  buildAuthUrl,
  codeChallengeFor,
  grantsCalendar,
  newCodeVerifier,
  parseTokenResponse,
  REQUIRED_CALENDAR_SCOPE,
  tokenExchangeBody,
} from '../../../supabase/functions/_shared/google-calendar';
import { feedScope, icsEscape, isFeedToken } from '../../../supabase/functions/_shared/ics';
import { withinRateLimit } from '../../../supabase/functions/_shared/rate-limit';

describe('Google Calendar PKCE', () => {
  it('derives the S256 challenge of RFC 7636 appendix B', async () => {
    expect(await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes long, random, URL-safe verifiers', () => {
    const a = newCodeVerifier();
    const b = newCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a).not.toBe(b);
  });

  it('sends the challenge to Google and the verifier with the code', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 's', codeChallenge: 'abc' }));
    expect(url.searchParams.get('code_challenge')).toBe('abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const plain = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 's' }));
    expect(plain.searchParams.has('code_challenge')).toBe(false);

    const body = tokenExchangeBody({ code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'https://x/cb', codeVerifier: 'v' });
    expect(body.get('code_verifier')).toBe('v');
    expect(tokenExchangeBody({ code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'https://x/cb' }).has('code_verifier')).toBe(false);
  });

  it('refuses a connection where the Calendar permission was unticked', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    const granted = parseTokenResponse({ access_token: 'a', expires_in: 3600, scope: `openid email ${REQUIRED_CALENDAR_SCOPE}` }, now);
    expect(grantsCalendar(granted.scope)).toBe(true);
    const unticked = parseTokenResponse({ access_token: 'a', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.freebusy' }, now);
    expect(grantsCalendar(unticked.scope)).toBe(false);
    expect(grantsCalendar(undefined)).toBe(true);
  });
});

describe('google-connect return addresses', () => {
  const prefixes = ['https://eliteeducation.me/app', '', ' http://localhost:8081 ', 'https://eliteeducationuae.github.io/app', 'eliteeducation://'];

  it('accepts the app and its own scheme', () => {
    for (const ok of [
      'https://eliteeducation.me/app',
      'https://eliteeducation.me/app/settings?tab=calendar',
      'https://eliteeducation.me/app#top',
      'https://eliteeducationuae.github.io/app/tutor',
      'http://localhost:8081/settings',
      'eliteeducation://calendar-connected',
    ]) {
      expect(allowedReturnTo(ok, prefixes)).toBe(ok);
    }
  });

  it('refuses look-alike hosts, other sites, backslashes and line breaks', () => {
    for (const bad of [
      'https://eliteeducation.me/application',
      'https://eliteeducation.me/app.evil.com',
      'https://eliteeducation.me/app@evil.com',
      'https://eliteeducation.me.evil.com/app',
      'https://evil.com/?https://eliteeducation.me/app',
      'http://localhost:80810/x',
      'https://eliteeducation.me/app/\\evil.com',
      'https://eliteeducation.me/app/\r\nSet-Cookie: x',
      'https://eliteeducation.me/app/ x',
      'javascript:alert(1)//https://eliteeducation.me/app',
      '',
      42,
      null,
    ]) {
      expect(allowedReturnTo(bad, prefixes)).toBeNull();
    }
    expect(allowedReturnTo(`https://eliteeducation.me/app/${'a'.repeat(2100)}`, prefixes)).toBeNull();
  });
});

describe('calendar feed', () => {
  it('shows every lesson to an admin only', () => {
    expect(feedScope({ role: 'admin' })).toBe('all');
    expect(feedScope({ role: 'tutor', tutor_id: 't' })).toBe('tutor');
    expect(feedScope({ role: 'parent', family_id: 'f' })).toBe('parent');
    expect(feedScope({ role: 'student', student_id: 's' })).toBe('student');
    // The accountant never sees lessons in the app, so their feed is empty; so is an unlinked profile's.
    expect(feedScope({ role: 'accountant' })).toBe('none');
    expect(feedScope({ role: 'tutor', tutor_id: null })).toBe('none');
    expect(feedScope({ role: 'parent' })).toBe('none');
    expect(feedScope({ role: 'mystery' })).toBe('none');
  });

  it('never lets typed text start a new calendar property', () => {
    expect(icsEscape('Maths\r\nATTENDEE:mailto:x@evil.com')).toBe('Maths\\nATTENDEE:mailto:x@evil.com');
    expect(icsEscape('a\rb\nc\u2028d')).toBe('a\\nb\\nc\\nd');
    expect(icsEscape('Flat 1, Tower; Dubai \\ UAE')).toBe('Flat 1\\, Tower\\; Dubai \\\\ UAE');
    expect(icsEscape('bell\u0007tab\tok')).toBe('belltab\tok');
  });

  it('only reads UUID feed tokens', () => {
    expect(isFeedToken('6f1c2a4e-1b2c-4d3e-8f90-1234567890ab')).toBe(true);
    for (const bad of [null, undefined, '', '------------------------------------', '6f1c2a4e1b2c4d3e8f901234567890ab', "' or 1=1 --"]) {
      expect(isFeedToken(bad)).toBe(false);
    }
  });
});

describe('notification emails', () => {
  it('escapes the subject, the body and the link', () => {
    const html = emailHtml('<b>Hi</b>', 'Dear "Mona" & <script>alert(1)</script>\n\nThanks', 'https://x/app/a?b="c"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(html).toContain('href="https://x/app/a?b=&quot;c&quot;"');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('keeps the subject to one line', () => {
    expect(emailSubject('Invoice INV-1\r\nBcc: everyone@example.com')).toBe('Invoice INV-1 Bcc: everyone@example.com');
    expect(emailSubject('  ')).toBe('Elite Education');
    expect(emailSubject('x'.repeat(500))).toHaveLength(200);
  });

  it('links only to paths inside the app', () => {
    expect(appLink('https://eliteeducation.me/app/', '/invoice/1')).toBe('https://eliteeducation.me/app/invoice/1');
    for (const bad of ['//evil.com/x', 'https://evil.com', 'javascript:alert(1)', '/a b', '/\\evil.com', null, undefined]) {
      expect(appLink('https://eliteeducation.me/app', bad)).toBeUndefined();
    }
  });

  it('sends to one plain address only', () => {
    expect(isSingleEmail('mona@example.com')).toBe(true);
    for (const bad of ['a@x.com, b@y.com', 'a@x.com;b@y.com', 'Mona <a@x.com>', 'a@x.com\r\nBcc: b@y.com', 'no-at-sign', '', null]) {
      expect(isSingleEmail(bad)).toBe(false);
    }
  });
});

describe('rate limits', () => {
  const db = (result: { data?: unknown; error?: { message: string } | null } | Error) => ({
    rpc: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return { data: result.data ?? null, error: result.error ?? null };
    }),
  });

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('allows a call within the limit and refuses one over it', async () => {
    const ok = db({ data: true });
    expect(await withinRateLimit(ok, 'ai-assist:me', 60, 3600)).toBe(true);
    expect(ok.rpc).toHaveBeenCalledWith('consume_rate_limit', { p_key: 'ai-assist:me', p_max: 60, p_window_seconds: 3600 });
    expect(await withinRateLimit(db({ data: false }), 'ai-assist:me', 60, 3600)).toBe(false);
  });

  it('fails open when the limit cannot be checked', async () => {
    expect(await withinRateLimit(db({ error: { message: 'function consume_rate_limit does not exist' } }), 'k', 1, 60)).toBe(true);
    expect(await withinRateLimit(db(new Error('network')), 'k', 1, 60)).toBe(true);
  });
});
