// Connects a tutor's or the office's Google Calendar, and disconnects it again.
//
//   POST { action: 'start', returnTo?: string }  (signed in)  -> { url }        the Google consent screen
//   POST { action: 'disconnect' }                (signed in)  -> { ok: true }
//   GET  ?code=…&state=…                         (Google's redirect, no login) -> redirect back to the app
//
// verify_jwt is off for this function (see config.toml) because Google redirects back without a
// login; start and disconnect check the caller's session themselves. Tokens never leave the server.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';
import { refuseViewAs } from '../_shared/view-as.ts';
import {
  BRAND_FOOTER,
  buildAuthUrl,
  eventUrl,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GoogleAuthError,
  isGoneStatus,
  parseTokenResponse,
  refreshBody,
  tokenExchangeBody,
} from '../_shared/google-calendar.ts';

const STATE_TTL_MS = 15 * 60_000;
const DEFAULT_RETURN = 'https://eliteeducationuae.github.io/app';

const env = (name: string) => Deno.env.get(name) ?? '';
const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/google-connect`;

/** Only our own app may receive the result, so the redirect cannot be used to bounce people elsewhere. */
function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const allowed = [
    env('APP_URL'),
    ...env('CALENDAR_RETURN_URLS').split(','),
    DEFAULT_RETURN,
    'eliteeducation://',
  ]
    .map((p) => p.trim())
    .filter(Boolean);
  // The prefix must end at a path, query or fragment boundary, so https://app.example cannot admit https://app.example.evil.
  const matches = (prefix: string) => {
    if (!value.startsWith(prefix)) return false;
    const next = value.charAt(prefix.length);
    return prefix.endsWith('/') || next === '' || next === '/' || next === '?' || next === '#';
  };
  return allowed.some(matches) ? value : null;
}

function withResult(returnTo: string, query: string) {
  return `${returnTo}${returnTo.includes('?') ? '&' : '?'}${query}`;
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small branded page for when there is no app to return to. */
function page(title: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | Elite Education</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F9F8F5; color: #0A0A0A;
         font-family: Calibri, Carlito, 'Segoe UI', sans-serif; }
  main { max-width: 440px; padding: 48px 24px; text-align: center; }
  .rule { width: 48px; height: 2px; background: #C9A84C; margin: 0 auto 28px; }
  h1 { font-family: Georgia, Gelasio, serif; font-weight: normal; font-size: 28px; margin: 0 0 16px; }
  p { font-size: 17px; line-height: 1.55; margin: 0; color: #0A0A0A; }
  footer { margin-top: 40px; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: #5F5F5F; }
</style></head>
<body><main><div class="rule"></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><footer>${escapeHtml(BRAND_FOOTER)}</footer></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Shown when an attempt fails for someone who is already connected: the failed attempt changed nothing. */
const KEPT = 'Your existing connection remains in place.';

/** kept: the person already had a connection, which this failed attempt has left untouched. */
function failure(returnTo: string | null, reason: 'denied' | 'exchange' | 'expired', kept = false) {
  if (returnTo) return redirect(withResult(returnTo, `calendar=error&reason=${reason}${kept ? '&kept=1' : ''}`));
  const body =
    (reason === 'denied'
      ? 'Access to Google Calendar was not granted. You may close this window and try again from the app whenever you wish.'
      : reason === 'expired'
        ? 'This connection link has expired. Please close this window and start again from the app.'
        : 'We were unable to complete the connection with Google. Please close this window and try again from the app.') +
    (kept ? ` ${KEPT}` : '');
  return page('Google Calendar not connected', body, 400);
}

// ---------------------------------------------------------------------------
// Google's redirect back to us
// ---------------------------------------------------------------------------

async function handleCallback(url: URL) {
  const db = adminClient();
  const stateId = url.searchParams.get('state');
  let returnTo: string | null = null;
  let profileId: string | null = null;
  if (stateId && /^[0-9a-f-]{36}$/i.test(stateId)) {
    const { data: state } = await db.from('calendar_oauth_states').select('*').eq('state', stateId).maybeSingle();
    if (state) {
      await db.from('calendar_oauth_states').delete().eq('state', stateId);
      returnTo = safeReturnTo(state.return_to);
      if (Date.now() - new Date(state.created_at).getTime() <= STATE_TTL_MS) profileId = state.profile_id;
      else return failure(returnTo, 'expired');
    }
  }
  const hasConnection = async () =>
    !!profileId && !!(await db.from('calendar_connections').select('profile_id').eq('profile_id', profileId).maybeSingle()).data;
  if (url.searchParams.get('error')) return failure(returnTo, 'denied', await hasConnection());
  const code = url.searchParams.get('code');
  if (!profileId || !code) return failure(returnTo, 'expired');

  let tokens;
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenExchangeBody({ code, clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET'), redirectUri: redirectUri() }),
    });
    tokens = parseTokenResponse(await res.json(), new Date());
  } catch (e) {
    console.error('google-connect: token exchange failed', e instanceof GoogleAuthError ? e.code : 'network');
    return failure(returnTo, 'exchange', await hasConnection());
  }

  const { data: previous } = await db.from('calendar_connections').select('refresh_token').eq('profile_id', profileId).maybeSingle();
  const refreshToken = tokens.refreshToken ?? previous?.refresh_token ?? null;
  if (!refreshToken) return failure(returnTo, 'exchange', !!previous);
  const { error } = await db.from('calendar_connections').upsert(
    {
      profile_id: profileId,
      provider: 'google',
      google_email: tokens.email ?? null,
      calendar_id: 'primary',
      refresh_token: refreshToken,
      access_token: tokens.accessToken,
      access_token_expires_at: tokens.expiresAt,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );
  if (error) {
    console.error('google-connect: could not save the connection', error.message);
    return failure(returnTo, 'exchange');
  }
  await db.rpc('queue_calendar_backfill', { p_profile: profileId });

  if (returnTo) return redirect(withResult(returnTo, 'calendar=connected'));
  return page('Google Calendar connected', 'Your lessons will appear in your calendar within a few minutes. You may now close this window.');
}

// ---------------------------------------------------------------------------
// Signed-in actions
// ---------------------------------------------------------------------------

async function startConnect(profile: { id: string; email: string | null }, body: Record<string, unknown>) {
  const db = adminClient();
  const clientId = env('GOOGLE_CLIENT_ID');
  if (!clientId || !env('GOOGLE_CLIENT_SECRET')) return json({ error: 'Google Calendar is not configured yet.' }, 503);
  await db.from('calendar_oauth_states').delete().lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString());
  const { data: state, error } = await db
    .from('calendar_oauth_states')
    .insert({ profile_id: profile.id, return_to: safeReturnTo(body.returnTo) })
    .select('state')
    .single();
  if (error || !state) return json({ error: 'We could not start the connection. Please try again.' }, 500);
  return json({ url: buildAuthUrl({ clientId, redirectUri: redirectUri(), state: state.state, loginHint: profile.email }) });
}

async function accessTokenFor(conn: { refresh_token: string | null; access_token: string | null; access_token_expires_at: string | null }) {
  if (conn.access_token && conn.access_token_expires_at && new Date(conn.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return conn.access_token;
  }
  if (!conn.refresh_token) return null;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshBody({ refreshToken: conn.refresh_token, clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') }),
  });
  return parseTokenResponse(await res.json(), new Date()).accessToken;
}

async function disconnect(profile: { id: string; tutor_id: string | null }) {
  const db = adminClient();
  const { data: conn } = await db.from('calendar_connections').select('*').eq('profile_id', profile.id).maybeSingle();
  if (conn) {
    // Best effort: tidy the lesson events out of their calendar and withdraw our access.
    try {
      const token = await accessTokenFor(conn);
      if (token) {
        const { data: events } = await db.from('lesson_calendar_events').select('lesson_id, google_event_id, calendar_id').eq('profile_id', profile.id);
        const ids = (events ?? []).map((e) => e.lesson_id);
        const { data: future } = ids.length
          ? await db.from('lessons').select('id').in('id', ids).gte('start_at', new Date().toISOString())
          : { data: [] as { id: string }[] };
        const upcoming = new Set((future ?? []).map((l) => l.id));
        for (const e of events ?? []) {
          if (!upcoming.has(e.lesson_id)) continue;
          const res = await fetch(eventUrl(e.calendar_id, e.google_event_id, { sendUpdates: 'none' }), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok && !isGoneStatus(res.status)) console.error('google-connect: could not delete an event', res.status);
          await res.body?.cancel();
        }
      }
      const revokeWith = conn.refresh_token ?? token;
      if (revokeWith) {
        const res = await fetch(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: revokeWith }),
        });
        await res.body?.cancel();
      }
    } catch (e) {
      console.error('google-connect: cleanup at Google was incomplete', e instanceof GoogleAuthError ? e.code : 'network');
    }
  }
  // The Meets this calendar created for upcoming lessons belong to its account and go with it: clear those links,
  // so families never get a dead link. A link someone pasted by hand is not ours (no meet_url) and stays. Clearing
  // re-queues the lesson, so another connected calendar of the lesson tutor can give it a fresh Meet.
  const { data: generated } = await db
    .from('lesson_calendar_events')
    .select('lesson_id, meet_url')
    .eq('profile_id', profile.id)
    .not('meet_url', 'is', null);
  const nowIso = new Date().toISOString();
  for (const g of generated ?? []) {
    await db
      .from('lessons')
      .update({ meeting_url: null })
      .eq('id', g.lesson_id)
      .eq('meeting_url', g.meet_url)
      .eq('status', 'scheduled')
      .gte('start_at', nowIso);
  }
  await db.from('lesson_calendar_events').delete().eq('profile_id', profile.id);
  await db.from('calendar_connections').delete().eq('profile_id', profile.id);
  if (profile.tutor_id) {
    const { data: others } = await db.from('profiles').select('id').eq('tutor_id', profile.tutor_id).neq('id', profile.id);
    const otherIds = (others ?? []).map((p) => p.id);
    const { count } = otherIds.length
      ? await db.from('calendar_connections').select('profile_id', { count: 'exact', head: true }).in('profile_id', otherIds).eq('status', 'connected')
      : { count: 0 };
    if (!count) await db.from('busy_blocks').delete().eq('tutor_id', profile.tutor_id);
  }
  return json({ ok: true });
}

Deno.serve(withMonitoring('google-connect', adminClient, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET') return handleCallback(url);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
  // A View as session (read only) cannot connect or disconnect a calendar. The callback above needs no session.
  const refused = await refuseViewAs(req);
  if (refused) return refused;
  const { data: profile } = await adminClient().from('profiles').select('id, role, email, tutor_id').eq('id', auth.user.id).maybeSingle();
  if (!profile || !['tutor', 'admin'].includes(profile.role)) {
    return json({ error: 'Google Calendar is available to tutors and the office only.' }, 403);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === 'start') return startConnect(profile, body);
  if (body.action === 'disconnect') return disconnect(profile);
  return json({ error: 'Unknown action' }, 400);
}));
