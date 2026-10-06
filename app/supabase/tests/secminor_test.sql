-- Minor security fixes (20261113001500_secminor_fix.sql): family prices hidden from tutors and students, View as
-- protection of pending sign-in changes, a per-connection limit on anonymous error reports, and admissions files
-- readable by their uploader only while the uploader still has access to the case.
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
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000d', 'sami@x'), ('a0000000-0000-0000-0000-0000000000ac', 'acc@x');
insert into public.tutors (id, full_name, email) values
  ('b1000000-0000-0000-0000-000000000001', 'Tia One', 't1@x'), ('b2000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'), ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'o@x');
insert into public.students (id, family_id, full_name) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b1000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b2000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000d', 'student', 'Sami Ahmed', 'sami@x', null, 'c0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000ac', 'accountant', 'Acc', 'acc@x', null, null, null);

-- 1. Family prices ---------------------------------------------------------------------------------------------------
insert into public.services (id, name, duration_min, rate, subject) values
  ('e0000000-0000-0000-0000-000000000001', '1:1 IGCSE', 60, 450, 'Maths');
insert into public.package_offers (id, name, service_id, lessons, price, active) values
  ('f0000000-0000-0000-0000-000000000001', 'Ten lessons', 'e0000000-0000-0000-0000-000000000001', 10, 4000, true),
  ('f0000000-0000-0000-0000-000000000002', 'Old offer', null, 5, 2100, false);

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.services) = 0, 'a tutor cannot read the family price list');
select pg_temp.check((select count(*) from public.package_offers) = 0, 'a tutor cannot read package offer prices');
select pg_temp.check((select name = '1:1 IGCSE' and duration_min = 60 and subject = 'Maths' from public.service_catalogue),
  'a tutor still reads the service catalogue (name, length, subject)');
select pg_temp.check(pg_temp.err('select rate from public.service_catalogue') like '42703:%', 'the catalogue has no price column');
select pg_temp.check(pg_temp.err($q$update public.service_catalogue set name = 'Hacked'$q$) like '42501:%'
  and pg_temp.err($q$insert into public.service_catalogue (name, duration_min) values ('New', 60)$q$) like '42501:%'
  and pg_temp.err('delete from public.service_catalogue') like '42501:%', 'the catalogue is read only');
select pg_temp.check(pg_temp.err($q$update public.services set rate = 1$q$) is null
  and pg_temp.err($q$insert into public.services (name, duration_min, rate) values ('Mine', 60, 1)$q$) like '42501:%',
  'a tutor still cannot change services');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.services) = 0 and (select count(*) from public.package_offers) = 0
  and (select count(*) from public.service_catalogue) = 1, 'a student reads the catalogue but no prices');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select rate = 450 from public.services) and (select array_agg(name) = '{Ten lessons}' from public.package_offers),
  'a parent keeps the price list and the active offers');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000ac');
select pg_temp.check((select rate = 450 from public.services) and (select array_agg(name) = '{Ten lessons}' from public.package_offers),
  'the accountant keeps the price list and the active offers');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select rate = 450 from public.services) and (select count(*) = 2 from public.package_offers)
  and (select count(*) = 1 from public.service_catalogue), 'an admin keeps every price and offer');
reset role;
select pg_temp.check(not has_table_privilege('anon', 'public.service_catalogue', 'select'), 'people who are not signed in cannot read the catalogue');
select pg_temp.check((select rate = 450 from public.services), 'tutor writes were refused by row-level security');

-- 2. View as: pending sign-in changes --------------------------------------------------------------------------------
-- Columns of the real auth.users that the test shim does not have.
alter table auth.users add column if not exists email_change text, add column if not exists phone_change text;
insert into public.view_as_sessions (admin_id, target_id, session_id, expires_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001',
   now() + interval '30 minutes');
select pg_temp.check(pg_temp.err($q$update auth.users set email_change = 'thief@x' where id = 'a0000000-0000-0000-0000-00000000000c'$q$)
  = '42501: Account details cannot be changed while the office is viewing this account.', 'an email change cannot be started during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set phone_change = '+971500000001' where id = 'a0000000-0000-0000-0000-00000000000c'$q$)
  like '42501:%', 'a phone change cannot be started during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set raw_user_meta_data = '{"full_name":"X"}' where id = 'a0000000-0000-0000-0000-00000000000c'$q$)
  is null, 'the user metadata still updates during a view (Google and Apple sign-in refresh it)');
select pg_temp.check(pg_temp.err($q$update auth.users set email_confirmed_at = now(), raw_app_meta_data = '{"provider":"email"}'
    where id = 'a0000000-0000-0000-0000-00000000000c'$q$) is null, 'other sign-in bookkeeping still updates during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set email_change = 'new@x' where id = 'a0000000-0000-0000-0000-0000000000b1'$q$) is null,
  'people who are not being viewed can start an email change');
