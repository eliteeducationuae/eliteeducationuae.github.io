-- Tutors read a family's name, never its contact details (20261114000600_sec_db_families.sql).
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

-- Family F1 (Mona, child Sami) and family F2 (Bea, child Bella). Tia teaches Sami; Tess used to teach Bella.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b3', 't3@x'), ('a0000000-0000-0000-0000-0000000000c1', 'p1@x'),
  ('a0000000-0000-0000-0000-0000000000d1', 'sami@x'), ('a0000000-0000-0000-0000-00000000000d', 'books@x');
insert into public.tutors (id, full_name, email) values
  ('b1000000-0000-0000-0000-000000000001', 'Tia One', 't1@x'), ('b3000000-0000-0000-0000-000000000003', 'Tess Three', 't3@x');
insert into public.families (id, name, parent_name, email, phone, status) values
  ('f1000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'p1@x', '+971500000001', 'active'),
  ('f2000000-0000-0000-0000-000000000002', 'Baker', 'Bea Baker', 'p2@x', '+971500000002', 'active');
insert into public.students (id, family_id, full_name) values
  ('51000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Sami Ahmed'),
  ('52000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002', 'Bella Baker');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b1000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Tess Three', 't3@x', 'b3000000-0000-0000-0000-000000000003', null, null),
  ('a0000000-0000-0000-0000-0000000000c1', 'parent', 'Mona Ahmed', 'p1@x', null, 'f1000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000d1', 'student', 'Sami Ahmed', 'sami@x', null, null, '51000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000d', 'accountant', 'Bea Books', 'books@x', null, null, null);
insert into public.services (id, name, duration_min, rate) values ('5e000000-0000-0000-0000-000000000001', 'IGCSE 1:1', 60, 450);
insert into public.enrolments (id, student_id, subject, tutor_id) values
  ('e1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Maths', 'b1000000-0000-0000-0000-000000000001');
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('10000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '{51000000-0000-0000-0000-000000000001}',
   '5e000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days' + interval '1 hour', 'online', 'scheduled', 'Maths'),
  ('10000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000003', '{52000000-0000-0000-0000-000000000002}',
   '5e000000-0000-0000-0000-000000000001', now() - interval '60 days', now() - interval '60 days' + interval '1 hour', 'online', 'completed', 'Maths');

set role authenticated;

-- 1. A current tutor: names, but no email or telephone -----------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.families) = 0,
  'a current tutor reads nothing from the families table (so no email or telephone)');
select pg_temp.check((select array_agg(name || '/' || parent_name || '/' || status) = '{Ahmed/Mona Ahmed/active}' from public.family_directory),
  'a current tutor reads the family they teach by name from family_directory');
select pg_temp.check(pg_temp.err('select email from public.family_directory') like '42703:%'
  and pg_temp.err('select phone from public.family_directory') like '42703:%',
  'family_directory has no email or telephone column');
select pg_temp.check((select bool_and(email is null and phone is null) and count(*) > 0
                        from public.list_family_contacts('f1000000-0000-0000-0000-000000000001')),
  'the family''s contacts still reach the tutor by name only');
select public.send_message('f1000000-0000-0000-0000-000000000001', 'See you on Tuesday.');
select pg_temp.check((select family_name = 'Ahmed' and parent_name = 'Mona Ahmed' from public.my_threads()
                       where family_id = 'f1000000-0000-0000-0000-000000000001'),
  'the conversation list still names the family');
select pg_temp.check(pg_temp.err($q$insert into public.family_directory (id, name, parent_name) values (gen_random_uuid(), 'X', 'Y')$q$) like '42501:%'
  and pg_temp.err($q$update public.family_directory set name = 'X'$q$) like '42501:%'
  and pg_temp.err('delete from public.family_directory') like '42501:%',
  'family_directory cannot be written');

-- 2. A former tutor sees neither --------------------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
select pg_temp.check((select count(*) from public.families) = 0 and (select count(*) from public.family_directory) = 0,
  'a former tutor sees no family at all');

-- 3. Everyone else is unchanged ---------------------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.families where email is not null) = 2 and (select count(*) from public.family_directory) = 2,
  'the office reads every family in full');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.families where email is not null) = 2 and (select count(*) from public.family_directory) = 2,
  'the accountant reads every family in full');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000c1');
select pg_temp.check((select array_agg(email || '/' || phone) = '{p1@x/+971500000001}' from public.families)
  and (select count(*) from public.family_directory) = 1,
  'a parent reads their own family in full, and no other');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000d1');
select pg_temp.check((select array_agg(name) = '{Ahmed}' from public.families) and (select count(*) from public.family_directory) = 1,
  'a student still sees their own family');

-- 4. Privileges and ledger --------------------------------------------------------------------------------------------
reset role;
select pg_temp.check(not has_table_privilege('anon', 'public.family_directory', 'select')
  and has_table_privilege('authenticated', 'public.family_directory', 'select')
  and not has_table_privilege('authenticated', 'public.family_directory', 'insert')
  and not has_table_privilege('authenticated', 'public.family_directory', 'update')
  and not has_table_privilege('authenticated', 'public.family_directory', 'delete'),
  'family_directory is select-only, for signed-in people');
select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261114000600' and name = 'sec_db_families'),
  'the migrations ledger records this file');
