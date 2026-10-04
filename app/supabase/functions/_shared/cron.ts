// Shared check for the scheduled functions (send-reminders, send-notifications).
// The platform's own JWT check accepts the public anon key, so on its own it does not stop anyone calling these.
// Once CRON_SECRET is set, every call must carry the same value in the x-cron-secret header (see the README).
// While it is unset the functions keep working as before, so existing schedules are not broken by a deploy.

/** Constant-time comparison of two strings. */
function sameSecret(provided: string, secret: string): boolean {
  let diff = provided.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) diff |= (provided.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** True when a scheduled call may run: no CRON_SECRET configured yet, or the header matches it. */
export function isAuthorisedCronCall(provided: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return true;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return sameSecret(provided, secret);
}

/** The 401 response for a refused scheduled call. */
export function refuseCronCall(): Response {
  return new Response(JSON.stringify({ error: 'Not authorised' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
}
