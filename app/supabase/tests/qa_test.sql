-- QA of the tutor pay fix (20261113001200) against the family price fix (20261113001500): public.tutor_directory and
-- public.service_catalogue are select-only, closed to anonymous visitors, readable in a View as session as the viewed
-- parent or tutor (and never writable there), and nothing that runs with the caller's rights still reads the
-- restricted tables directly.
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
-- A PostgREST-like request in a View as session: the viewed person's id, the session id, the method and the path.
create function pg_temp.req(sub text, sid text, m text, p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', sub, false),
         set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'session_id', sid)::text, false),
         set_config('request.jwt.claim.session_id', '', false),
         set_config('request.method', m, false),
         set_config('request.path', p, false)
$$;
create function pg_temp.guard(sub text, sid text, m text, p text) returns text language plpgsql as $$
begin
  perform pg_temp.req(sub, sid, m, p);
  return pg_temp.err('select public.view_as_guard()');
end $$;

\set view_only '''42501: Viewing only — changes are disabled.'''

-- Admin Boss, tutors Tia and Tom, parent Mona (Sami's mother) and the accountant.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-0000000000ac', 'acc@x');
insert into public.tutors (id, full_name, email, phone, hourly_pay, subjects) values
  ('b1000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', '+971500000001', 200, '{Maths}'),
  ('b2000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', '+971500000002', 250, '{Chemistry}');
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name) values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed');
delete from public.profiles;
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b1000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b2000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000ac', 'accountant', 'Acc', 'acc@x', null, null, null);
insert into public.services (id, name, duration_min, rate, subject) values
  ('e0000000-0000-0000-0000-000000000001', '1:1 IGCSE', 60, 450, 'Maths');

-- Boss is viewing as Mona (view 1) and as Tia (view 2).
insert into public.view_as_sessions (admin_id, target_id, session_id, expires_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', now() + interval '30 minutes'),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000002', now() + interval '30 minutes');

-- 1. Both views are plain, owner-rights, select-only views ------------------------------------------------------------
select pg_temp.check((select bool_and(c.relkind = 'v' and not coalesce('security_invoker=true' = any (c.reloptions), false))
                      from pg_class c where c.oid in ('public.tutor_directory'::regclass, 'public.service_catalogue'::regclass)),
  'the directory and the catalogue are views that run with their owner''s rights');
select pg_temp.check(not exists (select 1 from pg_rewrite r where r.ev_class in ('public.tutor_directory'::regclass, 'public.service_catalogue'::regclass)
                                   and r.rulename <> '_RETURN')
  and not exists (select 1 from pg_trigger t where t.tgrelid in ('public.tutor_directory'::regclass, 'public.service_catalogue'::regclass)),
  'neither view has a rule or trigger that could write through it');
select pg_temp.check(not has_table_privilege('authenticated', 'public.tutor_directory', 'insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.service_catalogue', 'insert, update, delete, truncate, references, trigger')
  and has_table_privilege('authenticated', 'public.tutor_directory', 'select')
  and has_table_privilege('authenticated', 'public.service_catalogue', 'select'),
  'signed-in logins may only select from the directory and the catalogue');
select pg_temp.check(not has_table_privilege('anon', 'public.tutor_directory', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.service_catalogue', 'select, insert, update, delete')
  and not has_table_privilege('public', 'public.tutor_directory', 'select')
  and not has_table_privilege('public', 'public.service_catalogue', 'select'),
  'anonymous visitors have no grant on either view');
select pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public'
                                   and ((table_name = 'tutor_directory' and column_name in ('hourly_pay', 'email', 'phone'))
                                        or (table_name = 'service_catalogue' and column_name = 'rate'))),
  'neither view carries pay, contact details or family prices');

-- 2. Nothing that runs with the caller's rights reads the restricted tables ----------------------------------------
-- A security invoker function (or a view other than these two) selecting from tutors, services or package_offers
-- would silently lose rows for parents, students, tutors and the accountant now that those tables are restricted.
select pg_temp.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef
      and p.prosrc ~* '(from|join)\s+(public\.)?(tutors|services|package_offers)\M'),
  'every function that reads tutors, services or package offers runs as its owner');
