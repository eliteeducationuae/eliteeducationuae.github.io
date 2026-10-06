-- Database security audit fixes (20261114000200_sec_db.sql): former tutors lose the child, message names cannot be
-- forged, CV uploads are limited, signed-out visitors hold no sequence privileges.
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

-- Family F1 (Mona, child Sami); family F2 (Bea, child Bella). Tess taught Sami's Maths until the office moved it to
-- Tia; Tom teaches Bella; Cy covers one of Sami's lessons; Rex has a report to write for Bella.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b3', 't3@x'),
  ('a0000000-0000-0000-0000-0000000000b4', 't4@x'), ('a0000000-0000-0000-0000-0000000000b5', 't5@x'),
  ('a0000000-0000-0000-0000-0000000000c1', 'p1@x'), ('a0000000-0000-0000-0000-0000000000e1', 'p2@x');
insert into public.tutors (id, full_name, email) values
  ('b1000000-0000-0000-0000-000000000001', 'Tia One', 't1@x'), ('b2000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x'),
  ('b3000000-0000-0000-0000-000000000003', 'Tess Three', 't3@x'), ('b4000000-0000-0000-0000-000000000004', 'Cy Four', 't4@x'),
  ('b5000000-0000-0000-0000-000000000005', 'Rex Five', 't5@x');
insert into public.families (id, name, parent_name, email, phone, status) values
  ('f1000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'p1@x', '+971500000001', 'active'),
  ('f2000000-0000-0000-0000-000000000002', 'Baker', 'Bea Baker', 'p2@x', '+971500000002', 'active');
insert into public.students (id, family_id, full_name) values
  ('51000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Sami Ahmed'),
  ('52000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002', 'Bella Baker');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b1000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b2000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Tess Three', 't3@x', 'b3000000-0000-0000-0000-000000000003', null),
  ('a0000000-0000-0000-0000-0000000000b4', 'tutor', 'Cy Four', 't4@x', 'b4000000-0000-0000-0000-000000000004', null),
  ('a0000000-0000-0000-0000-0000000000b5', 'tutor', 'Rex Five', 't5@x', 'b5000000-0000-0000-0000-000000000005', null),
  ('a0000000-0000-0000-0000-0000000000c1', 'parent', 'Mona Ahmed', 'p1@x', null, 'f1000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000e1', 'parent', 'Bea Baker', 'p2@x', null, 'f2000000-0000-0000-0000-000000000002');
insert into public.services (id, name, duration_min, rate) values ('5e000000-0000-0000-0000-000000000001', 'IGCSE 1:1', 60, 450);
insert into public.enrolments (id, student_id, subject, tutor_id) values
  ('e1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Maths', 'b3000000-0000-0000-0000-000000000003'),
  ('e2000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000002', 'Maths', 'b2000000-0000-0000-0000-000000000002');
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('10000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000003', '{51000000-0000-0000-0000-000000000001}',
   '5e000000-0000-0000-0000-000000000001', now() - interval '60 days', now() - interval '60 days' + interval '1 hour', 'online', 'completed', 'Maths'),
  ('10000000-0000-0000-0000-000000000004', 'b4000000-0000-0000-0000-000000000004', '{51000000-0000-0000-0000-000000000001}',
   '5e000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'online', 'completed', 'Maths');
update public.enrolments set tutor_id = 'b1000000-0000-0000-0000-000000000001' where id = 'e1000000-0000-0000-0000-000000000001';
insert into public.lesson_private_notes (lesson_id, private_note) values ('10000000-0000-0000-0000-000000000003', 'Tess''s own note');
insert into public.student_notes (student_id, notes) values ('51000000-0000-0000-0000-000000000001', 'STAFF-ONLY note');
insert into public.homework (id, student_id, title, due_date, tutor_id) values
  ('40000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Ex 4B', current_date + 3, 'b1000000-0000-0000-0000-000000000001');
insert into public.messages (family_id, sender_id, sender_name, sender_role, body) values
  ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Boss', 'admin', 'A private matter');
insert into public.report_cycles (id, name, starts_on, due_date) values
  ('7c000000-0000-0000-0000-000000000001', 'Autumn', current_date - 90, current_date + 10);
insert into public.student_reports (cycle_id, student_id, tutor_id, status, subject) values
  ('7c000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000005', 'draft', 'Maths');
insert into storage.objects (bucket_id, name, owner_id) values
  ('classwork', 'students/51000000-0000-0000-0000-000000000001/handin.pdf', 'a0000000-0000-0000-0000-0000000000c1');

-- 1. A former tutor ----------------------------------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
select pg_temp.check((select count(*) from public.students) = 0 and (select count(*) from public.enrolments) = 0
  and (select count(*) from public.homework) = 0 and (select count(*) from public.families) = 0
  and (select count(*) from public.family_directory) = 0,
  'a former tutor no longer sees the student, their subjects, their homework or the family''s contact details');
select pg_temp.check((select count(*) from public.student_notes) = 0, 'a former tutor no longer reads the office''s tutor-only notes');
select pg_temp.check(pg_temp.err($q$update public.student_notes set notes = 'changed'$q$) is null
  and pg_temp.err($q$insert into public.student_notes values ('51000000-0000-0000-0000-000000000001', 'x')$q$) like '42501:%',
  'a former tutor cannot write the tutor-only notes');
select pg_temp.check((select count(*) from public.messages) = 0 and not exists (select 1 from public.my_threads())
  and not public.can_access_thread('f1000000-0000-0000-0000-000000000001'),
  'a former tutor no longer reads the family''s conversation');
select pg_temp.check(pg_temp.err($q$select public.send_message('f1000000-0000-0000-0000-000000000001', 'I now teach privately')$q$) like '42501:%',
  'a former tutor cannot write to the family');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'classwork') = 0
  and pg_temp.err($q$insert into storage.objects (bucket_id, name) values ('classwork', 'students/51000000-0000-0000-0000-000000000001/x.pdf')$q$) like '42501:%',
  'a former tutor cannot read or add files in the child''s folder');
