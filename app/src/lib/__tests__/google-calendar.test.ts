import {
  base64UrlDecode,
  busyBlocksFor,
  findEventUrl,
  firstEventId,
  GIVE_UP_PREFIX,
  giveUpMessage,
  isAuthorisedSyncCall,
  meetPlan,
  mergeIntervals,
  mustWait,
  ownedIntervals,
  shouldClearError,
  buildAuthUrl,
  CALENDAR_API,
  CALENDAR_SCOPES,
  emailFromIdToken,
  eventUrl,
  freeBusyRequest,
  GOOGLE_AUTH_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GoogleAuthError,
  isGoneStatus,
  lessonToEvent,
  meetLinkFromEvent,
  organiserFor,
  parseFreeBusy,
  parseTokenResponse,
  planTargets,
  refreshBody,
  subtractIntervals,
  type SyncConnection,
  type SyncLesson,
  TIME_ZONE,
  tokenExchangeBody,
} from '../../../supabase/functions/_shared/google-calendar';

/** base64url without padding, as Google encodes JWT segments. */
function b64url(text: string): string {
  const bytes = (encodeURIComponent(text).match(/%[0-9A-F]{2}|[\s\S]/g) ?? []).map((c) =>
    c.length === 3 ? parseInt(c.slice(1), 16) : c.charCodeAt(0),
  );
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = [(n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63].map((v) => alphabet[v]);
    out += chars.slice(0, bytes.length - i >= 3 ? 4 : bytes.length - i + 1).join('');
  }
  return out;
}

const fakeIdToken = (payload: object) => `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(payload))}.signature`;

describe('constants', () => {
  it('points at Google', () => {
    expect(GOOGLE_AUTH_URL).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(GOOGLE_TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
    expect(GOOGLE_REVOKE_URL).toBe('https://oauth2.googleapis.com/revoke');
    expect(CALENDAR_API).toBe('https://www.googleapis.com/calendar/v3');
    expect(TIME_ZONE).toBe('Asia/Dubai');
    expect(CALENDAR_SCOPES).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
    ]);
  });
});

describe('buildAuthUrl', () => {
  it('asks for offline access with consent and every scope', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x.supabase.co/functions/v1/google-connect', state: 's1', loginHint: 'tia@x.com' }));
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_URL);
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe('https://x.supabase.co/functions/v1/google-connect');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('include_granted_scopes')).toBe('true');
    expect(p.get('state')).toBe('s1');
    expect(p.get('login_hint')).toBe('tia@x.com');
    expect(p.get('scope')).toBe(CALENDAR_SCOPES.join(' '));
  });

  it('omits an empty login hint', () => {
    expect(new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'r', state: 's' })).searchParams.has('login_hint')).toBe(false);
  });
});

describe('token bodies', () => {
  it('exchanges an authorisation code', () => {
    const body = tokenExchangeBody({ code: 'abc', clientId: 'c', clientSecret: 's', redirectUri: 'r' });
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'authorization_code', code: 'abc', client_id: 'c', client_secret: 's', redirect_uri: 'r' });
  });

  it('refreshes a token', () => {
    expect(Object.fromEntries(refreshBody({ refreshToken: 'rt', clientId: 'c', clientSecret: 's' }))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      client_id: 'c',
      client_secret: 's',
    });
  });
});