select pg_temp.check((select array_agg(distinct c.relname::text order by c.relname::text)
                      from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
                      where d.refobjid in ('public.tutors'::regclass, 'public.services'::regclass, 'public.package_offers'::regclass)
                        and c.oid not in ('public.tutors'::regclass, 'public.services'::regclass, 'public.package_offers'::regclass))
                     = array['service_catalogue', 'tutor_directory'],
  'the only views over tutors and services are the directory and the catalogue');
select pg_temp.check(not exists (select 1 from pg_policies
                                 where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~* '(from|join)\s+(public\.)?(tutors|services|package_offers)\M'),
  'no row-level policy on another table looks up tutors, services or package offers');

-- 3. View as: the viewed parent and tutor read both views; writes are refused ---------------------------------------
set role authenticated;
-- The guard lets reads of both views through and refuses every write to them.
select pg_temp.check(pg_temp.guard('a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', 'GET', '/tutor_directory') is null
  and pg_temp.guard('a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', 'GET', '/service_catalogue') is null
  and pg_temp.guard('a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', 'HEAD', '/tutor_directory') is null,
  'a view as a parent may read the directory and the catalogue');
select pg_temp.check(pg_temp.guard('a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', 'PATCH', '/tutor_directory') = :view_only
  and pg_temp.guard('a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', 'POST', '/service_catalogue') = :view_only
  and pg_temp.guard('a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000002', 'DELETE', '/tutor_directory') = :view_only
  and pg_temp.guard('a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000002', 'PUT', '/service_catalogue') = :view_only
  and pg_temp.guard('a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000002', 'PATCH', '/tutors') = :view_only,
  'a view cannot write to the directory, the catalogue or tutors');
reset role;

-- The viewed parent, inside a guarded (read-only) request, reads names and the catalogue but no pay or prices.
begin;
set local role authenticated;
select pg_temp.req('a0000000-0000-0000-0000-00000000000c', '90000000-0000-0000-0000-000000000001', 'GET', '/tutor_directory');
select public.view_as_guard();
select pg_temp.check(current_setting('transaction_read_only') = 'on', 'a view request as a parent runs read-only');
select pg_temp.check((select string_agg(full_name, ', ' order by full_name) = 'Tia One, Tom Two' from public.tutor_directory),
  'a view as a parent reads every tutor''s name in the directory');
select pg_temp.check((select count(*) = 1 from public.service_catalogue), 'a view as a parent reads the service catalogue');
select pg_temp.check((select count(*) = 0 from public.tutors), 'a view as a parent reads no tutor''s pay, email or phone');
select pg_temp.check(pg_temp.err($q$update public.tutor_directory set full_name = 'X'$q$) like '42501:%'
  and pg_temp.err($q$delete from public.service_catalogue$q$) like '42501:%',
  'a view as a parent cannot change either view');
rollback;

-- The viewed tutor reads the directory, the catalogue and their own row in full, never another tutor's.
begin;
set local role authenticated;
select pg_temp.req('a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000002', 'GET', '/tutors');
select public.view_as_guard();
select pg_temp.check((select count(*) = 2 from public.tutor_directory), 'a view as a tutor reads every tutor in the directory');
select pg_temp.check((select count(*) = 1 and min(name) = '1:1 IGCSE' from public.service_catalogue), 'a view as a tutor reads the service catalogue');
select pg_temp.check((select count(*) = 1 and min(hourly_pay) = 200 from public.tutors), 'a view as a tutor reads only that tutor''s own pay');
select pg_temp.check((select count(*) = 0 from public.services), 'a view as a tutor reads no family prices');
select pg_temp.check(pg_temp.err($q$update public.tutors set full_name = 'X' where id = 'b1000000-0000-0000-0000-000000000001'$q$) like '25006:%',
  'a view as a tutor cannot change the tutor''s own row (the request is read-only)');
rollback;
reset role;

\echo 'All QA tests passed'
