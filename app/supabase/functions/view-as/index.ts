// Admin "View as" (read only): lets the office see the app exactly as a parent, student or tutor sees it.
//   POST { profileId }  (a signed-in admin's own token)
//     -> 200 { viewId, accessToken, refreshToken, expiresAt }   tokens for a session as that person, bound to a view
//     -> { error } with 400, 401, 403, 404, 409 or 500
//
// How it works: with the service-role key (which never leaves this function) we create a magic-link token for the
// person through the auth admin API (generateLink sends no email), verify it here with a throwaway client to get a
// fresh session as them, and bind that session's id to a view_as_sessions row with begin_view_as. Only then are the
// tokens returned. From that moment every request made with them passes through the database guard
// (public.view_as_guard): reads only, refused entirely once the view has ended or after 60 minutes.
//
// Binding on the server before the tokens leave this function is deliberate. If the app exchanged the token and
// bound the session afterwards, there would be a window in which the admin held a normal, writable session as the
// person. Here there is none: if binding fails, the new session is revoked and nothing is returned.
//
// Never log tokens or email addresses here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { refuseViewAs } from '../_shared/view-as.ts';
import {
  ADMIN_ONLY_MESSAGE,
  NO_LOGIN_MESSAGE,
  VIEW_MINUTES,
  parseStartBody,
  sessionIdFromJwt,
  startResponse,
} from '../_shared/view-as-core.ts';

const FAILED = 'The view could not be started. Please try again.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    // 1. The caller must be signed in.
    const supabase = userClient(req);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);

    // 2. Views cannot be nested: a view session cannot start another view.
    const refused = await refuseViewAs(req);
    if (refused) return refused;

    // 3. Only the office may view as someone else.
    const { data: me } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ error: ADMIN_ONLY_MESSAGE }, 403);

    // 4. Who to view.
    const parsed = parseStartBody(await req.json().catch(() => null));
    if ('error' in parsed) return json({ error: parsed.error }, 400);
    const { profileId } = parsed;

    // 5. The person must exist, be a parent, student or tutor, and have a login with an email address.
    const admin = adminClient();
    const { data: target } = await admin.from('profiles').select('id, role').eq('id', profileId).maybeSingle();
    if (!target) return json({ error: 'This person was not found.' }, 404);
    if (!['parent', 'student', 'tutor'].includes(target.role) || target.id === auth.user.id) {
      return json({ error: 'Only parents, students and tutors can be viewed.' }, 400);
    }
    const { data: found, error: userError } = await admin.auth.admin.getUserById(profileId);
    const email = found?.user?.email;
    if (userError || !email) return json({ error: NO_LOGIN_MESSAGE }, 409);

    // 6. A one-time sign-in token for the person. generateLink only returns it; no email is sent.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return json({ error: FAILED }, 500);

    // 7. Exchange it for a session here, on a throwaway client that keeps nothing.
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    const session = verified?.session;
    if (verifyError || !session) return json({ error: FAILED }, 500);

    // 8 and 9. Bind the new session to a view before the tokens leave the server; revoke it if that fails.
    const sessionId = sessionIdFromJwt(session.access_token);
    const { data: row, error: bindError } = sessionId
      ? await admin
          .rpc('begin_view_as', { p_admin: auth.user.id, p_target: profileId, p_session_id: sessionId, p_minutes: VIEW_MINUTES })
          .single()
      : { data: null, error: new Error('missing session id') };
    if (bindError || !row) {
      await admin.auth.admin.signOut(session.access_token, 'local').catch(() => undefined);
      return json({ error: FAILED }, 500);
    }

    // 10. Hand the bound session to the admin's app.
    return json(startResponse(row as { id: string; expires_at: string }, session));
  } catch {
    return json({ error: FAILED }, 500);
  }
});