describe('parseTokenResponse', () => {
  const now = new Date('2026-10-04T10:00:00.000Z');

  it('reads tokens, expiry and the email from the id_token', () => {
    const tokens = parseTokenResponse(
      { access_token: 'at', refresh_token: 'rt', expires_in: 3599, id_token: fakeIdToken({ email: 'tia@gmail.com', sub: '1' }) },
      now,
    );
    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: '2026-10-04T10:58:59.000Z', email: 'tia@gmail.com' });
  });

  it('copes with a refresh that returns no refresh token or id_token', () => {
    expect(parseTokenResponse({ access_token: 'at', expires_in: 3600 }, now)).toEqual({ accessToken: 'at', expiresAt: '2026-10-04T10:59:00.000Z' });
  });

  it('raises invalid_grant when access was withdrawn', () => {
    expect.assertions(3);
    try {
      parseTokenResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, now);
    } catch (e) {
      expect(e).toBeInstanceOf(GoogleAuthError);
      expect((e as GoogleAuthError).code).toBe('invalid_grant');
      expect((e as GoogleAuthError).message).not.toContain('revoked.');
    }
  });

  it('raises on other errors and on missing tokens', () => {
    expect(() => parseTokenResponse({ error: 'invalid_client' }, now)).toThrow(GoogleAuthError);
    expect(() => parseTokenResponse({}, now)).toThrow('no access token');
  });

  it('decodes base64url, including non-ASCII text', () => {
    expect(base64UrlDecode(b64url('{"name":"Zoë"}'))).toBe('{"name":"Zoë"}');
    expect(emailFromIdToken('not-a-jwt')).toBeUndefined();
    expect(emailFromIdToken(fakeIdToken({ sub: '1' }))).toBeUndefined();
  });
});

const lesson: SyncLesson = {
  id: 'L1',
  tutorId: 'T1',
  studentNames: ['Sami Ahmed', 'Layla Ahmed'],
  tutorName: 'Tia One',
  serviceName: 'IB Maths 1:1',
  start: '2026-10-10T12:00:00Z',
  end: '2026-10-10T13:00:00Z',
  location: 'online',
  status: 'scheduled',
};

describe('lessonToEvent', () => {
  it('titles events for the tutor and for the office', () => {
    expect(lessonToEvent(lesson, 'tutor', { requestMeet: false }).summary).toBe('Elite Education: Sami & Layla');
    expect(lessonToEvent(lesson, 'admin', { requestMeet: false }).summary).toBe('Sami & Layla with Tia One');
  });

  it('describes the lesson with the join link and the brand footer', () => {
    const e = lessonToEvent({ ...lesson, meetingUrl: 'https://meet.google.com/abc-defg-hij' }, 'tutor', { requestMeet: false });
    expect(e.description).toBe('IB Maths 1:1\nTutor: Tia One\nJoin: https://meet.google.com/abc-defg-hij\n\nElite Education | eliteeducation.me');
    expect(e.location).toBe('https://meet.google.com/abc-defg-hij');
    expect(e.start).toEqual({ dateTime: '2026-10-10T12:00:00.000Z', timeZone: 'Asia/Dubai' });
    expect(e.end).toEqual({ dateTime: '2026-10-10T13:00:00.000Z', timeZone: 'Asia/Dubai' });
    expect(e.extendedProperties).toEqual({ private: { eliteLessonId: 'L1' } });
    expect(e.conferenceData).toBeUndefined();
  });

  it('gives the address for an in-person lesson', () => {
    const e = lessonToEvent({ ...lesson, location: 'in-person', address: 'Villa 12, Jumeirah' }, 'admin', { requestMeet: false });
    expect(e.description).toContain('Address: Villa 12, Jumeirah');
    expect(e.location).toBe('Villa 12, Jumeirah');
  });

  it('requests a Google Meet link', () => {
    expect(lessonToEvent(lesson, 'tutor', { requestMeet: true }).conferenceData).toEqual({
      createRequest: { requestId: 'elite-L1', conferenceSolutionKey: { type: 'hangoutsMeet' } },
    });
    expect(lessonToEvent(lesson, 'tutor', { requestMeet: true, requestId: 'elite-L1-x' }).conferenceData?.createRequest.requestId).toBe('elite-L1-x');
  });

  it('never includes contact details', () => {
    const e = lessonToEvent({ ...lesson, address: 'Villa 12' }, 'admin', { requestMeet: false });
    const text = [e.summary, e.description, e.location].join('\n');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/\+?\d[\d\s-]{7,}/);
    expect(text.toLowerCase()).not.toMatch(/iban|bank|account/);
  });
});

