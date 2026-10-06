-- Handover packs close when the tutor no longer teaches the student (20261113001300_handoverac_fix.sql).
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss (admin); Tia teaches Sami Maths; the office moves it to Tom and back; Cy covers one lesson.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b3', 't3@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200), ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250),
  ('b0000000-0000-0000-0000-000000000003', 'Cy Three', 't3@x', 250);
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma');
insert into public.enrolments (id, student_id, subject, curriculum, level, tutor_id) values
  ('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'IB DP', 'AA SL', 'b0000000-0000-0000-0000-000000000001');
insert into public.profiles (id, role, full_name, email, tutor_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Cy Three', 't3@x', 'b0000000-0000-0000-0000-000000000003');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);

-- The office moves Sami's Maths from Tia to Tom, Tia writes a handover note, and the office moves it back to Tia.
update public.enrolments set tutor_id = 'b0000000-0000-0000-0000-000000000002' where id = 'e1000000-0000-0000-0000-000000000001';
create temp table ids (k text primary key, id uuid);
create temp table packs (k text primary key, j jsonb);
grant all on ids, packs to authenticated;
insert into ids select 'tom', id from public.handovers where to_tutor_id = 'b0000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.save_handover_note((select id from ids where k = 'tom'), 'Sami likes a recap first.');
reset role;
update public.enrolments set tutor_id = 'b0000000-0000-0000-0000-000000000001' where id = 'e1000000-0000-0000-0000-000000000001';
insert into ids select 'tia', id from public.handovers where to_tutor_id = 'b0000000-0000-0000-0000-000000000001';

-- Later Tia teaches at Sami's home and writes notes; the office keeps tutor-only notes; there is homework and a report.
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, address, subject, status) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '23 hours', 'in-person', '12 Villa Street, Jumeirah', 'Maths', 'completed'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days' + interval '1 hour', 'in-person', '12 Villa Street, Jumeirah', 'Maths', 'scheduled');
insert into public.lesson_notes (lesson_id, summary) values ('f0000000-0000-0000-0000-000000000001', 'SECRET-LATEST-NOTE after Tom left');
insert into public.student_notes (student_id, notes) values ('d0000000-0000-0000-0000-000000000001', 'STAFF-ONLY student note');
insert into public.topic_ratings (student_id, topic_id, lesson_id, rating, rated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'ib-aa-sl-2.1', 'f0000000-0000-0000-0000-000000000001', 3, now() - interval '1 day');
insert into public.homework (student_id, lesson_id, title, due_date, done, tutor_id) values
  ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Ex 4B', current_date + 2, false, 'b0000000-0000-0000-0000-000000000001');
insert into public.report_cycles (id, name, starts_on, due_date) values
  ('e3000000-0000-0000-0000-000000000001', 'Autumn term', current_date - 60, current_date - 10);
insert into public.student_reports (cycle_id, student_id, tutor_id, status, subject, comment, published_at) values
  ('e3000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'published', 'Maths', 'Working towards a 6.', now() - interval '10 days');

-- (1) The former tutor -------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.students) = 0, 'Tom can no longer see Sami');
insert into packs select 'tom', public.handover_pack((select id from ids where k = 'tom'));
select pg_temp.check((select (j->>'closed')::boolean from packs where k = 'tom'), 'the former tutor''s pack is closed');
select pg_temp.check((select j->'handover'->>'note' = 'Sami likes a recap first.' and j->'student'->>'full_name' = 'Sami Ahmed'
  from packs where k = 'tom'), 'a closed pack keeps the handover note and the student''s name');
select pg_temp.check((select jsonb_array_length(j->'lessons') + jsonb_array_length(j->'notes') + jsonb_array_length(j->'homework')
  + jsonb_array_length(j->'plans') + jsonb_array_length(j->'ratings') + jsonb_array_length(j->'resources') = 0
  and j->'enrolment' = 'null'::jsonb and j->'latest_report' = 'null'::jsonb from packs where k = 'tom'),
  'a closed pack has no lessons, notes, homework, plans, ratings, resources, enrolment or report');
select pg_temp.check((select j::text not like '%SECRET-LATEST-NOTE%' and j::text not like '%STAFF-ONLY%'
  and j::text not like '%Villa Street%' and j::text not like '%Working towards%' and not (j->'student') ? 'student_notes'
  from packs where k = 'tom'), 'the former tutor never sees the new notes, staff notes, the address or the report');

