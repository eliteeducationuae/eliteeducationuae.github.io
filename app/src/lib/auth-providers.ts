/**
 * Which Apple and Google sign-in buttons to offer. Supabase publishes the switched-on providers at
 * GET /auth/v1/settings (public, needs only the publishable key). A provider that is switched off would
 * otherwise send the browser to a raw "Unsupported provider" error page, so its button is hidden.
 * Fail-safe: if the settings cannot be read, both buttons stay and a refused sign-in shows a calm message.
 * No React Native or Expo imports, so Jest can test it.
 */
import type { SocialProviderName } from './social-auth';

export type ProviderAvailability = Record<SocialProviderName, boolean> & {
  /** False when the settings could not be read and every button is offered as a fallback. */
  known: boolean;
};

export const ALL_PROVIDERS: ProviderAvailability = { apple: true, google: true, known: false };

/** Decide from the /auth/v1/settings body; anything unreadable offers both buttons. */
export function providersFromSettings(body: unknown): ProviderAvailability {
  const external = body && typeof body === 'object' ? (body as { external?: unknown }).external : undefined;
  if (!external || typeof external !== 'object') return ALL_PROVIDERS;
  const ext = external as Record<string, unknown>;
  return { apple: ext.apple === true, google: ext.google === true, known: true };
}

/** True when the settings say this provider is switched off (never true when they are unknown). */
export function isProviderOff(state: ProviderAvailability | null | undefined, provider: SocialProviderName): boolean {
  return !!state && state.known && !state[provider];
}

/** Shown in the app when a switched-off provider is pressed or refused. */
export function providerUnavailableMessage(provider: SocialProviderName): string {
  return `${provider === 'apple' ? 'Apple' : 'Google'} sign-in is not available yet. Please sign in with your email.`;
}

export const SETTINGS_TIMEOUT_MS = 3000;

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const cache = new Map<string, Promise<ProviderAvailability>>();
const settled = new Map<string, ProviderAvailability>();

/** The answer already fetched this session for this project, if any (so a revisit never flickers). */
export function cachedProviders(url: string): ProviderAvailability | undefined {
  return settled.get(url);
}

/** Fetch the project's providers once per session (short timeout, never rejects). */
export function loadProviders(
  url: string,
  key: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ProviderAvailability> {
  const hit = cache.get(url);
  if (hit) return hit;
  const doFetch: FetchLike | undefined = opts.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);
  const timeoutMs = opts.timeoutMs ?? SETTINGS_TIMEOUT_MS;
  const attempt = (async (): Promise<ProviderAvailability> => {
    if (!doFetch) return ALL_PROVIDERS;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          ctrl?.abort();
          resolve(null);
        }, timeoutMs);
      });
      const request = doFetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, { headers: { apikey: key }, signal: ctrl?.signal }).then(
        async (r) => (r.ok ? providersFromSettings(await r.json()) : ALL_PROVIDERS),
      );
      return (await Promise.race([request, timeout])) ?? ALL_PROVIDERS;
    } catch {
      return ALL_PROVIDERS;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  const done = attempt.then((state) => {
    // Only a real answer is kept for the session; a failure is retried on the next visit.
    if (state.known) settled.set(url, state);
    else cache.delete(url);
    return state;
  });
  cache.set(url, done);
  return done;
}

/** For tests. */
export function resetProvidersCache() {
  cache.clear();
  settled.clear();
}

/**
 * Fallback when the settings could not be read: Supabase answers the authorize address for a switched-off
 * provider with HTTP 400 "Unsupported provider" (readable, as it allows the app's origin) instead of redirecting.
 * True only for that answer; a redirect, any other status or a network failure counts as not refused.
 */
export function isAuthorizeRefusal(status: number, body: string): boolean {
  return status === 400 && /unsupported provider|provider is not enabled|provider not enabled/i.test(body);
}

/** Ask the authorize address, without following its redirect, whether it would refuse this provider. */
export async function probeAuthorize(url: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<boolean> {
  const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) return false;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => ctrl?.abort(), opts.timeoutMs ?? SETTINGS_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { redirect: 'manual', credentials: 'omit', signal: ctrl?.signal });
    if (res.type === 'opaqueredirect' || res.status !== 400) return false;
    return isAuthorizeRefusal(res.status, await res.text());
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
