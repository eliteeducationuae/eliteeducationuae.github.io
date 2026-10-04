// Pure helpers for Google Calendar sync: OAuth URLs and bodies, lesson-to-event mapping, free/busy
// handling and the plan of which calendars should hold each lesson.
//
// This file deliberately has no imports and uses no Deno globals, so the Edge Functions, Jest and
// the app's TypeScript check can all compile it. Keep it that way.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
export const TIME_ZONE = 'Asia/Dubai';
export const BRAND_FOOTER = 'Elite Education | eliteeducation.me';

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** The Google consent screen URL. Offline access with prompt=consent so Google always returns a refresh token. */
export function buildAuthUrl(opts: { clientId: string; redirectUri: string; state: string; loginHint?: string | null }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function tokenExchangeBody(opts: { code: string; clientId: string; clientSecret: string; redirectUri: string }): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
  });
}

export function refreshBody(opts: { refreshToken: string; clientId: string; clientSecret: string }): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
}

export type GoogleAuthErrorCode = 'invalid_grant' | 'invalid_response' | 'oauth_error';

/** A failed token request. 'invalid_grant' means access was withdrawn and the person must reconnect. */
export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;
  constructor(code: GoogleAuthErrorCode, message: string) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  /** ISO time a minute before Google's stated expiry. */
  expiresAt: string;
  email?: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64url to a UTF-8 string without relying on atob, Buffer or TextDecoder. */
export function base64UrlDecode(input: string): string {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('Invalid base64url');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join(''));
}

/** Reads the email claim from an id_token. No signature check: the token comes straight from Google over TLS. */
export function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== 'string') return undefined;
  const part = idToken.split('.')[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(part)) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export function parseTokenResponse(json: unknown, now: Date): GoogleTokens {
  const body = (json ?? {}) as Record<string, unknown>;
  if (body.error === 'invalid_grant') {
    throw new GoogleAuthError('invalid_grant', 'Google access was withdrawn.');
  }
  if (typeof body.error === 'string') {
    throw new GoogleAuthError('oauth_error', `Google token request failed: ${body.error}`);
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new GoogleAuthError('invalid_response', 'Google returned no access token.');
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in ?? 3600) || 3600;
  const tokens: GoogleTokens = {
    accessToken: body.access_token,
    expiresAt: new Date(now.getTime() + (expiresIn - 60) * 1000).toISOString(),
  };
  if (typeof body.refresh_token === 'string' && body.refresh_token) tokens.refreshToken = body.refresh_token;
  const email = emailFromIdToken(body.id_token);
  if (email) tokens.email = email;
  return tokens;
}

// ---------------------------------------------------------------------------
// Lessons as events
// ---------------------------------------------------------------------------

export interface SyncLesson {
  id: string;
  tutorId: string;
  studentNames: string[];
  tutorName: string;
  serviceName: string;
  /** ISO start time. */
  start: string;
  /** ISO end time. */
  end: string;
  location: 'online' | 'in-person';
  meetingUrl?: string | null;
  address?: string | null;
  status: string;
}

export interface CalendarEventBody {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { eliteLessonId: string } };
  conferenceData?: { createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } } };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** The Google event for a lesson. Only lesson facts appear: never family contact details or bank details. */
