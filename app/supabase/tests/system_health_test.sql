-- Error reports from the app, system health and the migrations ledger. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
create function pg_temp.check_of(report jsonb, k text) returns text language sql as $$
  select c->>'status' from jsonb_array_elements(report->'checks') c where c->>'key' = k
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 'tia@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mona@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia One', 'tia@x');
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mona@x');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 'tia@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mona@x', null, 'c0000000-0000-0000-0000-000000000001');

-- Error reports ------------------------------------------------------------------
set role anon;
select pg_temp.as_user('');
select pg_temp.check(public.log_app_error('Sign-in screen failed', null, '/sign-in?email=someone@example.com', 'web', '1.0.0', 'boundary', 'fp-anon'),
  'someone not signed in can report an error');
reset role;
select pg_temp.check((select profile_id is null and role is null and route = '/sign-in' and platform = 'web' and source = 'boundary'
                        from public.app_errors), 'an anonymous report has no profile, and the query string is removed from the route');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.log_app_error('Could not save for mona.ahmed@example.com, phone +971 50 123 4567',
  'Error: at saveThing (eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl)', '/parent/billing', 'ios', '1.0.0', 'mutation', 'fp-1'),
  'a signed-in user can report an error');
select pg_temp.check(not public.log_app_error('Could not save again', null, '/parent/billing', 'ios', '1.0.0', 'mutation', 'fp-1'),
  'the same fingerprint is accepted once a minute');
reset role;
select pg_temp.check((select message = 'Could not save for [email], phone [number]' and stack = 'Error: at saveThing ([token])'
                             and role = 'parent' and profile_id = 'a0000000-0000-0000-0000-00000000000c'
                        from public.app_errors where fingerprint = 'fp-1'),
  'email addresses, phone numbers and tokens are scrubbed, and the role is recorded');
select pg_temp.check(public.scrub_error_text('ref 3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d and useSomeVeryLongHookNameThatHasNoDigitsInIt') =
  'ref [token] and useSomeVeryLongHookNameThatHasNoDigitsInIt', 'long codes are scrubbed but ordinary long words are kept');

set role authenticated;
-- 1 report so far in this window; 29 more are accepted, the 31st is refused.
select pg_temp.check((select bool_and(public.log_app_error('Repeated error ' || g, null, null, 'android', null, 'query', null))
                        from generate_series(2, 30) g), 'thirty reports in ten minutes are accepted');
select pg_temp.check(not public.log_app_error('One too many', null, null, 'android', null, 'query', null),
  'the 31st report in ten minutes is refused without an error');
select pg_temp.check(not public.log_app_error('   '), 'an empty message is ignored');

-- Who can read monitoring data -----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.app_errors) = 0 and (select count(*) from public.function_errors) = 0
  and (select count(*) from public.function_runs) = 0 and (select count(*) from public.db_migrations) = 0,
  'a tutor cannot read errors, job runs or the migrations ledger');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.app_errors) = 0 and (select count(*) from public.db_migrations) = 0,
  'a parent cannot read errors or the migrations ledger');
do $$ begin
  insert into public.app_errors (message) values ('forged');
  raise exception 'wrote app_errors directly';
exception when insufficient_privilege then raise notice 'ok - nobody writes error rows directly';
end $$;
do $$ begin
  perform public.system_health();
  raise exception 'parent saw system health';
exception when insufficient_privilege then
  if sqlerrm <> 'Only administrators can view system health' then raise; end if;
  raise notice 'ok - a parent cannot view system health';
end $$;
do $$ begin
  perform public.system_health_report();
  raise exception 'parent called the report';
exception when insufficient_privilege then raise notice 'ok - only the service role calls system_health_report';
end $$;
do $$ begin
  perform * from public.db_version();
  raise exception 'parent read db_version';
exception when insufficient_privilege then raise notice 'ok - a parent cannot read the database version';
end $$;
reset role;
set role anon;
do $$ begin
  perform public.system_health();
  raise exception 'anon saw system health';
exception when insufficient_privilege then raise notice 'ok - someone not signed in cannot view system health';
end $$;
reset role;

-- System health ------------------------------------------------------------------------
-- A healthy system: last night's backup succeeded, and the app errors above are cleared.
delete from public.app_errors;
insert into public.function_runs (function_name, last_started_at, last_succeeded_at) values
  ('backup-export', now() - interval '3 hours', now() - interval '3 hours');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table r0 as select public.system_health() as r;
grant select on r0 to authenticated;
select pg_temp.check((select r->>'status' = 'ok' from r0), 'a clean database is ok');
select pg_temp.check((select array_agg(c->>'key' order by ord) = '{notifications,whatsapp,calendar,autopay,stripe,server-errors,app-errors,backups}'
                        from r0, jsonb_array_elements(r->'checks') with ordinality as x(c, ord)), 'the checks come in a fixed order');
select pg_temp.check((select r->'database'->>'latest' = '20261113001700' and r->'database'->>'latestName' = 'creditnote_fix'
                             and (r->'database'->>'count')::int = :migration_count
                             and r->'database'->'migrations'->0->>'version' = '20261113001700'
                             and exists (select 1 from jsonb_array_elements(r->'database'->'migrations') m where m->>'version' = '20261002000000')
                        from r0), 'the database version is the latest migration and the ledger holds every migration');