describe('eventUrl', () => {
  it('encodes the calendar and never sends Google invitations', () => {
    expect(eventUrl('tia@gmail.com')).toBe(`${CALENDAR_API}/calendars/tia%40gmail.com/events?sendUpdates=none`);
    expect(eventUrl('primary', 'ev1', { sendUpdates: 'none' })).toBe(`${CALENDAR_API}/calendars/primary/events/ev1?sendUpdates=none`);
  });

  it('asks for conference data when creating a Meet link', () => {
    expect(eventUrl('primary', undefined, { conferenceData: true })).toBe(
      `${CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`,
    );
  });
});

describe('meetLinkFromEvent', () => {
  it('prefers hangoutLink, then the video entry point', () => {
    expect(meetLinkFromEvent({ hangoutLink: 'https://meet.google.com/a' })).toBe('https://meet.google.com/a');
    expect(
      meetLinkFromEvent({
        conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.google.com/b' }] },
      }),
    ).toBe('https://meet.google.com/b');
    expect(meetLinkFromEvent({ conferenceData: { entryPoints: [] } })).toBeUndefined();
    expect(meetLinkFromEvent(undefined)).toBeUndefined();
  });
});

describe('free/busy', () => {
  it('builds a 60-day request by default', () => {
    expect(freeBusyRequest('primary', new Date('2026-10-04T00:00:00Z'))).toEqual({
      timeMin: '2026-10-04T00:00:00.000Z',
      timeMax: '2026-12-03T00:00:00.000Z',
      timeZone: 'Asia/Dubai',
      items: [{ id: 'primary' }],
    });
    expect(freeBusyRequest('primary', new Date('2026-10-04T00:00:00Z'), 1).timeMax).toBe('2026-10-05T00:00:00.000Z');
  });

  it('reads busy periods and raises calendar errors', () => {
    expect(parseFreeBusy({ calendars: { primary: { busy: [{ start: '2026-10-05T10:00:00Z', end: '2026-10-05T11:00:00Z' }] } } }, 'primary')).toEqual([
      { start: '2026-10-05T10:00:00.000Z', end: '2026-10-05T11:00:00.000Z' },
    ]);
    expect(parseFreeBusy({ calendars: { primary: {} } }, 'primary')).toEqual([]);
    expect(() => parseFreeBusy({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }, 'primary')).toThrow('notFound');
    expect(() => parseFreeBusy({}, 'primary')).toThrow();
  });
});

describe('subtractIntervals', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 5, h, m)).toISOString();
  const iv = (a: number, b: number) => ({ start: at(a), end: at(b) });

  it('leaves busy time untouched when nothing overlaps', () => {
    expect(subtractIntervals([iv(10, 11)], [iv(12, 13)])).toEqual([iv(10, 11)]);
  });

  it('removes a busy period that is exactly our lesson', () => {
    expect(subtractIntervals([iv(10, 11)], [iv(10, 11)])).toEqual([]);
  });

  it('trims partial overlaps at either end', () => {
    expect(subtractIntervals([iv(10, 12)], [iv(9, 11)])).toEqual([iv(11, 12)]);
    expect(subtractIntervals([iv(10, 12)], [iv(11, 13)])).toEqual([iv(10, 11)]);
  });

  it('splits a merged period around a lesson in the middle', () => {
    expect(subtractIntervals([iv(9, 14)], [iv(10, 11), iv(12, 13)])).toEqual([iv(9, 10), iv(11, 12), iv(13, 14)]);
  });

  it('treats adjacent lessons as non-overlapping and drops zero-length pieces', () => {
    expect(subtractIntervals([iv(10, 11)], [iv(11, 12), iv(9, 10)])).toEqual([iv(10, 11)]);
    expect(subtractIntervals([iv(10, 12)], [iv(10, 11), iv(11, 12)])).toEqual([]);
  });

  it('returns sorted results', () => {
    expect(subtractIntervals([iv(15, 16), iv(8, 9)], [])).toEqual([iv(8, 9), iv(15, 16)]);
  });
});