-- (2) The current tutor and the office ---------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into packs select 'tia', public.handover_pack((select id from ids where k = 'tia'));
select pg_temp.check((select not (j->>'closed')::boolean and j->'notes'->0->>'summary' = 'SECRET-LATEST-NOTE after Tom left'
  and j->'student'->'student_notes'->>'notes' = 'STAFF-ONLY student note' and j->'lessons'->0->>'address' = '12 Villa Street, Jumeirah'
  and jsonb_array_length(j->'homework') = 1 and jsonb_array_length(j->'ratings') = 1 and j->'latest_report'->>'comment' = 'Working towards a 6.'
  from packs where k = 'tia'), 'the current tutor gets the full pack');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into packs select 'boss', public.handover_pack((select id from ids where k = 'tom'));
select pg_temp.check((select not (j->>'closed')::boolean and j->'notes'->0->>'summary' = 'SECRET-LATEST-NOTE after Tom left'
  and j->'student'->'student_notes'->>'notes' = 'STAFF-ONLY student note' from packs where k = 'boss'),
  'admins always get the full pack, even for a closed handover');

-- (3) A cover tutor ------------------------------------------------------------------------
select public.reassign_lesson('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003');
reset role;
insert into ids select 'cy', id from public.handovers where to_tutor_id = 'b0000000-0000-0000-0000-000000000003';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
insert into packs select 'cy-before', public.handover_pack((select id from ids where k = 'cy'));
select pg_temp.check((select not (j->>'closed')::boolean and j->'notes'->0->>'summary' = 'SECRET-LATEST-NOTE after Tom left'
  and j->'student'->'student_notes'->>'notes' = 'STAFF-ONLY student note' from packs where k = 'cy-before'),
  'a cover tutor gets the full pack before the lesson');
select public.mark_handover_viewed((select id from ids where k = 'cy'));
-- The lesson took place two days ago.
reset role;
update public.lessons set start_at = now() - interval '2 days', end_at = now() - interval '2 days' + interval '1 hour', status = 'completed'
 where id = 'f0000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
insert into packs select 'cy-after', public.handover_pack((select id from ids where k = 'cy'));
select pg_temp.check((select not (j->>'closed')::boolean from packs where k = 'cy-after'),
  'a cover tutor keeps the pack for a week after the lesson');
-- And eight days ago.
reset role;
update public.lessons set start_at = now() - interval '8 days', end_at = now() - interval '8 days' + interval '1 hour'
 where id = 'f0000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
insert into packs select 'cy-later', public.handover_pack((select id from ids where k = 'cy'));
select pg_temp.check((select (j->>'closed')::boolean and jsonb_array_length(j->'notes') = 0 and not (j->'student') ? 'student_notes'
  and j::text not like '%Villa Street%' from packs where k = 'cy-later'), 'the cover tutor loses the pack a week after the lesson');

-- (4) Undoing a cover the tutor has already opened ------------------------------------------
reset role;
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, subject, status) values
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days' + interval '1 hour', 'online', 'Maths', 'scheduled');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.reassign_lesson('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002');
reset role;
delete from ids where k = 'tom2';
insert into ids select 'tom2', id from public.handovers
 where to_tutor_id = 'b0000000-0000-0000-0000-000000000002' and lesson_id = 'f0000000-0000-0000-0000-000000000003';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select not (public.handover_pack((select id from ids where k = 'tom2'))->>'closed')::boolean),
  'covering a lesson opens the pack again');
select public.mark_handover_viewed((select id from ids where k = 'tom2'));
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.reassign_lesson('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.handovers where id = (select id from ids where k = 'tom2')) = 1,
  'an opened cover pack stays listed after the cover is undone');
select pg_temp.check((select (public.handover_pack((select id from ids where k = 'tom2'))->>'closed')::boolean),
  'but it is closed once the lesson goes back to the regular tutor');
reset role;

select pg_temp.check((select count(*) from public.db_migrations where version = '20261113001300' and name = 'handoverac_fix') = 1,
  'the migrations ledger records the fix');
\echo 'All handover access tests passed'
