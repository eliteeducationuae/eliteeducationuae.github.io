// Two-way Google Calendar sync. Schedule every 5 minutes (Dashboard → Edge Functions → Schedules, or pg_cron).
//
//  1. Writes queued lesson changes into each connected calendar (tutor: their own lessons; office: every
//     lesson), creating a Google Meet link for online lessons that have none.
//  2. Copies each connected tutor's Google busy times into busy_blocks, so families cannot request them.
//     Only start and end times are stored, never event titles.
//
// Never logs tokens and never emails or notifies anyone: Google is told sendUpdates=none throughout.
import { adminClient } from '../_shared/supabase.ts';
import {
  CALENDAR_API,
  eventUrl,
  freeBusyRequest,
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
  targetsFor,
} from '../_shared/google-calendar.ts';

const WITHDRAWN = 'Google access was withdrawn. Please reconnect your calendar.';
const MAX_ATTEMPTS = 5;
const BATCH = 200;

type Db = ReturnType<typeof adminClient>;

interface ConnectionRow {
  profile_id: string;
  calendar_id: string;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  status: string;
  profiles: { role: string; tutor_id: string | null; email: string | null } | null;
}

interface Live extends SyncConnection {
  calendarId: string;
  token: string;
  failed?: string;
}

const env = (name: string) => Deno.env.get(name) ?? '';
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** A Google API call with the connection's token. Returns the status and parsed body (if any). */
async function google(conn: Live, method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${conn.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

function googleError(r: { status: number; data: Record<string, unknown> }) {
  const err = r.data.error as { message?: string } | undefined;
  return new Error(`Google Calendar returned ${r.status}${err?.message ? `: ${err.message}` : ''}`);
}

/** A valid access token, refreshing (and saving) it when it expires within 60 seconds. */
async function accessToken(db: Db, row: ConnectionRow): Promise<string> {
  if (row.access_token && row.access_token_expires_at && new Date(row.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return row.access_token;
  }
  if (!row.refresh_token) throw new GoogleAuthError('invalid_grant', 'No refresh token');
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshBody({ refreshToken: row.refresh_token, clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') }),
  });
  const tokens = parseTokenResponse(await res.json(), new Date());
  await db
    .from('calendar_connections')
    .update({
      access_token: tokens.accessToken,
      access_token_expires_at: tokens.expiresAt,
      ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', row.profile_id);
  return tokens.accessToken;
}

/** Creates the event, or updates it in place; an update to an event Google no longer has becomes a fresh insert. */
async function upsertEvent(conn: Live, eventId: string | undefined, event: unknown, conferenceData: boolean) {
  if (eventId) {
    const r = await google(conn, 'PATCH', eventUrl(conn.calendarId, eventId, { conferenceData, sendUpdates: 'none' }), event);
    if (r.ok) return r.data;
    if (!isGoneStatus(r.status)) throw googleError(r);
  }
  const r = await google(conn, 'POST', eventUrl(conn.calendarId, undefined, { conferenceData, sendUpdates: 'none' }), event);
  if (!r.ok) throw googleError(r);
  return r.data;
}

async function loadSyncLesson(db: Db, lessonId: string) {
  const { data: l } = await db.from('lessons').select('*').eq('id', lessonId).maybeSingle();
  if (!l) return null;
  const [{ data: students }, { data: tutor }, { data: service }] = await Promise.all([
    db.from('students').select('id, full_name').in('id', l.student_ids as string[]),
    db.from('tutors').select('full_name').eq('id', l.tutor_id).maybeSingle(),
    db.from('services').select('name').eq('id', l.service_id).maybeSingle(),
  ]);
  const byId = new Map((students ?? []).map((s) => [s.id as string, s.full_name as string]));
  const lesson: SyncLesson = {
    id: l.id,
    tutorId: l.tutor_id,
    studentNames: (l.student_ids as string[]).map((id) => byId.get(id)).filter((n): n is string => !!n),
    tutorName: tutor?.full_name ?? 'Elite Education',
    serviceName: service?.name ?? 'Lesson',
    start: l.start_at,
    end: l.end_at,
    location: l.location,
    meetingUrl: l.meeting_url,
    address: l.address,
    status: l.status,
  };
  return lesson;
}

async function syncLesson(db: Db, lessonId: string, live: Live[]) {
  const lesson = await loadSyncLesson(db, lessonId);
  const { data: rows } = await db.from('lesson_calendar_events').select('profile_id, google_event_id, calendar_id').eq('lesson_id', lessonId);
  const existing = (rows ?? []).map((r) => ({ profileId: r.profile_id as string, googleEventId: r.google_event_id as string, calendarId: r.calendar_id as string }));
  const plan = planTargets(lesson, live, existing);
  const byProfile = new Map(live.map((c) => [c.profileId, c]));
  const eventFor = new Map(existing.map((e) => [e.profileId, e.googleEventId]));
  let written = 0;
  let removed = 0;

  const save = async (conn: Live, data: Record<string, unknown>) => {
    await db.from('lesson_calendar_events').upsert(
      {
        lesson_id: lessonId,
        profile_id: conn.profileId,
        google_event_id: data.id as string,
        calendar_id: conn.calendarId,
        etag: (data.etag as string | undefined) ?? null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'lesson_id,profile_id' },
    );
    written++;
  };

  if (lesson && plan.upsert.length) {
    const targets = targetsFor(lesson, live);
    const done = new Set<string>();
    // An online lesson with no link: the organiser's event creates a Google Meet link first.
    if (lesson.location === 'online' && !lesson.meetingUrl) {
      const organiser = organiserFor(lesson, targets);
      if (organiser) {
        const audience = organiser.role === 'admin' ? 'admin' : 'tutor';
        const data = await upsertEvent(organiser, eventFor.get(organiser.profileId), lessonToEvent(lesson, audience, { requestMeet: true }), true);
        await save(organiser, data);
        done.add(organiser.profileId);
        const link = meetLinkFromEvent(data);
        if (link) {
          lesson.meetingUrl = link;
          // This re-queues one harmless 'changed' row, which refreshes the organiser's description too.
          await db.from('lessons').update({ meeting_url: link }).eq('id', lesson.id);
        }
      }
    }
    for (const profileId of plan.upsert) {
      if (done.has(profileId)) continue;
      const conn = byProfile.get(profileId);
      if (!conn) continue;
      const audience = conn.role === 'admin' ? 'admin' : 'tutor';
      const data = await upsertEvent(conn, eventFor.get(profileId), lessonToEvent(lesson, audience, { requestMeet: false }), false);
      await save(conn, data);
    }
  }

  for (const r of plan.remove) {
    const conn = byProfile.get(r.profileId);
    const calendarId = existing.find((e) => e.profileId === r.profileId)?.calendarId ?? 'primary';
    if (conn) {
      const res = await google({ ...conn, calendarId }, 'DELETE', eventUrl(calendarId, r.googleEventId, { sendUpdates: 'none' }));
      if (!res.ok && !isGoneStatus(res.status)) throw googleError(res);
    } else if (!(await db.from('calendar_connections').select('profile_id').eq('profile_id', r.profileId).maybeSingle()).data) {
      // The calendar was disconnected; its events were tidied (or abandoned) then. Just forget the row.
    } else {
      // Connected but unusable right now (for example access withdrawn): keep the row and try again later.
      continue;
    }
    await db.from('lesson_calendar_events').delete().eq('lesson_id', lessonId).eq('profile_id', r.profileId);
    removed++;
  }
  return { written, removed };
}

Deno.serve(async () => {
  const db = adminClient();
  const summary = { connections: 0, withdrawn: 0, lessons: 0, eventsWritten: 0, eventsRemoved: 0, failed: 0, busyTutors: 0, busyBlocks: 0 };

  // (1) and (2): connections and a working token for each.
  const { data: rows, error } = await db
    .from('calendar_connections')
    .select('profile_id, calendar_id, refresh_token, access_token, access_token_expires_at, status, profiles(role, tutor_id, email)')
    .eq('status', 'connected');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const live: Live[] = [];
  for (const row of (rows ?? []) as unknown as ConnectionRow[]) {
    const role = row.profiles?.role;
    if (role !== 'admin' && role !== 'tutor') continue;
    summary.connections++;
    try {
      const token = await accessToken(db, row);
      live.push({ profileId: row.profile_id, role, tutorId: row.profiles?.tutor_id ?? null, status: 'connected', calendarId: row.calendar_id, token });
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === 'invalid_grant') {
        summary.withdrawn++;
        await db.from('calendar_connections').update({ status: 'error', last_error: WITHDRAWN, updated_at: new Date().toISOString() }).eq('profile_id', row.profile_id);
      } else {
        await db.from('calendar_connections').update({ last_error: 'We could not reach Google. We will try again shortly.' }).eq('profile_id', row.profile_id);
      }
    }
  }

  // (3) Queued lesson changes, one pass per lesson.
  const { data: queue } = await db
    .from('calendar_sync_queue')
    .select('id, lesson_id, attempts')
    .is('processed_at', null)
    .order('id')
    .limit(BATCH);
  const byLesson = new Map<string, { id: number; attempts: number }[]>();
  for (const q of queue ?? []) {
    const list = byLesson.get(q.lesson_id) ?? [];
    list.push({ id: q.id, attempts: q.attempts });
    byLesson.set(q.lesson_id, list);
  }
  const failedProfiles = new Set<string>();
  for (const [lessonId, items] of byLesson) {
    summary.lessons++;
    const ids = items.map((i) => i.id);
    try {
      const r = await syncLesson(db, lessonId, live);
      summary.eventsWritten += r.written;
      summary.eventsRemoved += r.removed;
      await db.from('calendar_sync_queue').update({ processed_at: new Date().toISOString(), last_error: null }).in('id', ids);
    } catch (e) {
      summary.failed++;
      const attempts = Math.max(...items.map((i) => i.attempts)) + 1;
      await db
        .from('calendar_sync_queue')
        .update({ attempts, last_error: short(e), ...(attempts >= MAX_ATTEMPTS ? { processed_at: new Date().toISOString() } : {}) })
        .in('id', ids);
      console.error('calendar-sync: lesson sync failed', lessonId, short(e));
    }
  }

  // (4) Busy times for each connected tutor calendar.
  const now = new Date();
  for (const conn of live) {
    if (!conn.tutorId) continue;
    try {
      const request = freeBusyRequest(conn.calendarId, now, 60);
      const r = await google(conn, 'POST', `${CALENDAR_API}/freeBusy`, request);
      if (!r.ok) throw googleError(r);
      const busy = parseFreeBusy(r.data, conn.calendarId);
      const { data: own } = await db
        .from('lessons')
        .select('start_at, end_at')
        .eq('tutor_id', conn.tutorId)
        .in('status', ['scheduled', 'completed', 'no-show'])
        .lt('start_at', request.timeMax)
        .gt('end_at', request.timeMin);
      const blocks = subtractIntervals(busy, (own ?? []).map((l) => ({ start: l.start_at, end: l.end_at })));
      await db.from('busy_blocks').delete().eq('tutor_id', conn.tutorId).eq('source', 'google');
      if (blocks.length) {
        const { error: insertError } = await db
          .from('busy_blocks')
          .insert(blocks.map((b) => ({ tutor_id: conn.tutorId, start_at: b.start, end_at: b.end, source: 'google' })));
        if (insertError) throw new Error(insertError.message);
      }
      summary.busyTutors++;
      summary.busyBlocks += blocks.length;
    } catch (e) {
      failedProfiles.add(conn.profileId);
      await db.from('calendar_connections').update({ last_error: 'We could not read your busy times from Google. We will try again shortly.' }).eq('profile_id', conn.profileId);
      console.error('calendar-sync: free/busy failed', conn.profileId, short(e));
    }
  }

  // (5) Mark healthy connections as synced.
  const healthy = live.map((c) => c.profileId).filter((id) => !failedProfiles.has(id));
  if (healthy.length) {
    await db.from('calendar_connections').update({ last_synced_at: new Date().toISOString(), last_error: null }).in('profile_id', healthy);
  }

  // (6) Summary.
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