describe('planTargets', () => {
  const connections: SyncConnection[] = [
    { profileId: 'pTia', role: 'tutor', tutorId: 'T1', status: 'connected' },
    { profileId: 'pTom', role: 'tutor', tutorId: 'T2', status: 'connected' },
    { profileId: 'pCraig', role: 'admin', tutorId: null, status: 'connected' },
    { profileId: 'pOld', role: 'tutor', tutorId: 'T1', status: 'error' },
  ];

  it('creates events for the tutor and the office only', () => {
    expect(planTargets({ tutorId: 'T1', status: 'scheduled' }, connections, [])).toEqual({ upsert: ['pTia', 'pCraig'], remove: [] });
  });

  it('removes every event when a lesson is cancelled or deleted', () => {
    const existing = [
      { profileId: 'pTia', googleEventId: 'e1' },
      { profileId: 'pCraig', googleEventId: 'e2' },
    ];
    expect(planTargets({ tutorId: 'T1', status: 'cancelled' }, connections, existing)).toEqual({ upsert: [], remove: existing });
    expect(planTargets({ tutorId: 'T1', status: 'late-cancel' }, connections, existing).remove).toHaveLength(2);
    expect(planTargets(null, connections, existing)).toEqual({ upsert: [], remove: existing });
  });

  it('moves the event when a lesson is reassigned', () => {
    const plan = planTargets({ tutorId: 'T2', status: 'scheduled' }, connections, [
      { profileId: 'pTia', googleEventId: 'e1' },
      { profileId: 'pCraig', googleEventId: 'e2' },
    ]);
    expect(plan).toEqual({ upsert: ['pTom', 'pCraig'], remove: [{ profileId: 'pTia', googleEventId: 'e1' }] });
  });

  it('ignores disconnected calendars and removes their events', () => {
    const plan = planTargets({ tutorId: 'T1', status: 'scheduled' }, connections, [{ profileId: 'pOld', googleEventId: 'e9' }]);
    expect(plan.upsert).not.toContain('pOld');
    expect(plan.remove).toEqual([{ profileId: 'pOld', googleEventId: 'e9' }]);
  });

  it('keeps completed lessons in the calendar', () => {
    expect(planTargets({ tutorId: 'T1', status: 'completed' }, connections, []).upsert).toEqual(['pTia', 'pCraig']);
  });
});

describe('organiserFor', () => {
  const tia: SyncConnection = { profileId: 'pTia', role: 'tutor', tutorId: 'T1', status: 'connected' };
  const craig: SyncConnection = { profileId: 'pCraig', role: 'admin', status: 'connected' };
  const craigTeaching: SyncConnection = { profileId: 'pCraig', role: 'admin', tutorId: 'T9', status: 'connected' };
  it('hosts the Meet on the lesson tutor’s own calendar only', () => {
    expect(organiserFor({ tutorId: 'T1' }, [craig, tia])).toBe(tia);
    expect(organiserFor({ tutorId: 'T9' }, [tia, craigTeaching])).toBe(craigTeaching);
  });
  it('never falls back to the office calendar, whose owner is not in the lesson', () => {
    expect(organiserFor({ tutorId: 'T2' }, [craig])).toBeUndefined();
    expect(organiserFor({ tutorId: 'T2' }, [craigTeaching, tia])).toBeUndefined();
    expect(organiserFor({ tutorId: 'T2' }, [])).toBeUndefined();
  });
});

