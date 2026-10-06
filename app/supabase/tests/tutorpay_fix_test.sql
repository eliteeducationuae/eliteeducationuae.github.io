-- Security: tutors' pay, email and phone. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Admin, two tutors (Tia, Tom), a parent (Mona, Sami's mother), a student (Sami) and an accountant.
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x', now()), ('a0000000-0000-0000-0000-0000000000b1', 't1@x', now()),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x', now()), ('a0000000-0000-0000-0000-00000000000c', 'mum@x', now()),
  ('a0000000-0000-0000-0000-00000000000f', 'sami@x', now()), ('a0000000-0000-0000-0000-00000000000d', 'books@x', now());
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
  ('a0000000-0000-0000-0000-00000000000f', 'student', 'Sami Ahmed', 'sami@x', null, null, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000d', 'accountant', 'Bea Books', 'books@x', null, null, null);
insert into public.enrolments (id, student_id, subject, curriculum, tutor_id) values
  ('70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'IGCSE', 'b1000000-0000-0000-0000-000000000001');
insert into public.enrolment_tutor_pay (enrolment_id, hourly_pay, source) values ('70000000-0000-0000-0000-000000000001', 240, 'custom');

set role authenticated;

-- The admin --------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 2 and sum(hourly_pay) = 450 and count(email) = 2 and count(phone) = 2 from public.tutors),
  'an admin reads every tutor''s pay, email and phone');
select pg_temp.check((select count(*) = 2 from public.tutor_directory), 'an admin reads the tutor directory');
update public.tutors set hourly_pay = 210 where id = 'b1000000-0000-0000-0000-000000000001';
select pg_temp.check((select hourly_pay = 210 from public.tutors where id = 'b1000000-0000-0000-0000-000000000001'), 'an admin still changes a tutor''s pay');

-- Each non-admin: the directory lists every tutor without pay, email or phone ------------
create function pg_temp.directory_only(who text, label text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(who);
  perform pg_temp.check((select count(*) = 2 from public.tutor_directory), label || ' reads every tutor''s name in the directory');
  perform pg_temp.check((select string_agg(full_name, ', ' order by full_name) = 'Tia One, Tom Two' from public.tutor_directory),
    label || ' sees tutor names');
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tutor_directory'
                                     and column_name in ('hourly_pay', 'email', 'phone', 'onboarding_started_at')),
    'the directory has no pay, email, phone or onboarding columns');
end $$;

-- The parent
select pg_temp.directory_only('a0000000-0000-0000-0000-00000000000c', 'a parent');
select pg_temp.check((select count(*) = 0 from public.tutors), 'a parent cannot read any tutor''s pay, email or phone');
select pg_temp.check((select count(*) = 0 from public.enrolment_tutor_pay), 'a parent cannot read per-student tutor pay');

-- The student
select pg_temp.directory_only('a0000000-0000-0000-0000-00000000000f', 'a student');
select pg_temp.check((select count(*) = 0 from public.tutors), 'a student cannot read any tutor''s pay, email or phone');

-- The accountant
select pg_temp.directory_only('a0000000-0000-0000-0000-00000000000d', 'the accountant');
select pg_temp.check((select count(*) = 0 from public.tutors), 'the accountant cannot read tutors'' pay rates, email or phone');

-- A tutor reads their own row in full, never another tutor's
select pg_temp.directory_only('a0000000-0000-0000-0000-0000000000b1', 'a tutor');
select pg_temp.check((select count(*) = 1 and min(hourly_pay) = 210 and min(email) = 't1@x' and min(phone) = '+971500000001' from public.tutors),
  'a tutor reads their own pay, email and phone');
select pg_temp.check(not exists (select 1 from public.tutors where id = 'b2000000-0000-0000-0000-000000000002'),
  'a tutor cannot read another tutor''s pay, email or phone');
select pg_temp.check((select count(*) = 1 from public.enrolment_tutor_pay), 'a tutor still reads per-student pay for their own enrolment');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) = 0 from public.enrolment_tutor_pay), 'another tutor cannot read that per-student pay');
select pg_temp.check((select array_agg(id) = array['b2000000-0000-0000-0000-000000000002'::uuid] from public.tutors), 'the other tutor reads only their own row');

-- Non-admins still cannot change tutors, nor the directory
update public.tutors set hourly_pay = 999;
select pg_temp.check((select hourly_pay = 250 from public.tutors), 'a tutor cannot change their own pay');
do $$ begin
  update public.tutor_directory set full_name = 'X';
  raise exception 'FAILED: the directory accepted an update';
exception when insufficient_privilege or object_not_in_prerequisite_state or feature_not_supported then
  raise notice 'ok - the directory is read-only';
end $$;

select pg_temp.check(not has_table_privilege('authenticated', 'public.tutor_directory', 'insert, update, delete, truncate'),
  'signed-in logins may only select from the directory');
select pg_temp.check(not has_table_privilege('anon', 'public.tutor_directory', 'select'), 'anonymous visitors have no grant on the directory');

-- Anonymous visitors read nothing
reset role;
set role anon;
do $$ begin
  perform 1 from public.tutor_directory;
  raise exception 'FAILED: anon read the directory';
exception when insufficient_privilege then
  raise notice 'ok - anonymous visitors cannot read the directory';
end $$;
reset role;
\echo 'All tutor pay tests passed'
