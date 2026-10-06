// Per-person rate limits for the Edge Functions that cost money or send email on request.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and Jest.

/** The part of the (service role) Supabase client used here. */
type RateLimitDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Counts one call against `key` (for example 'ai-assist:<profile id>') and says whether it is within `max` calls per
 * `windowSeconds`. Fails open: if the limit cannot be checked (the database is not migrated yet, or briefly
 * unavailable), the call is allowed and the problem is logged, so a monitoring hiccup never locks the office out.
 */
export async function withinRateLimit(client: unknown, key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const db = client as RateLimitDb;
    const { data, error } = await db.rpc('consume_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
    if (error) {
      console.error('rate limit unavailable', error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error('rate limit unavailable', e instanceof Error ? e.message : String(e));
    return true;
  }
}
