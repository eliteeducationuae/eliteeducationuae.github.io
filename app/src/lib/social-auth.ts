/**
 * Pure helpers for Sign in with Apple and Google. No React Native or Expo imports, so Jest can test them.
 */

export type SocialProviderName = 'apple' | 'google';

/** Path of the native deep link the browser returns to: eliteeducation://auth-callback */
export const NATIVE_AUTH_PATH = 'auth-callback';

export interface AuthCallback {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  /** e.g. otp_expired for an email link that is out of date. */
  errorCode?: string;
}

function decode(value: string): string {
  const plus = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

function parseParams(part: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const key = decode(i === -1 ? pair : pair.slice(0, i));
    const value = i === -1 ? '' : decode(pair.slice(i + 1));
    if (key) out.set(key, value);
  }
  return out;
}

/** Read the result of an OAuth redirect from both the ?query and the #hash of a URL. */
export function parseAuthCallback(url: string): AuthCallback {
  if (!url) return {};
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const params = parseParams(query);
  for (const [k, v] of parseParams(hash)) params.set(k, v);

  const result: AuthCallback = {};
  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const error = params.get('error_description') || params.get('error');
  if (code) result.code = code;
  if (accessToken) result.accessToken = accessToken;
  if (refreshToken) result.refreshToken = refreshToken;
  const errorCode = params.get('error_code');
  if (error) result.error = error;
  if (errorCode) result.errorCode = errorCode;
  return result;
}

/** Where the web app asks Supabase to send the browser back to, e.g. https://eliteeducation.me/app/ */
export function webRedirectTo(origin: string, baseUrl?: string): string {
  const root = origin.replace(/\/+$/, '');
  const base = (baseUrl ?? '').trim().replace(/^\/+|\/+$/g, '');
  return base ? `${root}/${base}/` : `${root}/`;
}

export interface AppleName {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  nickname?: string | null;
}

/** Apple only shares the name on the very first sign-in; turn it into a display name. */
export function appleDisplayName(n: AppleName | null | undefined): string | null {
  if (!n) return null;
  const full = [n.givenName, n.middleName, n.familyName]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (full) return full;
  const nick = (n.nickname ?? '').trim();
  return nick || null;
}

/** Apple "Hide My Email" addresses never match an email we already hold. */
export function isAppleRelayEmail(email: string | null | undefined): boolean {
  return /@privaterelay\.appleid\.com$/i.test((email ?? '').trim());
}

const label = (provider: SocialProviderName) => (provider === 'apple' ? 'Apple' : 'Google');

/** Turn a provider or Supabase error into a polite, full-sentence message for families. */
export function friendlySocialError(provider: SocialProviderName, message: string | null | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (
    m.includes('access_denied') ||
    m.includes('access denied') ||
    m.includes('cancel') ||
    m.includes('user denied') ||
    m.includes('err_request_canceled')
  ) {
    return 'Sign-in was cancelled.';
  }
  if (m.includes('provider is not enabled') || m.includes('unsupported provider') || m.includes('provider not enabled')) {
    return `Sign in with ${label(provider)} is not available yet. Please use your email address and password, or contact us.`;
  }
  return `We could not sign you in with ${label(provider)}. Please try again, or use your email address.`;
}

export const EXPIRED_LINK = 'This link has expired. Please request a new one from the sign-in screen.';

/** An emailed password-reset or confirmation link that is out of date, rather than a failed Apple or Google sign-in. */
export function isExpiredLink(message: string | null | undefined, errorCode?: string | null): boolean {
  if ((errorCode ?? '').toLowerCase() === 'otp_expired') return true;
  return /link is invalid or has expired/i.test(message ?? '');
}

/**
 * The banner for a web sign-in redirect that came back with an error, or null when the person simply
 * cancelled. Without a remembered provider (e.g. the tab was reopened) the message names neither.
 */
export function redirectErrorNotice(
  provider: SocialProviderName | null,
  message: string | null | undefined,
  errorCode?: string | null,
): string | null {
  if (!message && !errorCode) return null;
  if (isExpiredLink(message, errorCode)) return EXPIRED_LINK;
  if (!message) return null;
  if (provider) {
    const friendly = friendlySocialError(provider, message);
    return friendly === 'Sign-in was cancelled.' ? null : friendly;
  }
  const m = message.toLowerCase();
  if (m.includes('cancel') || m.includes('user denied')) return null;
  return 'We could not complete your sign-in. Please try again, or use your email address and password.';
}


/** The name the database gives a parent when Apple shares neither a name nor a real email address. */
export const PLACEHOLDER_PARENT_NAME = 'New parent';

/** The name the database derives from an email address when a provider shares no name (mirrors link_login). */
export function nameFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').trim().split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * True when a parent's name is a stand-in rather than their real name: blank, 'New parent', or a single word
 * taken from their email address (e.g. 'Jsmith1984'). Such names are never used to greet a family.
 */
export function isPlaceholderName(name: string | null | undefined, email?: string | null): boolean {
  const clean = (name ?? '').trim();
  if (!clean) return true;
  if (clean.toLowerCase() === PLACEHOLDER_PARENT_NAME.toLowerCase()) return true;
  if (/\d/.test(clean)) return true;
  return !!email && !/\s/.test(clean) && clean.toLowerCase() === nameFromEmail(email).toLowerCase();
}

/** Particles that belong with an Arabic surname: 'Al Mansoori', 'Bin Rashid'. */
const SURNAME_PARTICLES = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'abu']);

/** The family name from a full name, keeping an Arabic particle (mirrors public.surname_of). */
export function surnameOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words[words.length - 1];
  const before = words[words.length - 2];
  return before && SURNAME_PARTICLES.has(before.toLowerCase()) ? `${before} ${last}` : last;
}
