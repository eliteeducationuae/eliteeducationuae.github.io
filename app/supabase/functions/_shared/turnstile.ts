// Cloudflare Turnstile (the website's security check) request/response mapping.
// Pure module: no imports and no Deno globals, so it runs in Edge Functions and in the app's Jest tests
// (src/lib/__tests__/turnstile.test.ts).
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const FAILURE_MESSAGE = 'We could not complete the security check. Please try again, or email hello@eliteeducation.me.';

export type CaptchaForm = 'enquiry' | 'application';

export function isCaptchaForm(x: unknown): x is CaptchaForm {
  return x === 'enquiry' || x === 'application';
}

/** The visitor's address, as Supabase's gateway forwards it: Cloudflare's header first, then x-real-ip, then x-forwarded-for. */
export function clientIp(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || null;
}

export interface SiteverifyRequest {
  secret: string;
  token: string;
  ip?: string | null;
  idempotencyKey?: string | null;
}

/** Form body for the siteverify call. remoteip and idempotency_key are optional and left out when unknown. */
export function buildSiteverifyBody({ secret, token, ip, idempotencyKey }: SiteverifyRequest): URLSearchParams {
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  if (idempotencyKey) body.set('idempotency_key', idempotencyKey);
  return body;
}

export type SiteverifyResult = { ok: true } | { ok: false; reason: string };

export interface SiteverifyOptions {
  /** The form the check was rendered for (the widget's data-action). Compared only when Cloudflare reports one. */
  expectedAction?: string;
  /** When non-empty, the check must have been completed on one of these hostnames. */
  allowedHostnames?: string[];
}

/** Interprets Cloudflare's siteverify response. Anything unexpected counts as a failure. */
export function readSiteverifyResult(json: unknown, opts: SiteverifyOptions = {}): SiteverifyResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, reason: 'invalid-response' };
  const r = json as Record<string, unknown>;
  if (r.success !== true) {
    const codes = Array.isArray(r['error-codes']) ? r['error-codes'].filter((c): c is string => typeof c === 'string') : [];
    return { ok: false, reason: codes.length ? codes.join(',') : 'not-successful' };
  }
  const allowed = (opts.allowedHostnames ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length) {
    const host = typeof r.hostname === 'string' ? r.hostname.trim().toLowerCase() : '';
    if (!allowed.includes(host)) return { ok: false, reason: 'hostname-mismatch' };
  }
  if (opts.expectedAction && typeof r.action === 'string' && r.action !== '' && r.action !== opts.expectedAction) {
    return { ok: false, reason: 'action-mismatch' };
  }
  return { ok: true };
}

/** 'eliteeducation.me, WWW.eliteeducation.me' -> ['eliteeducation.me', 'www.eliteeducation.me']. */
export function parseAllowedHostnames(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export interface TurnstileConfig {
  secret: string;
  allowedHostnames: string[];
}

/** Null when TURNSTILE_SECRET_KEY is not set, meaning the security check is switched off. */
export function turnstileConfigFromEnv(get: (k: string) => string | undefined): TurnstileConfig | null {
  const secret = (get('TURNSTILE_SECRET_KEY') ?? '').trim();
  if (!secret) return null;
  return { secret, allowedHostnames: parseAllowedHostnames(get('TURNSTILE_ALLOWED_HOSTNAMES')) };
}
