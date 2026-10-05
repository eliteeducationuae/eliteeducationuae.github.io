// Confirms a website visitor completed the Cloudflare Turnstile security check and hands back a single-use pass.
//
//   POST { token: string, form: 'enquiry' | 'application' }
//     -> 200 { enabled: false, pass: null }   the check is switched off; submit the form without a pass
//     -> 200 { enabled: true, pass: uuid }     send the pass to submit_enquiry / submit_tutor_application (p_captcha_pass)
//     -> 400 / 502 { error }                   the check failed, or Cloudflare could not be reached
//
// A pass works once, for one form, within ten minutes (public.consume_captcha_pass). A form sent without a valid pass
// is still saved, but marked 'suspected' when settings.captcha_required is on.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   TURNSTILE_SECRET_KEY         required to switch the check on (from the Cloudflare Turnstile widget settings)
//   TURNSTILE_ALLOWED_HOSTNAMES  optional, comma-separated, e.g. eliteeducation.me,www.eliteeducation.me
//
// verify_jwt is off for this function (see config.toml) because visitors are not signed in.
// The token and the secret are never logged.
import { adminClient, corsHeaders, json } from '../_shared/supabase.ts';
import {
  buildSiteverifyBody,
  clientIp,
  FAILURE_MESSAGE,
  isCaptchaForm,
  readSiteverifyResult,
  SITEVERIFY_URL,
  turnstileConfigFromEnv,
} from '../_shared/turnstile.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Switched off (no secret configured): tell the website to send the form without a pass, whatever it sent.
  const config = turnstileConfigFromEnv((k) => Deno.env.get(k));
  if (!config) return json({ enabled: false, pass: null });

  let body: { token?: unknown; form?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: FAILURE_MESSAGE }, 400);
  }
  const { token, form } = body ?? {};
  if (typeof token !== 'string' || !token.trim() || token.length > 2048 || !isCaptchaForm(form)) {
    return json({ error: FAILURE_MESSAGE }, 400);
  }

  let result;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildSiteverifyBody({
        secret: config.secret,
        token: token.trim(),
        ip: clientIp(req.headers),
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    result = readSiteverifyResult(await res.json(), { expectedAction: form, allowedHostnames: config.allowedHostnames });
  } catch (e) {
    console.error('Turnstile siteverify unreachable', e instanceof Error ? e.message : 'unknown error');
    return json({ error: FAILURE_MESSAGE }, 502);
  }
  if (!result.ok) {
    console.warn('Turnstile check failed', result.reason);
    return json({ error: FAILURE_MESSAGE }, 400);
  }

  const { data, error } = await adminClient().from('captcha_passes').insert({ form }).select('id').single();
  if (error || !data) {
    console.error('Could not record the security-check pass', error?.message);
    return json({ error: FAILURE_MESSAGE }, 500);
  }
  return json({ enabled: true, pass: data.id });
});
