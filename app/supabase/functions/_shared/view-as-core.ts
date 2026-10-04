// Pure helpers for the admin "View as" (read only) feature, shared by the Edge Functions and unit-tested with Jest.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and Jest.

/** Shown when a view tries to change anything. Shared word for word with the app. */
export const VIEW_ONLY_MESSAGE = 'Viewing only — changes are disabled.';
/** Shown once a view has ended or expired. Shared word for word with the app. */
export const VIEW_ENDED_MESSAGE = 'This view has ended. Please return to your own account.';
/** The longest a view may last, in minutes (begin_view_as also clamps to this). */
export const VIEW_MINUTES = 60;

export const NO_LOGIN_MESSAGE = 'This person does not have a login yet.';
export const ADMIN_ONLY_MESSAGE = 'Only the office can view the app as someone else.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64url (with or without padding) to a UTF-8 string, or null when it is not valid base64url. */
function base64UrlDecode(input: string): string | null {
  const s = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/** The session_id claim of a Supabase access token, or null when the token is malformed or has none. */
export function sessionIdFromJwt(jwt: string | null | undefined): string | null {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const decoded = base64UrlDecode(parts[1]);
  if (decoded === null) return null;
  try {
    const payload: unknown = JSON.parse(decoded);
    if (!payload || typeof payload !== 'object') return null;
    const sid = (payload as Record<string, unknown>).session_id;
    return typeof sid === 'string' && UUID.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

/** Validates the view-as request body: { profileId: <uuid> }. */
export function parseStartBody(body: unknown): { profileId: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Please choose the person to view.' };
  const profileId = (body as Record<string, unknown>).profileId;
  if (typeof profileId !== 'string' || !UUID.test(profileId.trim())) return { error: 'Please choose the person to view.' };
  return { profileId: profileId.trim().toLowerCase() };
}

export type ViewAsRow = { id: string; expires_at: string };
export type ViewAsSession = { access_token: string; refresh_token: string };
export type ViewAsStartResponse = { viewId: string; accessToken: string; refreshToken: string; expiresAt: string };

/** Maps the begin_view_as row and the new auth session to the response the app expects. */
export function startResponse(row: ViewAsRow, session: ViewAsSession): ViewAsStartResponse {
  return {
    viewId: row.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
