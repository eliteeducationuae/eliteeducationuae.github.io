import type { AppErrorInput, AppErrorSource, AppPlatform } from '@/domain/types';

/**
 * App error reporting.
 *
 * Errors caught by error boundaries, failed queries and mutations, and uncaught errors are scrubbed of personal
 * data on the device, rate limited, and sent to every registered sink. The root layout configures the platform,
 * app version and the main sink (the log_app_error database function). Adding Sentry later only needs
 * `registerErrorSink` to be called once (see SENTRY_DSN in src/config.ts).
 *
 * The module imports nothing from React Native, so everything here can be unit tested in Node, and reporting
 * still works when the providers above a screen have crashed.
 */

export interface ErrorContext {
  source: AppErrorSource;
  route?: string;
}

/** Receives every report that passes the filters. May be async; failures are ignored. */
export type ErrorSink = (input: AppErrorInput, error: unknown) => void | Promise<unknown>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER_RE = /\b(bearer)(\s+)[^\s&,;"'`]+/gi;
const SECRET_RE = /\b(apikey|api_key|access_token|refresh_token|token|password|secret)(\s*[=:]\s*)[^\s&,;"'`]+/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const QUERY_RE = /\?[^\s#"'`]*=[^\s#"'`]*/g;
const PHONE_LIKE_RE = /\+?\d[\d\s().-]{5,}\d/g;

/**
 * Removes personal data from a message, stack or route: email addresses, phone-like runs of seven or more
 * digits (which also covers account numbers), JWTs and other long tokens, and URL query strings.
 */
export function scrubPII(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(JWT_RE, '[token]')
    .replace(EMAIL_RE, '[email]')
    .replace(QUERY_RE, '?[query]')
    .replace(BEARER_RE, (_m, word: string, sep: string) => `${word}${sep}[redacted]`)
    .replace(SECRET_RE, (_m, word: string, sep: string) => `${word}${sep}[redacted]`)
    .replace(LONG_TOKEN_RE, '[token]')
    .replace(PHONE_LIKE_RE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[number]' : m));
}

/** FNV-1a 32-bit hash as 8 hex characters. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A short, stable id for "the same error": source, first line of the message, and route. */
export function errorFingerprint(source: AppErrorSource, message: string, route?: string): string {
  const first = (message.split('\n')[0] ?? '').trim();
  return hash(`${source}|${first}|${route ?? ''}`);
}

/** The message and stack of anything thrown. */
export function describeError(error: unknown): { message: string; stack?: string; name?: string } {
  if (error instanceof Error) {
    // A server error shown to people with a calm message keeps the original text as its cause (see publicErrorMessage):
    // the error log records the original, which is what the office needs to diagnose it.
    const original = typeof error.cause === 'string' && error.cause ? error.cause : undefined;
    return { message: original || error.message || error.name || 'Error', stack: error.stack, name: error.name };
  }
  if (typeof error === 'string') return { message: error };
  if (error && typeof error === 'object') {
    const o = error as { message?: unknown; stack?: unknown; name?: unknown };
    if (typeof o.message === 'string') return { message: o.message, stack: typeof o.stack === 'string' ? o.stack : undefined, name: typeof o.name === 'string' ? o.name : undefined };
    try {
      return { message: JSON.stringify(error).slice(0, 500) };
    } catch {
      return { message: 'Unknown error' };
    }
  }
  return { message: String(error) };
}

const NETWORK_RE = /network request failed|failed to fetch|load failed|networkerror|fetch failed|the internet connection appears to be offline/i;

export function isNetworkError(error: unknown): boolean {
  return NETWORK_RE.test(describeError(error).message);
}

/** Errors that are part of normal use and never reported, such as a request cancelled by leaving a screen. */
export function isExpectedError(error: unknown): boolean {
  const { message, name } = describeError(error);
  if (name === 'AbortError' || name === 'CancelledError') return true;
  return /^(aborted|the operation was aborted\.?|the user aborted a request\.?|signal is aborted without reason)$/i.test(message.trim());
}

export interface RateLimiterOptions {
  /** Reports allowed in any rolling minute. */
  maxPerMinute?: number;
  /** The same fingerprint is sent at most once in this many milliseconds. */
  sameFingerprintMs?: number;
  now?: () => number;
}

/** At most ten reports a minute, and each distinct error at most once every five minutes. */
export function createRateLimiter({ maxPerMinute = 10, sameFingerprintMs = 5 * 60_000, now = () => Date.now() }: RateLimiterOptions = {}) {
  let sent: number[] = [];
  const lastByFingerprint = new Map<string, number>();
  return {
    allow(fingerprint: string): boolean {
      const t = now();
      sent = sent.filter((x) => t - x < 60_000);
      const last = lastByFingerprint.get(fingerprint);
      if (last !== undefined && t - last < sameFingerprintMs) return false;
      if (sent.length >= maxPerMinute) return false;
      sent.push(t);
      lastByFingerprint.set(fingerprint, t);
      if (lastByFingerprint.size > 500) lastByFingerprint.clear();
      return true;
    },
  };
}

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

/** The scrubbed report for an error. Never includes profile fields. */
export function buildErrorInput(error: unknown, ctx: ErrorContext, env: { platform: AppPlatform; appVersion?: string }): AppErrorInput {
  const { message, stack } = describeError(error);
  const route = ctx.route ? scrubPII(ctx.route.split('?')[0]).slice(0, 200) : undefined;
  const clean = scrubPII(message).slice(0, MAX_MESSAGE) || 'Unknown error';
  return {
    message: clean,
    stack: stack ? scrubPII(stack).slice(0, MAX_STACK) : undefined,
    route,
    platform: env.platform,
    appVersion: env.appVersion,
    source: ctx.source,
    fingerprint: errorFingerprint(ctx.source, isNetworkError(error) ? 'network' : clean, route),
  };
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

interface ReporterConfig {
  platform: AppPlatform;
  appVersion?: string;
  /** The main sink: sends the report to the server. */
  send?: (input: AppErrorInput) => Promise<unknown>;
  /** The current route, used when a report gives none (e.g. the web page path). */
  getRoute?: () => string | undefined;
  now?: () => number;
}

let config: ReporterConfig = { platform: 'unknown' };
let limiter = createRateLimiter();
const sinks = new Set<ErrorSink>();
/** Reports made before the root layout configured the reporter. */
let pending: { error: unknown; ctx: ErrorContext }[] = [];
let sending = false;
let networkReported = false;
let globalInstalled = false;

/** Set the platform, app version and server sink. Called once by the root layout; reports made earlier are sent now. */
export function configureErrorReporting(next: ReporterConfig) {
  config = { ...config, ...next };
  limiter = createRateLimiter({ now: next.now });
  const queued = pending;
  pending = [];
  for (const p of queued) reportError(p.error, p.ctx);
}

/** Add another destination for reports (for example Sentry). Returns a function that removes it. */
export function registerErrorSink(sink: ErrorSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

function swallow(result: void | Promise<unknown>) {
  if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
}

/**
 * Report an error. Never throws and never reports its own failures. Expected errors are ignored, a lost
 * connection is reported once per session, and reports are rate limited.
 */
export function reportError(error: unknown, ctx: ErrorContext): void {
  if (sending) return;
  try {
    if (error == null || isExpectedError(error)) return;
    if (!config.send && sinks.size === 0) {
      if (pending.length < 10) pending.push({ error, ctx });
      return;
    }
    if (isNetworkError(error)) {
      if (networkReported) return;
      networkReported = true;
    }
    const route = ctx.route ?? safeRoute();
    const input = buildErrorInput(error, { ...ctx, route }, config);
    if (!limiter.allow(input.fingerprint ?? '')) return;
    sending = true;
    try {
      if (config.send) swallow(config.send(input));
      for (const sink of sinks) {
        try {
          swallow(sink(input, error));
        } catch {
          // A broken sink must not stop the others.
        }
      }
    } finally {
      sending = false;
    }
  } catch {
    sending = false;
  }
}

function safeRoute(): string | undefined {
  try {
    return config.getRoute?.();
  } catch {
    return undefined;
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalHandler | undefined;
  setGlobalHandler: (handler: GlobalHandler) => void;
}

/** Report uncaught errors and unhandled promise rejections. Safe to call more than once. */
export function installGlobalErrorHandlers(): void {
  if (globalInstalled) return;
  globalInstalled = true;
  const g = globalThis as unknown as {
    ErrorUtils?: ErrorUtilsLike;
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    document?: unknown;
  };
  try {
    if (g.ErrorUtils?.setGlobalHandler) {
      const previous = g.ErrorUtils.getGlobalHandler?.();
      g.ErrorUtils.setGlobalHandler((error, isFatal) => {
        reportError(error, { source: 'global' });
        previous?.(error, isFatal);
      });
    }
    if (g.document && typeof g.addEventListener === 'function') {
      g.addEventListener('error', (event) => {
        const e = event as { error?: unknown; message?: string };
        reportError(e.error ?? e.message, { source: 'global' });
      });
      g.addEventListener('unhandledrejection', (event) => {
        reportError((event as { reason?: unknown }).reason, { source: 'global' });
      });
    }
  } catch {
    // Reporting is best effort.
  }
}

/** Tests only: forget configuration, sinks and limits. */
export function resetErrorReportingForTests() {
  config = { platform: 'unknown' };
  limiter = createRateLimiter();
  sinks.clear();
  pending = [];
  sending = false;
  networkReported = false;
  globalInstalled = false;
}