describe('meetPlan', () => {
  const tia: SyncConnection = { profileId: 'pTia', role: 'tutor', tutorId: 'T1', status: 'connected' };
  const tom: SyncConnection = { profileId: 'pTom', role: 'tutor', tutorId: 'T2', status: 'connected' };
  const office: SyncConnection = { profileId: 'pCraig', role: 'admin', tutorId: 'T9', status: 'connected' };
  const online = { tutorId: 'T1', status: 'scheduled', location: 'online', meetingUrl: null as string | null };
  const link = 'https://meet.google.com/abc-defg-hij';

  it('creates a link on the tutor’s calendar for an online lesson without one', () => {
    expect(meetPlan(online, [tia, office], [])).toEqual({ create: tia, clearStale: false });
  });

  it('creates nothing when the tutor has not connected, rather than hosting on the office calendar', () => {
    expect(meetPlan({ ...online, tutorId: 'T3' }, [office], [])).toEqual({ create: undefined, clearStale: false });
  });

  it('keeps a link the tutor’s calendar generated, and never touches a pasted link', () => {
    const existing = [{ profileId: 'pTia', googleEventId: 'e1', meetUrl: link }];
    expect(meetPlan({ ...online, meetingUrl: link }, [tia, office], existing)).toEqual({ create: undefined, clearStale: false });
    const zoom = { ...online, tutorId: 'T2', meetingUrl: 'https://zoom.us/j/1' };
    expect(meetPlan(zoom, [tom, office], existing)).toEqual({ create: undefined, clearStale: false });
  });

  it('clears and recreates a generated link when the lesson moves to another tutor', () => {
    const existing = [{ profileId: 'pTia', googleEventId: 'e1', meetUrl: link }];
    expect(meetPlan({ ...online, tutorId: 'T2', meetingUrl: link }, [tom, office], existing)).toEqual({ create: tom, clearStale: true });
  });

  it('clears a generated link when the new tutor has no calendar connected', () => {
    const existing = [{ profileId: 'pTia', googleEventId: 'e1', meetUrl: link }];
    expect(meetPlan({ ...online, tutorId: 'T3', meetingUrl: link }, [office], existing)).toEqual({ create: undefined, clearStale: true });
  });

  it('clears a generated link when the lesson becomes in person, and leaves cancelled lessons alone', () => {
    const existing = [{ profileId: 'pTia', googleEventId: 'e1', meetUrl: link }];
    expect(meetPlan({ ...online, location: 'in-person', meetingUrl: link }, [tia], existing).clearStale).toBe(true);
    expect(meetPlan({ ...online, status: 'cancelled', meetingUrl: link }, [], existing)).toEqual({ clearStale: false });
    expect(meetPlan(null, [], existing)).toEqual({ clearStale: false });
  });
});

describe('mustWait', () => {
  const tiaDown: SyncConnection = { profileId: 'pTia', role: 'tutor', tutorId: 'T1', status: 'connected' };
  const officeDown: SyncConnection = { profileId: 'pCraig', role: 'admin', tutorId: null, status: 'connected' };
  const lesson = { tutorId: 'T1', status: 'scheduled' };

  it('keeps a change queued while a calendar that should show it cannot be reached', () => {
    expect(mustWait(lesson, [tiaDown], [])).toBe(true);
    expect(mustWait({ tutorId: 'T2', status: 'scheduled' }, [officeDown], [])).toBe(true);
  });

  it('keeps a removal queued while the calendar holding the event cannot be reached', () => {
    expect(mustWait({ ...lesson, status: 'cancelled' }, [tiaDown], [{ profileId: 'pTia', googleEventId: 'e1' }])).toBe(true);
    expect(mustWait(null, [tiaDown], [{ profileId: 'pTia', googleEventId: 'e1' }])).toBe(true);
  });

  it('does not wait for calendars the lesson has nothing to do with', () => {
    expect(mustWait({ tutorId: 'T2', status: 'scheduled' }, [tiaDown], [])).toBe(false);
    expect(mustWait({ ...lesson, status: 'cancelled' }, [tiaDown], [])).toBe(false);
    expect(mustWait(lesson, [], [])).toBe(false);
  });
});

