import {
  VIEW_ENDED_MESSAGE,
  VIEW_MINUTES,
  VIEW_ONLY_MESSAGE,
  parseStartBody,
  sessionIdFromJwt,
  startResponse,
} from '../../../supabase/functions/_shared/view-as-core';

const SID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

function b64url(text: string, pad = false) {
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_');
  return pad ? b : b.replace(/=+$/, '');
}
function jwt(payload: unknown, pad = false) {
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload), pad)}.signature`;
}

describe('view-as messages', () => {
  it('match the wording shared with the app', () => {
    expect(VIEW_ONLY_MESSAGE).toBe('Viewing only — changes are disabled.');
    expect(VIEW_ENDED_MESSAGE).toBe('This view has ended. Please return to your own account.');
    expect(VIEW_MINUTES).toBe(60);
  });
});

describe('sessionIdFromJwt', () => {
  it('reads the session id from a valid token', () => {
    expect(sessionIdFromJwt(jwt({ sub: 'x', session_id: SID, role: 'authenticated' }))).toBe(SID);
  });

  it('accepts base64url with or without padding, and URL-safe characters', () => {
    // Lengths chosen so the payload needs one and two padding characters.
    for (const extra of ['', 'a', 'ab', 'abc']) {
      const payload = { session_id: SID, n: extra, s: '?>?>' };
      expect(sessionIdFromJwt(jwt(payload, true))).toBe(SID);
      expect(sessionIdFromJwt(jwt(payload, false))).toBe(SID);
    }
    expect(jwt({ session_id: SID, s: '?>?>' })).toMatch(/[-_]/);
  });

  it('handles non-ASCII text in the payload', () => {
    expect(sessionIdFromJwt(jwt({ session_id: SID, name: 'Zoë — مرحبا' }))).toBe(SID);
  });

  it('returns null for garbage', () => {
    for (const t of [null, undefined, '', 'abc', 'a.b', 'a.b.c.d', 'x.!!!.y', `x.${b64url('not json')}.y`, `x.${b64url('"text"')}.y`,
      `x.${b64url('null')}.y`, 'x.a.y', 'x..y']) {
      expect(sessionIdFromJwt(t as string)).toBeNull();
    }
  });

  it('returns null when the claim is missing or not a uuid', () => {
    expect(sessionIdFromJwt(jwt({ sub: 'x' }))).toBeNull();
    expect(sessionIdFromJwt(jwt({ session_id: 42 }))).toBeNull();
    expect(sessionIdFromJwt(jwt({ session_id: 'not-a-uuid' }))).toBeNull();
  });
});

describe('parseStartBody', () => {
  it('accepts a profile id', () => {
    expect(parseStartBody({ profileId: SID })).toEqual({ profileId: SID });
    expect(parseStartBody({ profileId: ` ${SID.toUpperCase()} ` })).toEqual({ profileId: SID });
  });

  it('rejects anything else', () => {
    for (const body of [null, undefined, 'x', 42, {}, { profileId: 'abc' }, { profileId: 5 }, { id: SID }]) {
      expect(parseStartBody(body)).toEqual({ error: expect.any(String) });
    }
  });
});

describe('startResponse', () => {
  it('maps the view and session to the contract shape', () => {
    expect(
      startResponse(
        { id: 'view-1', expires_at: '2026-10-04T10:00:00+04:00' },
        { access_token: 'access', refresh_token: 'refresh' },
      ),
    ).toEqual({ viewId: 'view-1', accessToken: 'access', refreshToken: 'refresh', expiresAt: '2026-10-04T06:00:00.000Z' });
  });
});
