// Pure helpers for the invite-accountant Edge Function, unit-tested with Jest.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and Jest.

/** The email as the database keeps it (trimmed, lower case), or null when it is not an email address. */
export function normaliseInviteEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const clean = email.trim().toLowerCase();
  if (clean.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  return clean;
}

/**
 * Whether Supabase Auth refused an invitation because the address already has a login. The accountant can then sign
 * in with their existing password (or use 'Forgot password'), so the invitation counts as sent.
 */
export function isAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; status?: unknown };
  if (e.code === 'email_exists' || e.code === 'user_already_exists') return true;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return /already (been )?registered|already exists/.test(message);
}

/** Where the invitation email sends the accountant: the app's sign-in screen. Null when APP_URL is not set. */
export function inviteRedirect(appUrl: string | null | undefined): string | null {
  const base = (appUrl ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/sign-in` : null;
}
