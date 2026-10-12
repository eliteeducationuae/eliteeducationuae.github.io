-- Elite Education — Edge Function security review before the live launch (Google, Stripe and email switched on).
--
--  1. Google Calendar connections use PKCE: google-connect keeps a one-time code verifier with each OAuth state, so a
--     code intercepted on its way back can never be exchanged by anyone else. Server-only, like the state itself.
--  2. A simple per-person rate limit for the Edge Functions that cost money or send email on request (AI drafts, the
--     accountant invitation and starting a Google connection). consume_rate_limit is for the service role only.
--  3. Calendar feed links can be revoked: reset_ics_token gives the caller (or, for an admin, anyone) a new secret feed
--     address, so a feed link that has been shared or leaked stops working at once.
--  4. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. PKCE for Google Calendar
-- ---------------------------------------------------------------------------

alter table public.calendar_oauth_states add column if not exists code_verifier text;

-- ---------------------------------------------------------------------------
-- 2. Rate limits for Edge Functions
-- ---------------------------------------------------------------------------

/** One row per key and fixed window. Server-only: nobody signed in can read or change it. */
create table if not exists public.function_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.function_rate_limits enable row level security;
revoke all on public.function_rate_limits from public, anon, authenticated;

/**
 * Service role: counts one call for p_key in the current fixed window of p_window_seconds and returns true while the
 * count is within p_max, false once it is over. Old windows are tidied away as it goes.
 */
create or replace function public.consume_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz;
  n int;
begin
  if p_key is null or p_key = '' or p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_rate_limit needs a key, a positive limit and a positive window';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.function_rate_limits as r (key, window_start, hits) values (left(p_key, 200), w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into n;
  delete from public.function_rate_limits where window_start < now() - interval '2 days';
  return n <= p_max;
end $$;

revoke all on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Revocable calendar feed links
-- ---------------------------------------------------------------------------

/**
 * A new secret calendar feed address. With no argument it is the caller's own; an admin may pass another profile.
 * The old address stops working immediately (the ics function only answers a current token). A View as session is
 * refused by the PostgREST guard like every other change.
 */
create or replace function public.reset_ics_token(p_profile uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(p_profile, auth.uid());
  fresh uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if target <> auth.uid() and not public.is_admin() then
    raise exception 'Only an administrator can reset someone else''s calendar link.' using errcode = '42501';
  end if;
  update public.profiles set ics_token = gen_random_uuid() where id = target returning ics_token into fresh;
  if fresh is null then raise exception 'This person was not found.'; end if;
  return fresh;
end $$;

revoke all on function public.reset_ics_token(uuid) from public, anon;
grant execute on function public.reset_ics_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261114000300', 'sec_fn');
