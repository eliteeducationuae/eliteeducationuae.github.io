// Gives the accountant read-only access. POST { email, fullName? } as a signed-in admin; returns { status }.
//   'linked':  the address already has a login, which is now an accountant login.
//   'invited': Supabase Auth has emailed an invitation; accepting it (and confirming the email) creates the accountant.
// The database (invite_accountant) checks the caller is an admin and that the address is not a tutor, parent or admin.
// Secrets: APP_URL (where the invitation link takes them). Never log email addresses or request bodies here.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { inviteRedirect, isAlreadyRegisteredError, normaliseInviteEmail } from '../_shared/invite.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const email = normaliseInviteEmail(body?.email);
    if (!email) return json({ error: 'Please enter the accountant\'s email address.' }, 400);
    const fullName = typeof body?.fullName === 'string' && body.fullName.trim() ? body.fullName.trim().slice(0, 120) : null;

    const { data: status, error } = await userClient(req).rpc('invite_accountant', { p_email: email, p_full_name: fullName });
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 400);
    if (status !== 'invited') return json({ status: 'linked' });

    const redirectTo = inviteRedirect(Deno.env.get('APP_URL'));
    const { error: inviteError } = await adminClient().auth.admin.inviteUserByEmail(email, {
      ...(redirectTo ? { redirectTo } : {}),
      data: { full_name: fullName ?? undefined },
    });
    if (inviteError && !isAlreadyRegisteredError(inviteError)) {
      return json({ error: 'The invitation could not be sent. Please try again in a moment.' }, 502);
    }
    return json({ status: 'invited' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