export function lessonToEvent(
  lesson: SyncLesson,
  audience: 'tutor' | 'admin',
  opts: { requestMeet: boolean; requestId?: string },
): CalendarEventBody {
  const names = lesson.studentNames.map(firstName).filter(Boolean).join(' & ') || 'Lesson';
  const summary = audience === 'tutor' ? `Elite Education: ${names}` : `${names} with ${lesson.tutorName}`;
  const lines = [lesson.serviceName, `Tutor: ${lesson.tutorName}`];
  if (lesson.meetingUrl) lines.push(`Join: ${lesson.meetingUrl}`);
  else if (lesson.address) lines.push(`Address: ${lesson.address}`);
  lines.push('', BRAND_FOOTER);
  const event: CalendarEventBody = {
    summary,
    description: lines.join('\n'),
    start: { dateTime: new Date(lesson.start).toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: new Date(lesson.end).toISOString(), timeZone: TIME_ZONE },
    extendedProperties: { private: { eliteLessonId: lesson.id } },
  };
  const location = lesson.meetingUrl || lesson.address;
  if (location) event.location = location;
  if (opts.requestMeet) {
    event.conferenceData = { createRequest: { requestId: opts.requestId ?? `elite-${lesson.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return event;
}

/** The events collection (no eventId) or one event, with sendUpdates=none so Google never emails anyone. */
export function eventUrl(calendarId: string, eventId?: string, opts: { conferenceData?: boolean; sendUpdates?: 'none' } = {}): string {
  let url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  if (eventId) url += `/${encodeURIComponent(eventId)}`;
  const params = new URLSearchParams();
  if (opts.conferenceData) params.set('conferenceDataVersion', '1');
  params.set('sendUpdates', opts.sendUpdates ?? 'none');
  return `${url}?${params.toString()}`;
}

export interface GoogleEventLike {
  id?: string;
  etag?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

export function meetLinkFromEvent(event: GoogleEventLike | null | undefined): string | undefined {
  if (!event) return undefined;
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video' && e.uri);
  return video?.uri;
}

// ---------------------------------------------------------------------------
// Free/busy
// ---------------------------------------------------------------------------

export interface Interval {
  start: string;
  end: string;
}

export function freeBusyRequest(calendarId: string, from: Date, days = 60) {
  return {
    timeMin: from.toISOString(),
    timeMax: new Date(from.getTime() + days * 86_400_000).toISOString(),
    timeZone: TIME_ZONE,
    items: [{ id: calendarId }],
  };
}

export function parseFreeBusy(json: unknown, calendarId: string): Interval[] {
  const body = (json ?? {}) as { calendars?: Record<string, { busy?: { start?: unknown; end?: unknown }[]; errors?: { reason?: string }[] }> };
  const cal = body.calendars?.[calendarId];
  if (!cal) throw new Error('Google returned no free/busy information for this calendar.');
  if (cal.errors && cal.errors.length) {
    throw new Error(`Google free/busy error: ${cal.errors.map((e) => e.reason ?? 'unknown').join(', ')}`);
  }
  return (cal.busy ?? [])
    .filter((b): b is { start: string; end: string } => typeof b.start === 'string' && typeof b.end === 'string')
    .map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() }));
}

/**
 * Removes from Google's busy periods the time covered by our own lessons. Free/busy merges the
 * lesson events we wrote with the tutor's personal events, and our lessons already block slots.
 */
export function subtractIntervals(busy: Interval[], own: Interval[]): Interval[] {
  const cuts = own
    .map((o) => ({ s: Date.parse(o.start), e: Date.parse(o.end) }))
    .filter((o) => o.e > o.s)
    .sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const b of busy) {
    let pieces = [{ s: Date.parse(b.start), e: Date.parse(b.end) }];
    for (const c of cuts) {
      const next: { s: number; e: number }[] = [];
      for (const p of pieces) {
        if (c.e <= p.s || c.s >= p.e) {
          next.push(p);
          continue;
        }
        if (c.s > p.s) next.push({ s: p.s, e: c.s });
        if (c.e < p.e) next.push({ s: c.e, e: p.e });
      }
      pieces = next;
    }
    out.push(...pieces.filter((p) => p.e > p.s));
  }
  return out
    .sort((a, b) => a.s - b.s || a.e - b.e)
    .map((p) => ({ start: new Date(p.s).toISOString(), end: new Date(p.e).toISOString() }));
}

// ---------------------------------------------------------------------------
// Which calendars hold which lesson
// ---------------------------------------------------------------------------

export interface SyncConnection {
  profileId: string;
  role: 'admin' | 'tutor';
  tutorId?: string | null;
  status: string;
}

export interface ExistingEvent {
  profileId: string;
  googleEventId: string;
  /** The Meet link this event created, if it created one. */
  meetUrl?: string | null;
}

const INACTIVE = ['cancelled', 'late-cancel'];

/** Connected calendars that should show the lesson. */
export function targetsFor<T extends SyncConnection>(lesson: { tutorId: string; status: string } | null, connections: T[]): T[] {
  if (!lesson || INACTIVE.includes(lesson.status)) return [];
  return connections.filter(
    (c) => c.status === 'connected' && (c.role === 'admin' || (c.role === 'tutor' && !!c.tutorId && c.tutorId === lesson.tutorId)),
  );
}

export function planTargets(
  lesson: { tutorId: string; status: string } | null,
  connections: SyncConnection[],
  existing: ExistingEvent[],
): { upsert: string[]; remove: ExistingEvent[] } {
  const upsert = targetsFor(lesson, connections).map((c) => c.profileId);
  const keep = new Set(upsert);
  return { upsert, remove: existing.filter((e) => !keep.has(e.profileId)) };
}

/**
 * The calendar that hosts a lesson's Google Meet: only the lesson tutor's own connected calendar (a tutor
 * profile first, then an admin who also teaches, such as Craig). Google makes the event's organiser the
 * host, and on personal accounts only the host can admit others, so a Meet must never be created on a
 * calendar belonging to someone who is not in the lesson. Without one, the lesson keeps no automatic link.
 */
export function organiserFor<T extends SyncConnection>(lesson: { tutorId: string }, targets: T[]): T | undefined {
  return (
    targets.find((t) => t.role === 'tutor' && !!t.tutorId && t.tutorId === lesson.tutorId) ??
    targets.find((t) => t.role === 'admin' && !!t.tutorId && t.tutorId === lesson.tutorId)
  );
}

export interface MeetPlan<T> {
  /** The calendar whose event should create a new Meet link, if any. */
  create?: T;
  /** The lesson's current link was generated by us on a calendar that no longer hosts the lesson: clear it. */
  clearStale: boolean;
}

/**
 * Whether to create, keep or clear the lesson's generated Meet link. `existing` carries the link each of our
 * events generated (meetUrl), so a link someone pasted by hand (Zoom, Teams) is never touched.
 */
export function meetPlan<T extends SyncConnection>(
  lesson: { tutorId: string; status: string; location: string; meetingUrl?: string | null } | null,
  targets: T[],
  existing: ExistingEvent[],
): MeetPlan<T> {
  if (!lesson || INACTIVE.includes(lesson.status)) return { clearStale: false };
  const organiser = lesson.location === 'online' ? organiserFor(lesson, targets) : undefined;
  const generated = lesson.meetingUrl ? existing.find((e) => !!e.meetUrl && e.meetUrl === lesson.meetingUrl) : undefined;
  const clearStale = !!generated && generated.profileId !== organiser?.profileId;
  const hasLink = !!lesson.meetingUrl && !clearStale;
  return { create: !hasLink ? organiser : undefined, clearStale };
}

/**
 * True when a lesson change must wait for the next run: a connected calendar that should hold (or lose) the
 * lesson could not be used this time, for example because Google could not be reached to refresh its token.
 */
export function mustWait(
  lesson: { tutorId: string; status: string } | null,
  unavailable: SyncConnection[],
  existing: ExistingEvent[],
): boolean {
  if (!unavailable.length) return false;
  if (targetsFor(lesson, unavailable).length) return true;
  const ids = new Set(unavailable.map((c) => c.profileId));
  return existing.some((e) => ids.has(e.profileId));
}

// ---------------------------------------------------------------------------
// Which busy times are ours
// ---------------------------------------------------------------------------

export interface CalendarLessonRow {
  tutorId: string;
  status: string;
  start: string;
  end: string;
  /** True when we have written this lesson into the calendar being read. */
  inCalendar: boolean;
}

const BLOCKING = ['scheduled', 'completed', 'no-show'];

/**
 * The lesson times to remove from a calendar's free/busy answer: every lesson we wrote into that calendar
 * (an office calendar holds every tutor's lessons) plus the tutor's own lessons, which already block slots.
 */
export function ownedIntervals(tutorId: string | null | undefined, rows: CalendarLessonRow[]): Interval[] {
  return rows
    .filter((r) => r.inCalendar || (!!tutorId && r.tutorId === tutorId && BLOCKING.includes(r.status)))
    .map((r) => ({ start: r.start, end: r.end }));
}

/** A tutor's Google busy blocks from one calendar's free/busy answer, without any lesson we put there. */
export function busyBlocksFor(busy: Interval[], tutorId: string | null | undefined, rows: CalendarLessonRow[]): Interval[] {
  return subtractIntervals(busy, ownedIntervals(tutorId, rows));
}

/** Merges overlapping or touching intervals, for a tutor whose busy times come from more than one calendar. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .map((i) => ({ s: Date.parse(i.start), e: Date.parse(i.end) }))
    .filter((i) => i.e > i.s)
    .sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out.map((i) => ({ start: new Date(i.s).toISOString(), end: new Date(i.e).toISOString() }));
}

// ---------------------------------------------------------------------------
// Running the sync
// ---------------------------------------------------------------------------

/**
 * Whether a call to calendar-sync carries the shared secret. The app's public key is a valid login token,
 * so the platform's own check is not enough. Compared in constant time; an unset secret refuses everyone.
 */
export function isAuthorisedSyncCall(provided: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || secret.length < 16 || typeof provided !== 'string') return false;
  let diff = provided.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) diff |= (provided.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** Lists the event we may already have written for a lesson (found by its private property), to avoid duplicates. */
export function findEventUrl(calendarId: string, lessonId: string): string {
  const params = new URLSearchParams({ privateExtendedProperty: `eliteLessonId=${lessonId}`, maxResults: '5', showDeleted: 'false' });
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
}

/** The first non-cancelled event id in an events.list answer. */
export function firstEventId(json: unknown): string | undefined {
  const items = ((json ?? {}) as { items?: { id?: unknown; status?: unknown }[] }).items ?? [];
  const hit = items.find((i) => typeof i.id === 'string' && i.status !== 'cancelled');
  return hit?.id as string | undefined;
}

/** The note shown on the calendar card once a lesson has failed to sync this many times. */
export const GIVE_UP_PREFIX = 'A lesson could not be written to your Google Calendar';

export function giveUpMessage(attempts: number): string {
  return `${GIVE_UP_PREFIX} after ${attempts} attempts. Please check the lesson, or disconnect and reconnect your calendar.`;
}

/** A healthy run clears the card's warning, except a recent give-up notice, which stays for a day. */
export function shouldClearError(lastError: string | null | undefined, updatedAt: string | null | undefined, now: Date): boolean {
  if (!lastError) return false;
  if (!lastError.startsWith(GIVE_UP_PREFIX)) return true;
  return !updatedAt || now.getTime() - Date.parse(updatedAt) > 24 * 3_600_000;
}

/** Google's answer for an event that no longer exists. */
export function isGoneStatus(status: number): boolean {
  return status === 404 || status === 410;
}