-- The view ends and its session is revoked: the person stays protected for 24 hours after revoked_at.
update public.view_as_sessions set ended_at = now(), revoked_at = now() where session_id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.err($q$update auth.users set email_change = 'thief@x' where id = 'a0000000-0000-0000-0000-00000000000c'$q$)
  like '42501:%', 'a revoked view still protects the person straight afterwards');
update public.view_as_sessions set ended_at = now() - interval '23 hours', revoked_at = now() - interval '23 hours'
 where session_id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.err($q$update auth.users set email = 'thief@x' where id = 'a0000000-0000-0000-0000-00000000000c'$q$)
  like '42501:%', 'a revoked view protects the person for 24 hours');
update public.view_as_sessions set ended_at = now() - interval '25 hours', revoked_at = now() - interval '25 hours'
 where session_id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.err($q$update auth.users set email_change = 'new-mum@x', raw_user_meta_data = '{"full_name":"Mona"}'
    where id = 'a0000000-0000-0000-0000-00000000000c'$q$) is null, 'after 24 hours the person can change their details again');

-- 3. Anonymous error reports: a limit per connection ----------------------------------------------------------------
set role anon;
select pg_temp.as_user('');
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7"}', false);
select pg_temp.check((select bool_and(public.log_app_error('Crash ' || g, null, '/sign-in', 'web', null, 'global', null))
                        from generate_series(1, 20) g), 'twenty anonymous reports an hour are accepted from one connection');
select pg_temp.check(not public.log_app_error('Crash 21', null, '/sign-in', 'web', null, 'global', null),
  'the 21st anonymous report in an hour from that connection is refused without an error');
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.9"}', false);
select pg_temp.check(public.log_app_error('Genuine crash', null, '/sign-in', 'web', null, 'boundary', null),
  'a genuine report from another connection still gets through');
select set_config('request.headers', '', false);
select pg_temp.check(public.log_app_error('No headers', null, null, 'web', null, 'manual', null),
  'a report without connection headers falls back to the overall cap');
reset role;
select pg_temp.check((select count(*) = 20 and count(distinct ip_hash) = 1 and bool_and(ip_hash !~ '203') from public.app_errors
                        where message like 'Crash %'), 'only a salted fingerprint of the connection is stored');
-- The overall cap of 200 an hour still applies.
insert into public.app_errors (message, platform, source) select 'Filler ' || g, 'web', 'manual' from generate_series(1, 178) g;
set role anon;
select set_config('request.headers', '{"cf-connecting-ip":"192.0.2.44"}', false);
select pg_temp.check(not public.log_app_error('Over the cap', null, null, 'web', null, 'manual', null),
  'two hundred anonymous reports an hour in total are still the overall cap');
select set_config('request.headers', '', false);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.log_app_error('Signed-in error', null, null, 'ios', null, 'query', null),
  'signed-in reports are not affected by the anonymous caps');
reset role;
select pg_temp.check((select ip_hash is null from public.app_errors where message = 'Signed-in error'),
  'signed-in reports carry no connection fingerprint');

-- 4. Admissions files ------------------------------------------------------------------------------------------------
insert into public.admissions_cases (id, student_id, family_id, kind, title, adviser_tutor_id) values
  ('ca000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'uk-university', 'UK universities', 'b1000000-0000-0000-0000-000000000001');
-- Unlisted files: the adviser's working draft and the parent's own upload.
insert into storage.objects (bucket_id, name, owner_id) values
  ('admissions', 'cases/ca000000-0000-0000-0000-000000000001/adviser-draft.pdf', 'a0000000-0000-0000-0000-0000000000b1'),
  ('admissions', 'cases/ca000000-0000-0000-0000-000000000001/parent-upload.pdf', 'a0000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from storage.objects where name like '%/parent-upload.pdf') = 1,
  'a parent reads a file they uploaded to their case');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'admissions') = 2, 'the adviser reads the case''s files');
reset role;
-- The office replaces the adviser and the parent's login moves to another family (a removed contact).
update public.admissions_cases set adviser_tutor_id = 'b2000000-0000-0000-0000-000000000002' where id = 'ca000000-0000-0000-0000-000000000001';
update public.profiles set family_id = 'c0000000-0000-0000-0000-000000000002' where id = 'a0000000-0000-0000-0000-00000000000c';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'admissions') = 0,
  'a replaced adviser can no longer read files they uploaded');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'admissions') = 0,
  'a removed contact can no longer read files they uploaded');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'admissions') = 2, 'the new adviser reads the case''s files');
reset role;

-- 5. Ledger ----------------------------------------------------------------------------------------------------------
select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261113001500' and name = 'secminor_fix'),
  'the ledger records this migration');

\echo 'All minor security fix tests passed'
