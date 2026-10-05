// Two-way Google Calendar sync. Schedule every 5 minutes (pg_cron, see the README); every call must carry the
// x-sync-secret header matching the CALENDAR_SYNC_SECRET secret, and only one run works at a time.
//
//  1. Writes queued lesson changes into each connected calendar (tutor: their own lessons; office: every
//     lesson). An online lesson with no link receives a Google Meet link, created only on the lesson tutor's
//     own calendar so that the person hosting the Meet is the person teaching. A link we generated is cleared
//     and recreated when the lesson moves to another tutor.
//  2. Copies each connected tutor's Google busy times into busy_blocks, so families cannot request them.
//     Only start and end times are stored, never event titles. Lessons we wrote are never counted as busy.
//
// If a connected calendar cannot be reached (for example Google is briefly unavailable), the lesson changes
// it needs stay queued for the next run rather than being lost. A calendar whose token Google refuses to renew
// is marked as needing to be reconnected instead, so it never holds back lessons for the other calendars.
// A Meet that Google has accepted but not yet created is checked again on the next run.
//
// Never logs tokens and never emails or notifies anyone: Google is told sendUpdates=none throughout.
import { adminClient, json } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';
import {
  busyBlocksFor,
  type CalendarLessonRow,
  CALENDAR_API,
  conferencePending,
  eventUrl,
  findEventUrl,
  firstEventId,
  freeBusyRequest,
  giveUpMessage,
  GOOGLE_TOKEN_URL,
  GoogleAuthError,
  type Interval,
  isAuthorisedSyncCall,
  isGoneStatus,
  lessonToEvent,
  meetLinkFromEvent,
  meetPlan,
  mergeIntervals,
  mustWait,
  parseFreeBusy,
  parseTokenResponse,
  planTargets,
  RECONNECT,
  refreshBody,
  shouldClearError,
  type SyncConnection,
  type SyncLesson,
  targetsFor,
  tokenFailure,
} from '../_shared/google-calendar.ts';

const WITHDRAWN = 'Google access was withdrawn. Please reconnect your calendar.';
const MAX_ATTEMPTS = 5;
const BATCH = 300;
/** Longer than any single run can last, so a crashed run frees the lease on its own. */
const LEASE_SECONDS = 600;
const PRUNE_AFTER_DAYS = 30;
const UNREACHABLE = 'We could not reach Google. We will try again shortly.';

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
  // Google itself is struggling: try again next run rather than asking the person to reconnect.
  if (res.status >= 500 || res.status === 429) {
    await res.body?.cancel();
    throw new Error(`Google's token service returned ${res.status}`);
  }
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

/** A failure while writing to one calendar, so a lesson that keeps failing can be reported on that calendar's card. */
class CalendarWriteError extends Error {
  readonly profileId: string;
  constructor(profileId: string, message: string) {
    super(message);
    this.profileId = profileId;
  }
}

/**
 * Creates the event, or updates it in place; an update to an event Google no longer has becomes a fresh insert.
 * Before inserting, looks for an event we already wrote for the lesson (a run that stopped before recording it),
 * so a lesson never appears twice in one calendar.
 */
async function upsertEvent(conn: Live, lessonId: string, eventId: string | undefined, event: unknown, conferenceData: boolean) {
  const opts = { conferenceData, sendUpdates: 'none' as const };
  const patch = async (id: string) => {
    const r = await google(conn, 'PATCH', eventUrl(conn.calendarId, id, opts), event);
    if (r.ok) return r.data;
    if (!isGoneStatus(r.status)) throw new CalendarWriteError(conn.profileId, googleError(r).message);
    return null;
  };
  if (eventId) {
    const data = await patch(eventId);
    if (data) return data;
  }
  const found = await google(conn, 'GET', findEventUrl(conn.calendarId, lessonId));
  const orphan = found.ok ? firstEventId(found.data) : undefined;
  if (orphan && orphan !== eventId) {
    const data = await patch(orphan);
    if (data) return data;
  }
  const r = await google(conn, 'POST', eventUrl(conn.calendarId, undefined, opts), event);
  if (!r.ok) throw new CalendarWriteError(conn.profileId, googleError(r).message);
  return r.data;
}