select pg_temp.check(pg_temp.err($q$select public.save_homework(null, '51000000-0000-0000-0000-000000000001', 'x', null, current_date, '[]')$q$) like '42501:%',
  'a former tutor cannot set homework');
select pg_temp.check((select count(*) from public.lessons) = 1 and (select private_note from public.lesson_private_notes) = 'Tess''s own note',
  'a former tutor keeps their own past lessons and private notes');

-- 2. Current, cover and report-writing tutors --------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.students) = 1 and (select count(*) from public.student_notes) = 1
  and (select count(*) from public.homework) = 1 and (select count(*) from public.messages) = 1
  and (select count(*) from public.family_directory) = 1 and (select count(*) from storage.objects where bucket_id = 'classwork') = 1,
  'the current tutor sees the student, the notes, the homework, the conversation and the files');
select public.send_message('f1000000-0000-0000-0000-000000000001', 'See you on Tuesday.');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b4');
select pg_temp.check((select count(*) from public.students) = 1 and public.can_access_thread('f1000000-0000-0000-0000-000000000001'),
  'a cover tutor keeps the student for a week after the lesson');
reset role;
update public.lessons set start_at = now() - interval '8 days', end_at = now() - interval '8 days' + interval '1 hour'
 where id = '10000000-0000-0000-0000-000000000004';
set role authenticated;
select pg_temp.check((select count(*) from public.students) = 0 and not public.can_access_thread('f1000000-0000-0000-0000-000000000001'),
  'and loses them after that');
reset role;
update public.lessons set status = 'scheduled', start_at = now() - interval '8 days', end_at = now() - interval '8 days' + interval '1 hour'
 where id = '10000000-0000-0000-0000-000000000004';
set role authenticated;
select pg_temp.check((select count(*) from public.students) = 1, 'a lesson still to be recorded keeps the student visible');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b5');
select pg_temp.check((select array_agg(full_name) = '{Bella Baker}' from public.students),
  'a tutor with a report to write sees that student');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select array_agg(full_name) = '{Bella Baker}' from public.students)
  and not public.can_access_thread('f1000000-0000-0000-0000-000000000001'), 'another tutor still sees only their own students');

-- 3. Messages carry the sender's own name ------------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000c1');
select pg_temp.check(pg_temp.err($q$insert into public.messages (family_id, sender_id, sender_name, sender_role, body)
  values ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'Elite Education Office', 'parent',
          'Please pay into account AE00 0000')$q$) like '42501:%', 'a parent cannot post a message under another name');
select pg_temp.check(pg_temp.err($q$update public.messages set body = 'edited'$q$) like '42501:%'
  and pg_temp.err('delete from public.messages') like '42501:%', 'messages cannot be edited or deleted directly');
select public.send_message('f1000000-0000-0000-0000-000000000001', 'Thank you!');
select pg_temp.check((select sender_name = 'Mona Ahmed' and sender_role = 'parent' from public.messages where body = 'Thank you!'),
  'send_message still works and names the sender from their profile');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(pg_temp.err($q$insert into public.messages (family_id, sender_id, sender_name, sender_role, body)
  values ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'Elite Education Accounts', 'tutor', 'x')$q$) like '42501:%',
  'a tutor cannot post a message under another name');
reset role;
select pg_temp.check((select count(*) from public.messages) = 3, 'only the office''s, Tia''s and Mona''s messages were written');

-- 4. Storage and privileges --------------------------------------------------------------------------------------------
select pg_temp.check((select file_size_limit = 10485760 and 'application/pdf' = any (allowed_mime_types)
  and not ('text/html' = any (allowed_mime_types)) from storage.buckets where id = 'applications'),
  'CV uploads are limited to 10 MB of PDF, Word or image files');
select pg_temp.check(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
    and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('anon', c.oid, 'select')
         or has_sequence_privilege('anon', c.oid, 'update'))), 'signed-out visitors hold no sequence privileges');
select pg_temp.check(not has_function_privilege('anon', 'public.visible_student_ids()', 'execute')
  and not has_function_privilege('anon', 'public.can_access_thread(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.visible_student_ids()', 'execute'),
  'the visibility helpers are for signed-in people only');
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'every security definer function fixes its search_path');
select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261114000200' and name = 'sec_db'),
  'the migrations ledger records this file');