select pg_temp.check((select jsonb_array_length(r->'jobs') = 1 and r->'jobs'->0->>'name' = 'backup-export'
                             and r->'jobs'->0->'lastSucceededAt' is not null and r->'jobs'->0->'lastError' = 'null'::jsonb
                        from r0), 'job runs are listed');
select pg_temp.check((select count(*) >= 13 from public.db_migrations), 'an admin can read the migrations ledger');
-- run.sh passes the number of files in supabase/migrations, so a migration missing from the ledger fails here.
select pg_temp.check((select count(*) from public.db_migrations) = :migration_count,
  'the ledger lists every migration file (' || :migration_count || ')');
select pg_temp.check(not exists (select 1 from public.db_migrations where version like '202610_______' and version > '20261014000000'),
  'no round 5 migration is recorded under its old number');
reset role;

-- Notifications stuck for 11 minutes
insert into public.notification_outbox (profile_id, email, subject, body, created_at)
values ('a0000000-0000-0000-0000-00000000000c', 'mona@x', 'Hello', 'Body', now() - interval '11 minutes');
set role authenticated;
create temp table r1 as select public.system_health() as r;
select pg_temp.check((select r->>'status' = 'failing' and pg_temp.check_of(r, 'notifications') = 'failing' from r1),
  'a notification waiting for 11 minutes is failing');
select pg_temp.check((select position('mona' in r::text) = 0 and position('Hello' in r::text) = 0 from r1),
  'the report holds no personal details or message contents');
reset role;
update public.notification_outbox set sent_at = now();

-- A lesson change that has not reached Google Calendar
insert into public.calendar_sync_queue (lesson_id, reason, created_at) values (gen_random_uuid(), 'created', now() - interval '45 minutes');
set role authenticated;
select pg_temp.check((select pg_temp.check_of(public.system_health(), 'calendar') = 'failing'), 'an old unprocessed calendar change is failing');
reset role;
update public.calendar_sync_queue set processed_at = now();

-- Autopay has not run for 40 minutes while an invoice waits
insert into public.function_runs (function_name, last_started_at, last_succeeded_at) values
  ('charge-invoice', now() - interval '40 minutes', now() - interval '40 minutes');
set role authenticated;
select pg_temp.check((select pg_temp.check_of(public.system_health(), 'autopay') = 'warning'),
  'autopay not running with nothing queued is a warning');
reset role;
insert into public.invoices (number, family_id, due_date, status, items) values
  ('INV-2001', 'c0000000-0000-0000-0000-000000000001', current_date + 7, 'draft', '[]');
update public.invoices set autopay_status = 'pending' where number = 'INV-2001';
set role authenticated;
select pg_temp.check((select pg_temp.check_of(public.system_health(), 'autopay') = 'failing'),
  'autopay not running for 40 minutes with an invoice waiting is failing');
reset role;
update public.function_runs set last_started_at = now() where function_name = 'charge-invoice';
set role authenticated;
select pg_temp.check((select pg_temp.check_of(public.system_health(), 'autopay') = 'ok'), 'autopay that ran recently is ok');
reset role;

-- The Stripe webhook failed
insert into public.function_errors (function_name, message, status) values ('stripe-webhook', 'Signature mismatch', 500);
set role authenticated;
create temp table r2 as select public.system_health() as r;
select pg_temp.check((select pg_temp.check_of(r, 'stripe') = 'failing' and pg_temp.check_of(r, 'server-errors') = 'ok'
                             and r->>'status' = 'failing' from r2), 'a Stripe webhook error is failing');
reset role;

-- Other server errors and backups
insert into public.function_errors (function_name, message, status) values ('send-notifications', 'Boom', 500);
update public.function_runs set last_failed_at = now(), last_error = 'Upload failed' where function_name = 'backup-export';
set role authenticated;
create temp table r3 as select public.system_health() as r;
select pg_temp.check((select pg_temp.check_of(r, 'server-errors') = 'warning' and pg_temp.check_of(r, 'backups') = 'failing' from r3),
  'a server error is a warning and a failed backup is failing');
reset role;

-- The service role runs the report and the purge
set role service_role;
select pg_temp.check((select public.system_health_report()->>'status' = 'failing'), 'the service role can run the report');
reset role;
insert into public.app_errors (message, created_at) values ('Old', now() - interval '91 days');
insert into public.function_errors (function_name, message, created_at) values ('ai-assist', 'Old', now() - interval '91 days');
set role service_role;
select pg_temp.check(public.purge_old_errors() = 2, 'errors older than 90 days are purged');
reset role;
select public.record_migration('20261108000000', 'launch');
select pg_temp.check((select count(*) = 1 from public.db_migrations where version = '20261108000000'), 'recording a migration twice keeps one row');

-- Migrations applied by the Supabase CLI that never called record_migration still show.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values ('20261002000000', 'init'), ('20261101000000', 'viewas'), ('20261199000000', null);
set role service_role;
select pg_temp.check((select count(*) = 1 from public.db_version() where version = '20261101000000' and name = 'viewas')
  and (select count(*) = 1 from public.db_version() where version = '20261002000000')
  and (select count(*) = 1 from public.db_version() where version = '20261199000000' and name is null),
  'db_version includes the Supabase CLI history without duplicates');
select pg_temp.check((select public.system_health_report()->'database'->>'latest' = '20261199000000'), 'the latest applied migration is reported');
reset role;