async function deleteEvent(conn: Live, calendarId: string, eventId: string) {
  const res = await google({ ...conn, calendarId }, 'DELETE', eventUrl(calendarId, eventId, { sendUpdates: 'none' }));
  if (!res.ok && !isGoneStatus(res.status)) throw new CalendarWriteError(conn.profileId, googleError(res).message);
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

async function syncLesson(db: Db, lessonId: string, live: Live[], unavailable: SyncConnection[]) {
  const lesson = await loadSyncLesson(db, lessonId);
  const { data: rows } = await db
    .from('lesson_calendar_events')
    .select('profile_id, google_event_id, calendar_id, meet_url')
    .eq('lesson_id', lessonId);
  const existing = (rows ?? []).map((r) => ({
    profileId: r.profile_id as string,
    googleEventId: r.google_event_id as string,
    calendarId: r.calendar_id as string,
    meetUrl: (r.meet_url as string | null) ?? null,
  }));
  const waiting = mustWait(lesson, unavailable, existing);
  const plan = planTargets(lesson, live, existing);
  const byProfile = new Map(live.map((c) => [c.profileId, c]));
  const eventFor = new Map(existing.map((e) => [e.profileId, e.googleEventId]));
  let written = 0;
  let removed = 0;
  /** Google accepted the Meet request but has not created it yet: check this lesson again next run. */
  let meetPending = false;

  /** Records our event. meetUrl: a link this event created, null to forget one, undefined to leave as it is. */
  const save = async (conn: Live, data: Record<string, unknown>, meetUrl?: string | null) => {
    await db.from('lesson_calendar_events').upsert(
      {
        lesson_id: lessonId,
        profile_id: conn.profileId,
        google_event_id: data.id as string,
        calendar_id: conn.calendarId,
        etag: (data.etag as string | undefined) ?? null,
        ...(meetUrl !== undefined ? { meet_url: meetUrl } : {}),
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'lesson_id,profile_id' },
    );
    written++;
  };

  if (lesson && plan.upsert.length) {
    const targets = targetsFor(lesson, live);
    const meet = meetPlan(lesson, targets, existing);
    const fresh = new Set<string>();
    if (meet.clearStale) {
      // The link was hosted by a calendar that no longer hosts this lesson (reassigned, covered, or now in person).
      // Clear it, and replace that calendar's event so its old Meet does not linger there either.
      const stale = existing.find((e) => e.meetUrl && e.meetUrl === lesson.meetingUrl);
      const staleConn = stale ? byProfile.get(stale.profileId) : undefined;
      if (stale && staleConn && plan.upsert.includes(stale.profileId)) {
        await deleteEvent(staleConn, stale.calendarId, stale.googleEventId);
        eventFor.delete(stale.profileId);
        fresh.add(stale.profileId);
      }
      lesson.meetingUrl = null;
      await db.from('lessons').update({ meeting_url: null }).eq('id', lesson.id);
    }
    const done = new Set<string>();
    if (meet.create) {
      const organiser = byProfile.get(meet.create.profileId)!;
      const audience = organiser.role === 'admin' ? 'admin' : 'tutor';
      const priorId = eventFor.get(organiser.profileId);
      let data: Record<string, unknown> | null = null;
      if (priorId) {
        // A Meet asked for on an earlier run may still be on its way: look before asking for another one.
        const prior = await google(organiser, 'GET', eventUrl(organiser.calendarId, priorId, { conferenceData: true }));
        if (prior.ok && (conferencePending(prior.data) || meetLinkFromEvent(prior.data))) data = prior.data;
      }
      if (!data) {
        const requestId = `elite-${lesson.id}-${Date.now().toString(36)}`;
        data = await upsertEvent(organiser, lesson.id, priorId, lessonToEvent(lesson, audience, { requestMeet: true, requestId }), true);
      }
      const link = meetLinkFromEvent(data);
      await save(organiser, data, link ?? null);
      done.add(organiser.profileId);
      if (!link && conferencePending(data)) meetPending = true;
      if (link) {
        lesson.meetingUrl = link;
        // This re-queues one harmless 'changed' row, which refreshes every calendar's description with the link.
        await db.from('lessons').update({ meeting_url: link }).eq('id', lesson.id);
      }
    }
    for (const profileId of plan.upsert) {
      if (done.has(profileId)) continue;
      const conn = byProfile.get(profileId);
      if (!conn) continue;
      const audience = conn.role === 'admin' ? 'admin' : 'tutor';
      const data = await upsertEvent(conn, lesson.id, eventFor.get(profileId), lessonToEvent(lesson, audience, { requestMeet: false }), false);
      await save(conn, data, fresh.has(profileId) ? null : undefined);
    }
  }

  for (const r of plan.remove) {
    const conn = byProfile.get(r.profileId);
    const calendarId = existing.find((e) => e.profileId === r.profileId)?.calendarId ?? 'primary';
    if (conn) {
      await deleteEvent(conn, calendarId, r.googleEventId);
    } else if (!(await db.from('calendar_connections').select('profile_id').eq('profile_id', r.profileId).maybeSingle()).data) {
      // The calendar was disconnected; its events were tidied (or abandoned) then. Just forget the row.
    } else {
      // Connected but unusable right now: keep the row. A reconnect queues this lesson again (see
      // queue_calendar_backfill), and a calendar that is only briefly unreachable keeps the change queued.
      continue;
    }
    await db.from('lesson_calendar_events').delete().eq('lesson_id', lessonId).eq('profile_id', r.profileId);
    removed++;
  }
  return { written, removed, waiting, meetPending };
}

/** Every lesson in the window that matters to one calendar's busy times (paged: an office calendar holds many). */
async function calendarLessons(db: Db, profileId: string, from: string, to: string): Promise<CalendarLessonRow[]> {
  const out: CalendarLessonRow[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await db
      .rpc('calendar_lessons_for', { p_profile: profileId, p_from: from, p_to: to })
      .range(offset, offset + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { tutor_id: string; status: string; start_at: string; end_at: string; in_calendar: boolean }[];
    out.push(...rows.map((r) => ({ tutorId: r.tutor_id, status: r.status, start: r.start_at, end: r.end_at, inCalendar: r.in_calendar })));
    if (rows.length < page) return out;
  }
}

async function run(db: Db) {
  const summary = {
    connections: 0,
    withdrawn: 0,
    unreachable: 0,
    lessons: 0,
    waiting: 0,
    meetPending: 0,
    eventsWritten: 0,
    eventsRemoved: 0,
    failed: 0,
    busyTutors: 0,
    busyBlocks: 0,
    pruned: 0,
  };
  const now = new Date();

  // (1) and (2): connections and a working token for each.
  const { data: rows, error } = await db
    .from('calendar_connections')
    .select('profile_id, calendar_id, refresh_token, access_token, access_token_expires_at, status, profiles(role, tutor_id, email)')
    .eq('status', 'connected');
  if (error) return json({ error: error.message }, 500);

  const live: Live[] = [];
  /** Connected calendars we could not use this run; changes they need stay queued. */
  const unavailable: SyncConnection[] = [];
  for (const row of (rows ?? []) as unknown as ConnectionRow[]) {
    const role = row.profiles?.role;
    if (role !== 'admin' && role !== 'tutor') continue;
    summary.connections++;
    const base = { profileId: row.profile_id, role, tutorId: row.profiles?.tutor_id ?? null, status: 'connected' } as const;
    try {
      const token = await accessToken(db, row);
      live.push({ ...base, calendarId: row.calendar_id, token });
    } catch (e) {
      const failure = tokenFailure(e);
      if (failure !== 'unreachable') {
        // Withdrawn, or refused for another reason: the person must reconnect. Not added to `unavailable`, so
        // lessons for the other calendars carry on rather than waiting for this one.
        summary.withdrawn++;
        await db
          .from('calendar_connections')
          .update({ status: 'error', last_error: failure === 'withdrawn' ? WITHDRAWN : RECONNECT, updated_at: now.toISOString() })
          .eq('profile_id', row.profile_id);
        console.error('calendar-sync: token refused', row.profile_id, e instanceof GoogleAuthError ? e.code : 'unknown');
      } else {
        summary.unreachable++;
        unavailable.push(base);
        await db.from('calendar_connections').update({ last_error: UNREACHABLE }).eq('profile_id', row.profile_id);
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
  const gaveUp = new Map<string, number>();
  for (const [lessonId, items] of byLesson) {
    summary.lessons++;
    const ids = items.map((i) => i.id);
    try {
      const r = await syncLesson(db, lessonId, live, unavailable);
      summary.eventsWritten += r.written;
      summary.eventsRemoved += r.removed;
      if (r.waiting) {
        // Leave the rows queued (without counting an attempt) until every calendar involved can be reached.
        summary.waiting++;
        continue;
      }
      if (r.meetPending) {
        // Keep the rows queued so the next run collects the link; give up quietly after MAX_ATTEMPTS runs.
        summary.meetPending++;
        const attempts = Math.max(...items.map((i) => i.attempts)) + 1;
        await db
          .from('calendar_sync_queue')
          .update({
            attempts,
            last_error: 'Google is still creating the Meet link.',
            ...(attempts >= MAX_ATTEMPTS ? { processed_at: new Date().toISOString() } : {}),
          })
          .in('id', ids);
        continue;
      }
      await db.from('calendar_sync_queue').update({ processed_at: new Date().toISOString(), last_error: null }).in('id', ids);
    } catch (e) {
      summary.failed++;
      const attempts = Math.max(...items.map((i) => i.attempts)) + 1;
      await db
        .from('calendar_sync_queue')
        .update({ attempts, last_error: short(e), ...(attempts >= MAX_ATTEMPTS ? { processed_at: new Date().toISOString() } : {}) })
        .in('id', ids);
      if (e instanceof CalendarWriteError && attempts >= MAX_ATTEMPTS) gaveUp.set(e.profileId, attempts);
      console.error('calendar-sync: lesson sync failed', lessonId, short(e));
    }
  }
  // A lesson that has failed repeatedly is shown on that calendar's card, so it is not lost silently.
  for (const [profileId, attempts] of gaveUp) {
    failedProfiles.add(profileId);
    await db
      .from('calendar_connections')
      .update({ last_error: giveUpMessage(attempts), updated_at: new Date().toISOString() })
      .eq('profile_id', profileId);
  }

  // (4) Busy times for each connected tutor, from every calendar that tutor has connected (normally one).
  const byTutor = new Map<string, Live[]>();
  for (const conn of live) {
    if (!conn.tutorId) continue;
    byTutor.set(conn.tutorId, [...(byTutor.get(conn.tutorId) ?? []), conn]);
  }
  for (const [tutorId, conns] of byTutor) {
    const blocks: Interval[] = [];
    let complete = !unavailable.some((u) => u.tutorId === tutorId);
    for (const conn of conns) {
      try {
        const body = freeBusyRequest(conn.calendarId, now, 60);
        const r = await google(conn, 'POST', `${CALENDAR_API}/freeBusy`, body);
        if (!r.ok) throw googleError(r);
        const busy = parseFreeBusy(r.data, conn.calendarId);
        // Remove every lesson we wrote into this calendar (an office calendar holds every tutor's lessons),
        // as well as the tutor's own lessons, which block their slots already.
        const lessons = await calendarLessons(db, conn.profileId, body.timeMin, body.timeMax);
        blocks.push(...busyBlocksFor(busy, tutorId, lessons));
      } catch (e) {
        complete = false;
        failedProfiles.add(conn.profileId);
        await db
          .from('calendar_connections')
          .update({ last_error: 'We could not read your busy times from Google. We will try again shortly.' })
          .eq('profile_id', conn.profileId);
        console.error('calendar-sync: free/busy failed', conn.profileId, short(e));
      }
    }
    // Replace a tutor's blocks only with a complete picture; otherwise keep the last good one.
    if (!complete) continue;
    const merged = mergeIntervals(blocks);
    try {
      await db.from('busy_blocks').delete().eq('tutor_id', tutorId).eq('source', 'google');
      if (merged.length) {
        const { error: insertError } = await db
          .from('busy_blocks')
          .insert(merged.map((b) => ({ tutor_id: tutorId, start_at: b.start, end_at: b.end, source: 'google' })));
        if (insertError) throw new Error(insertError.message);
      }
      summary.busyTutors++;
      summary.busyBlocks += merged.length;
    } catch (e) {
      for (const c of conns) failedProfiles.add(c.profileId);
      console.error('calendar-sync: saving busy times failed', tutorId, short(e));
    }
  }

  // (5) Mark healthy connections as synced, clearing old warnings (a recent give-up notice stays for a day).
  const healthy = live.map((c) => c.profileId).filter((id) => !failedProfiles.has(id));
  if (healthy.length) {
    const stamp = new Date().toISOString();
    await db.from('calendar_connections').update({ last_synced_at: stamp }).in('profile_id', healthy);
    const { data: warned } = await db
      .from('calendar_connections')
      .select('profile_id, last_error, updated_at')
      .in('profile_id', healthy)
      .not('last_error', 'is', null);
    const clear = (warned ?? []).filter((w) => shouldClearError(w.last_error, w.updated_at, now)).map((w) => w.profile_id as string);
    if (clear.length) await db.from('calendar_connections').update({ last_error: null }).in('profile_id', clear);
  }

  // (6) Housekeeping: forget processed queue rows after 30 days.
  const cutoff = new Date(now.getTime() - PRUNE_AFTER_DAYS * 86_400_000).toISOString();
  const { count } = await db.from('calendar_sync_queue').delete({ count: 'exact' }).lt('processed_at', cutoff);
  summary.pruned = count ?? 0;

  return json(summary);
}

Deno.serve(withMonitoring('calendar-sync', adminClient, async (req) => {
  // The app's public key is itself a valid login token, so the platform's JWT check is not enough on its own.
  if (!isAuthorisedSyncCall(req.headers.get('x-sync-secret'), env('CALENDAR_SYNC_SECRET'))) {
    return json({ error: 'Not authorised.' }, 401);
  }
  const db = adminClient();
  const runId = crypto.randomUUID();
  const { data: acquired, error } = await db.rpc('calendar_sync_acquire', { p_holder: runId, p_seconds: LEASE_SECONDS });
  if (error) return json({ error: error.message }, 500);
  // Overlapping runs would write the same queued lessons twice; the later one simply stands aside.
  if (!acquired) return json({ skipped: 'Another calendar sync is already running.' });
  try {
    return await run(db);
  } finally {
    await db.rpc('calendar_sync_release', { p_holder: runId });
  }
}));