describe('busy blocks from a calendar', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 8, h, m)).toISOString();
  const iv = (a: number, b: number) => ({ start: at(a), end: at(b) });

  it('does not turn other tutors’ lessons in an admin-and-tutor calendar into busy time', () => {
    // Craig is the office and also teaches (T9). His calendar holds Sarah's lesson 11:00–12:00 (written by us),
    // his own lesson 13:00–14:00, and a personal appointment 16:00–17:00.
    const busy = [iv(11, 12), iv(13, 14), iv(16, 17)];
    const rows = [
      { tutorId: 'T-sarah', status: 'scheduled', start: at(11), end: at(12), inCalendar: true },
      { tutorId: 'T9', status: 'scheduled', start: at(13), end: at(14), inCalendar: true },
    ];
    expect(busyBlocksFor(busy, 'T9', rows)).toEqual([iv(16, 17)]);
  });

  it('removes the tutor’s own lessons even before they reach the calendar, but not cancelled ones', () => {
    const rows = [
      { tutorId: 'T1', status: 'scheduled', start: at(9), end: at(10), inCalendar: false },
      { tutorId: 'T1', status: 'cancelled', start: at(12), end: at(13), inCalendar: false },
      { tutorId: 'T2', status: 'scheduled', start: at(15), end: at(16), inCalendar: false },
    ];
    expect(ownedIntervals('T1', rows)).toEqual([iv(9, 10)]);
    expect(busyBlocksFor([iv(9, 10), iv(12, 13), iv(15, 16)], 'T1', rows)).toEqual([iv(12, 13), iv(15, 16)]);
  });

  it('still removes a cancelled lesson whose event has not yet been taken out of the calendar', () => {
    const rows = [{ tutorId: 'T2', status: 'cancelled', start: at(12), end: at(13), inCalendar: true }];
    expect(busyBlocksFor([iv(12, 13)], 'T1', rows)).toEqual([]);
  });

  it('merges busy times from two calendars of the same tutor', () => {
    expect(mergeIntervals([iv(15, 16), iv(9, 10), iv(9, 11), iv(11, 12)])).toEqual([iv(9, 12), iv(15, 16)]);
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('isAuthorisedSyncCall', () => {
  const secret = 'a-long-shared-secret-value';
  it('accepts only the shared secret', () => {
    expect(isAuthorisedSyncCall(secret, secret)).toBe(true);
    expect(isAuthorisedSyncCall('a-long-shared-secret-valuf', secret)).toBe(false);
    expect(isAuthorisedSyncCall(`${secret}x`, secret)).toBe(false);
    expect(isAuthorisedSyncCall(null, secret)).toBe(false);
    expect(isAuthorisedSyncCall('', secret)).toBe(false);
  });
  it('refuses everyone when the secret is missing or too short', () => {
    expect(isAuthorisedSyncCall('', '')).toBe(false);
    expect(isAuthorisedSyncCall('short', 'short')).toBe(false);
    expect(isAuthorisedSyncCall(undefined, undefined)).toBe(false);
  });
});

describe('finding an event we already wrote', () => {
  it('searches the calendar by the lesson’s private property', () => {
    const url = new URL(findEventUrl('primary', 'L1'));
    expect(`${url.origin}${url.pathname}`).toBe(`${CALENDAR_API}/calendars/primary/events`);
    expect(url.searchParams.get('privateExtendedProperty')).toBe('eliteLessonId=L1');
    expect(url.searchParams.get('showDeleted')).toBe('false');
  });
  it('reads the first live event id', () => {
    expect(firstEventId({ items: [{ id: 'gone', status: 'cancelled' }, { id: 'e2', status: 'confirmed' }] })).toBe('e2');
    expect(firstEventId({ items: [] })).toBeUndefined();
    expect(firstEventId(null)).toBeUndefined();
  });
});

describe('calendar card warnings', () => {
  const now = new Date(Date.UTC(2026, 9, 8, 12));
  it('keeps a recent give-up notice for a day and clears other warnings', () => {
    expect(giveUpMessage(5)).toMatch(new RegExp(`^${GIVE_UP_PREFIX} after 5 attempts`));
    expect(shouldClearError(giveUpMessage(5), new Date(now.getTime() - 3_600_000).toISOString(), now)).toBe(false);
    expect(shouldClearError(giveUpMessage(5), new Date(now.getTime() - 25 * 3_600_000).toISOString(), now)).toBe(true);
    expect(shouldClearError('We could not reach Google. We will try again shortly.', now.toISOString(), now)).toBe(true);
    expect(shouldClearError(null, null, now)).toBe(false);
  });
});

describe('isGoneStatus', () => {
  it('treats 404 and 410 as already deleted', () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(200)).toBe(false);
  });
});
