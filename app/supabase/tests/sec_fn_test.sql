-- Edge Function security review (20261114000300_sec_fn.sql): PKCE verifier column, the server-only rate limit and
-- revocable calendar feed links.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'), ('a0000000-0000-0000-0000-0000000000ac', 'acc@x');
insert into public.tutors (id, full_name, email) values ('b1000000-0000-0000-0000-000000000001', 'Tia One', 't1@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b1000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000ac', 'accountant', 'Acc', 'acc@x', null, null);

create temp table before_tokens as select id, ics_token from public.profiles;
grant select on before_tokens to authenticated;

-- 1. PKCE ---------------------------------------------------------------------------------------------------------
select pg_temp.check(exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'calendar_oauth_states' and column_name = 'code_verifier'),
  'OAuth states keep a PKCE code verifier');

-- 2. Rate limits --------------------------------------------------------------------------------------------------
select pg_temp.check(public.consume_rate_limit('ai-assist:x', 2, 3600) and public.consume_rate_limit('ai-assist:x', 2, 3600)
  and not public.consume_rate_limit('ai-assist:x', 2, 3600), 'the third call in a window of two is refused');
select pg_temp.check(public.consume_rate_limit('ai-assist:y', 2, 3600), 'each key has its own allowance');
select pg_temp.check(pg_temp.err($q$select public.consume_rate_limit('', 2, 60)$q$) is not null
  and pg_temp.err($q$select public.consume_rate_limit('k', 0, 60)$q$) is not null, 'a blank key or a zero limit is an error');
insert into public.function_rate_limits (key, window_start, hits) values ('old', now() - interval '3 days', 9);
select public.consume_rate_limit('tidy', 5, 60);
select pg_temp.check(not exists (select 1 from public.function_rate_limits where key = 'old'), 'old windows are tidied away');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.err($q$select public.consume_rate_limit('ai-assist:x', 100, 60)$q$) like '42501:%',
  'nobody signed in (not even an admin) can use or reset a rate limit');
select pg_temp.check(pg_temp.err('select * from public.function_rate_limits') like '42501:%', 'nobody signed in can read the rate limits');
select pg_temp.check(pg_temp.err('select code_verifier from public.calendar_oauth_states') like '42501:%',
  'OAuth states (and their verifiers) stay server-only');
reset role;

-- 3. Revocable calendar feed links --------------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.reset_ics_token() as new_token \gset
select pg_temp.check(:'new_token'::uuid = (select ics_token from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'),
  'a parent resets their own feed link and is given the new one');
reset role;
select pg_temp.check((select p.ics_token <> b.ics_token from public.profiles p join before_tokens b using (id)
  where p.id = 'a0000000-0000-0000-0000-00000000000c'), 'the old feed link no longer matches');
select pg_temp.check(not exists (select 1 from public.profiles p join before_tokens b using (id)
  where p.id <> 'a0000000-0000-0000-0000-00000000000c' and p.ics_token <> b.ics_token), 'nobody else''s link changed');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(pg_temp.err($q$select public.reset_ics_token('a0000000-0000-0000-0000-00000000000c')$q$) like '42501:%',
  'a tutor cannot reset a parent''s feed link');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000ac');
select pg_temp.check(pg_temp.err($q$select public.reset_ics_token('a0000000-0000-0000-0000-0000000000b1')$q$) like '42501:%',
  'the accountant cannot reset a tutor''s feed link');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.err($q$select public.reset_ics_token('a0000000-0000-0000-0000-0000000000b1')$q$) is null,
  'an admin can reset anyone''s feed link');
select pg_temp.check(pg_temp.err($q$select public.reset_ics_token('a0000000-0000-0000-0000-0000000000ff')$q$) like '%not found%',
  'resetting an unknown profile says so');
reset role;
select pg_temp.check((select p.ics_token <> b.ics_token from public.profiles p join before_tokens b using (id)
  where p.id = 'a0000000-0000-0000-0000-0000000000b1'), 'the admin reset changed the tutor''s link');

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check(pg_temp.err('select public.reset_ics_token()') like '42501:%', 'a signed-out caller cannot reset a link');
reset role;

-- 4. Ledger -------------------------------------------------------------------------------------------------------
select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261114000300' and name = 'sec_fn'),
  'the migrations ledger records sec_fn');
