-- Subjects: enrolments, shared topic lists, the backfill, per-subject reports, and subjects on enquiries and bookings.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Tia and Tom are legacy tutors (curricula kept in subjects); Una teaches Chemistry; Vic is unrelated.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b3', 't3@x'),
  ('a0000000-0000-0000-0000-0000000000b4', 't4@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x');
insert into public.tutors (id, full_name, email, hourly_pay, subjects) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200, '{IB,IGCSE}'),
  ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 200, '{IGCSE}'),
  ('b0000000-0000-0000-0000-000000000003', 'Una Three', 't3@x', 200, '{Chemistry}'),
  ('b0000000-0000-0000-0000-000000000004', 'Vic Four', 't4@x', 200, '{}');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'), ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'other@x');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Una Three', 't3@x', 'b0000000-0000-0000-0000-000000000003', null),
  ('a0000000-0000-0000-0000-0000000000b4', 'tutor', 'Vic Four', 't4@x', 'b0000000-0000-0000-0000-000000000004', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto', 'other@x', null, 'c0000000-0000-0000-0000-000000000002');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB Diploma 1:1', 60, 450);

-- Backfill ---------------------------------------------------------------------
-- Legacy students, as they were before this migration (the creation trigger is paused to imitate old rows).
alter table public.students disable trigger students_enrol;
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-hl'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'IGCSE', 'igcse-0580'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'Zed Other', 'IB', 'retired-syllabus'),
  ('d0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000002', 'Kai Other', 'IGCSE', 'igcse-0606');
alter table public.students enable trigger students_enrol;
-- Sami: Tia twice, Tom once. Ollie: Tom once. Kai (Additional Maths): Tom once.
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location, status)
select tutor, students, 'e0000000-0000-0000-0000-000000000001', s, s + interval '1 hour', 'online', 'completed' from (values
  ('b0000000-0000-0000-0000-000000000001'::uuid, '{d0000000-0000-0000-0000-000000000001}'::uuid[], now() - interval '20 days'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}', now() - interval '13 days'),
  ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001}', now() - interval '6 days'),
  ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000002}', now() - interval '6 days'),
  ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000008}', now() - interval '5 days')
) v(tutor, students, s);
select pg_temp.check(not exists (select 1 from public.enrolments), 'legacy students start without enrolments');
select public.backfill_enrolments();
select pg_temp.check((select subject || '/' || curriculum || '/' || level || '/' || exam_board || '/' || syllabus_id || '/' || tutor_id
  from public.enrolments where student_id = 'd0000000-0000-0000-0000-000000000001')
  = 'Maths/IB DP/AA HL/IB/ib-aa-hl/b0000000-0000-0000-0000-000000000001', 'the IB AA HL student gets Maths with their most frequent tutor');
select pg_temp.check((select subject || '/' || curriculum || '/' || exam_board || '/' || tutor_id from public.enrolments
  where student_id = 'd0000000-0000-0000-0000-000000000002') = 'Maths/IGCSE/Cambridge/b0000000-0000-0000-0000-000000000002', 'Cambridge 0580 maps to IGCSE Maths');
select pg_temp.check((select subject || '/' || curriculum || '/' || coalesce(tutor_id::text, 'none') from public.enrolments
  where student_id = 'd0000000-0000-0000-0000-000000000003') = 'Maths/IB DP/none', 'an unknown syllabus keeps the curriculum, with IB read as IB DP');
select pg_temp.check(not exists (select 1 from public.lessons where subject is distinct from 'Maths'), 'existing lessons become Maths');
select pg_temp.check((select e.subject || '/' || e.curriculum || '/' || e.level || '/' || e.exam_board || '/' || e.syllabus_id from public.enrolments e
  where e.student_id = 'd0000000-0000-0000-0000-000000000008') = 'Maths/IGCSE/Additional/Cambridge/igcse-0606', 'Cambridge 0606 maps to IGCSE Maths at the Additional level');
select pg_temp.check((select bool_and(l.subject = e.subject) from public.lessons l join public.enrolments e on e.student_id = any (l.student_ids)),
  'every backfilled lesson''s subject matches its student''s enrolment, including Additional Maths');
select pg_temp.check((select subjects::text || ' ' || curricula::text from public.tutors where id = 'b0000000-0000-0000-0000-000000000001')
  = '{Maths} {"IB DP",IGCSE}', 'a legacy tutor''s curricula move out of subjects');
select pg_temp.check((select subjects::text || ' ' || curricula::text from public.tutors where id = 'b0000000-0000-0000-0000-000000000003')
  = '{Chemistry} {}', 'real subjects are left alone');
select public.backfill_enrolments();
select pg_temp.check((select count(*) from public.enrolments) = 4, 'running the backfill twice creates no duplicates');
select pg_temp.check((select subjects::text from public.tutors where id = 'b0000000-0000-0000-0000-000000000001') = '{Maths}', 'the tutor move is idempotent');

-- Students created by older app versions still get their Maths enrolment.
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 'Ava Other', 'IGCSE', 'igcse-0606');
select pg_temp.check((select subject || '/' || curriculum || '/' || level || '/' || exam_board || '/' || coalesce(tutor_id::text, 'none') from public.enrolments
  where student_id = 'd0000000-0000-0000-0000-000000000004') = 'Maths/IGCSE/Additional/Cambridge/none', 'the legacy insert trigger creates an enrolment');

-- New-style students: Lina (Mona's) studies Chemistry with Una (no lessons yet); Rami (Mona's) studies Maths with Tia,
-- Chemistry with Una and, no longer, Physics with Tom.
insert into public.students (id, family_id, full_name) values
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'Lina Ahmed'),
  ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 'Rami Ahmed');
select pg_temp.check((select count(*) from public.enrolments where student_id in ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000006')) = 0,
  'students without a syllabus get no automatic enrolment');
insert into public.enrolments (id, student_id, subject, curriculum, exam_board, tutor_id, active) values
  ('70000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', ' Chemistry ', 'IGCSE', 'Cambridge', 'b0000000-0000-0000-0000-000000000003', true),
  ('70000000-0000-0000-0000-000000000061', 'd0000000-0000-0000-0000-000000000006', 'Maths', 'IGCSE', null, 'b0000000-0000-0000-0000-000000000001', true),
  ('70000000-0000-0000-0000-000000000062', 'd0000000-0000-0000-0000-000000000006', 'Chemistry', 'A-Level', null, 'b0000000-0000-0000-0000-000000000003', true),
  ('70000000-0000-0000-0000-000000000063', 'd0000000-0000-0000-0000-000000000006', 'Physics', 'IGCSE', null, 'b0000000-0000-0000-0000-000000000002', false),
  -- Ollie also studies IGCSE Chemistry, so he shares Lina's list.
  ('70000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'chemistry', 'igcse', null, 'b0000000-0000-0000-0000-000000000002', true);
select pg_temp.check((select subject from public.enrolments where id = '70000000-0000-0000-0000-000000000005') = 'Chemistry', 'enrolment text is tidied');
do $$ begin
  insert into public.enrolments (student_id, subject, curriculum) values ('d0000000-0000-0000-0000-000000000005', 'CHEMISTRY', 'IGCSE');
  raise exception 'duplicate enrolment';
exception when unique_violation then raise notice 'ok - a student cannot study the same subject twice';
end $$;

-- Row-level security -----------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.enrolments) = 5
  and not exists (select 1 from public.enrolments e join public.students s on s.id = e.student_id where s.family_id <> 'c0000000-0000-0000-0000-000000000001'),
  'a parent sees only their own children''s enrolments');
do $$ begin
  insert into public.enrolments (student_id, subject) values ('d0000000-0000-0000-0000-000000000005', 'Biology');
  raise exception 'parent inserted';
exception when insufficient_privilege then raise notice 'ok - a parent cannot add enrolments directly';
end $$;
update public.enrolments set tutor_id = null where id = '70000000-0000-0000-0000-000000000005';
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
select pg_temp.check((select tutor_id from public.enrolments where id = '70000000-0000-0000-0000-000000000005') = 'b0000000-0000-0000-0000-000000000003',
  'a parent cannot change an enrolment');
select pg_temp.check(exists (select 1 from public.students where id = 'd0000000-0000-0000-0000-000000000005')
  and exists (select 1 from public.enrolments where id = '70000000-0000-0000-0000-000000000005'),
  'an assigned tutor sees the student and enrolment before any lesson');
select pg_temp.check(not exists (select 1 from public.enrolments where student_id = 'd0000000-0000-0000-0000-000000000004'), 'an assigned tutor sees no other students');
update public.enrolments set level = 'Core' where id = '70000000-0000-0000-0000-000000000005';
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b4');
select pg_temp.check((select count(*) from public.enrolments) = 0 and (select count(*) from public.students) = 0, 'an unrelated tutor sees no enrolments');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select level from public.enrolments where id = '70000000-0000-0000-0000-000000000005') is null, 'tutors cannot change enrolments directly');
select pg_temp.check((select count(*) from public.enrolments) = 10, 'admins see every enrolment');
reset role;
set role anon;
select pg_temp.as_user('');
do $$ begin
  perform count(*) from public.enrolments;
  raise exception 'anon read enrolments';
exception when insufficient_privilege then raise notice 'ok - the public cannot read enrolments';
end $$;
do $$ begin
  perform count(*) from public.topics;
  raise exception 'anon read topics';
exception when insufficient_privilege then raise notice 'ok - the public cannot read topics';
end $$;
reset role;

-- Shared topic lists -----------------------------------------------------------
set role authenticated;
create temp table added (id uuid);
grant all on added to authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
insert into added select (public.add_topic('70000000-0000-0000-0000-000000000005', '  Ionic   bonding ', 'Bonding')).id;
select pg_temp.check((select l.name || '/' || t.name || '/' || t.unit || '/' || t.sort from public.topics t join public.topic_lists l on l.id = t.list_id)
  = 'IGCSE Chemistry/Ionic bonding/Bonding/1', 'the assigned tutor adds a topic and the list is created');
select pg_temp.check((select topic_list_id from public.enrolments where id = '70000000-0000-0000-0000-000000000005') = (select id from public.topic_lists),
  'the enrolment is linked to the new list');
select pg_temp.check((select id from public.topics) = (select (public.add_topic('70000000-0000-0000-0000-000000000005', 'ionic bonding', 'bonding')).id),
  'the same name in the same unit returns the existing topic');
select public.add_topic('70000000-0000-0000-0000-000000000005', 'Electrolysis');
select pg_temp.check((select sort || '/' || coalesce(unit, 'none') from public.topics where name = 'Electrolysis') = '2/none', 'a topic without a unit goes last');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select topic_list_id from public.enrolments where id = '70000000-0000-0000-0000-000000000002') = (select id from public.topic_lists),
  'another student with the same subject, curriculum and level shares the list');
insert into public.enrolments (id, student_id, subject, curriculum) values
  ('70000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003', 'Chemistry', 'IGCSE');
select pg_temp.check((select topic_list_id from public.enrolments where id = '70000000-0000-0000-0000-000000000007') = (select id from public.topic_lists),
  'a new matching enrolment is linked to the existing list');
select pg_temp.check((select topic_list_id from public.enrolments where id = '70000000-0000-0000-0000-000000000062') is null,
  'a different curriculum does not share the list');
-- Tom teaches Ollie, so he may add to Ollie's (shared) list.
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.add_topic('70000000-0000-0000-0000-000000000002', 'Covalent bonding', 'Bonding');
select pg_temp.check((select count(*) from public.topics) = 3, 'a tutor who teaches the student adds to the shared list');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b4');
select pg_temp.check((select count(*) from public.topics) = 3, 'every signed-in user can read the shared topics');
do $$ begin
  perform public.add_topic('70000000-0000-0000-0000-000000000005', 'Polymers');
  raise exception 'unrelated tutor added';
exception when insufficient_privilege then raise notice 'ok - an unrelated tutor cannot add topics';
end $$;
do $$ begin
  insert into public.topics (list_id, name) select id, 'Sneaky' from public.topic_lists;
  raise exception 'tutor inserted directly';
exception when insufficient_privilege then raise notice 'ok - tutors cannot write topics directly';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.add_topic('70000000-0000-0000-0000-000000000005', 'Polymers');
  raise exception 'parent added';
exception when insufficient_privilege then raise notice 'ok - parents cannot add topics';
end $$;

-- Reports per subject ----------------------------------------------------------
reset role;
-- Rami: Maths with Tia (twice), Chemistry with Una, and an old Physics lesson with Tom (enrolment now inactive).
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location, status, subject)
select tutor, '{d0000000-0000-0000-0000-000000000006}', 'e0000000-0000-0000-0000-000000000001', s, s + interval '1 hour', 'online', 'completed', subj from (values
  ('b0000000-0000-0000-0000-000000000001'::uuid, now() - interval '9 days', 'Maths'),
  ('b0000000-0000-0000-0000-000000000001', now() - interval '2 days', 'Maths'),
  ('b0000000-0000-0000-0000-000000000003', now() - interval '3 days', 'chemistry'),
  ('b0000000-0000-0000-0000-000000000002', now() - interval '4 days', 'Physics')
) v(tutor, s, subj);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.open_report_cycle('Autumn term', (now() - interval '30 days')::date, (now() + interval '14 days')::date);
select pg_temp.check((select string_agg(subject || ':' || t.full_name, ', ' order by subject) from public.student_reports r join public.tutors t on t.id = r.tutor_id
  where student_id = 'd0000000-0000-0000-0000-000000000006') = 'Chemistry:Una Three, Maths:Tia One',
  'a student with two subjects gets a report for each, written by that subject''s tutor');
select pg_temp.check((select enrolment_id from public.student_reports where student_id = 'd0000000-0000-0000-0000-000000000006' and subject = 'Chemistry')
  = '70000000-0000-0000-0000-000000000062', 'the report is linked to its enrolment');
select pg_temp.check(not exists (select 1 from public.student_reports where subject = 'Physics'), 'an inactive enrolment gets no report');
select pg_temp.check((select subject || ':' || tutor_id from public.student_reports where student_id = 'd0000000-0000-0000-0000-000000000001')
  = 'Maths:b0000000-0000-0000-0000-000000000001', 'a backfilled student gets their Maths report from their enrolment tutor');
select pg_temp.check(not exists (select 1 from public.student_reports where student_id = 'd0000000-0000-0000-0000-000000000005'), 'no report without lessons');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Reports to write: Autumn term' and body like 'You have % report% to write for Autumn term%') >= 2,
  'tutors are told about their reports');
select pg_temp.check((select subject || ':' || enrolment_id from public.student_reports where student_id = 'd0000000-0000-0000-0000-000000000008')
  = 'Maths:' || (select id from public.enrolments where student_id = 'd0000000-0000-0000-0000-000000000008'),
  'an Additional Maths student''s report is linked to their enrolment');
-- Publishing names the subject, since a family may receive several reports in one round.
update public.student_reports set status = 'submitted' where student_id = 'd0000000-0000-0000-0000-000000000006' and subject = 'Chemistry';
set role authenticated;
select public.set_report_status((select id from public.student_reports where student_id = 'd0000000-0000-0000-0000-000000000006' and subject = 'Chemistry'), 'published');
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'Autumn term report for Rami · Chemistry'
  and body = 'Rami''s Autumn term Chemistry report is ready to read in the Elite Education app.'), 'the publication notice names the subject');
-- The same subject in two curricula gets two reports.
insert into public.enrolments (student_id, subject, curriculum, tutor_id) values
  ('d0000000-0000-0000-0000-000000000006', 'Maths', 'A-Level', 'b0000000-0000-0000-0000-000000000002');
set role authenticated;
select public.open_report_cycle('Spring term', (now() - interval '30 days')::date, (now() + interval '14 days')::date);
select pg_temp.check((select string_agg(r.subject || ':' || coalesce(e.curriculum, '') || ':' || t.full_name, ', ' order by r.subject, e.curriculum)
  from public.student_reports r join public.tutors t on t.id = r.tutor_id join public.enrolments e on e.id = r.enrolment_id
  join public.report_cycles c on c.id = r.cycle_id
  where c.name = 'Spring term' and r.student_id = 'd0000000-0000-0000-0000-000000000006')
  = 'Chemistry:A-Level:Una Three, Maths:A-Level:Tom Two, Maths:IGCSE:Tia One', 'Maths IGCSE and Maths A-Level each get their own report');
-- Tia teaches Rami Maths only, so she cannot write into the shared Chemistry list.
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.add_topic('70000000-0000-0000-0000-000000000062', 'Organic synthesis');
  raise exception 'other-subject tutor added';
exception when insufficient_privilege then raise notice 'ok - a tutor of another subject cannot add topics';
end $$;

-- Parents add a child with subjects --------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
create temp table kid (id uuid);
grant all on kid to authenticated;
insert into kid select public.add_my_child('Nina Other', p_school => 'Repton Dubai', p_year_group => 'Year 4', p_phase => 'Primary', p_subjects =>
  '[{"subject":"English","curriculum":"British"},{"subject":"Maths","curriculum":"British","level":"Higher","exam_board":"AQA"}]');
select pg_temp.check((select phase || '/' || coalesce(curriculum, 'none') || '/' || coalesce(syllabus_id, 'none') from public.students where id = (select id from kid))
  = 'Primary/none/none', 'the child is saved with a phase and no legacy curriculum');
select pg_temp.check((select string_agg(subject || '|' || curriculum || '|' || coalesce(level, '') || '|' || coalesce(exam_board, '') || '|' || coalesce(tutor_id::text, ''), ', ' order by subject)
  from public.enrolments where student_id = (select id from kid)) = 'English|British|||, Maths|British|Higher|AQA|', 'the child''s two subjects become enrolments');
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'New child added: Nina Other'
  and body like 'Otto added Nina Other (Year 4).%Subjects: British English, British Maths (Higher)%within one working day.'
  and url = '/students/' || (select id from kid)), 'the office is told about the new child and their subjects');
set role authenticated;
do $$ begin
  perform public.add_my_child('Empty Other', p_subjects => '[]');
  raise exception 'no subjects accepted';
exception when raise_exception then
  if sqlerrm = 'no subjects accepted' then raise; end if;
  raise notice 'ok - a child needs at least one subject';
end $$;
do $$ begin
  perform public.add_my_child('Twice Other', p_subjects => '[{"subject":"Maths"},{"subject":"maths"}]');
  raise exception 'duplicate subjects accepted';
exception when raise_exception then
  if sqlerrm = 'duplicate subjects accepted' then raise; end if;
  raise notice 'ok - a subject cannot be listed twice';
end $$;
select pg_temp.check(not exists (select 1 from public.students where full_name in ('Empty Other', 'Twice Other')), 'refused children are not saved');
-- Older app clients still call add_my_child with a curriculum and syllabus and get a Maths enrolment
insert into kid select public.add_my_child(p_full_name => 'Legacy Other', p_curriculum => 'IGCSE', p_syllabus_id => 'igcse-4ma1',
  p_school => null, p_year_group => 'Year 9');
select pg_temp.check((select string_agg(e.subject || '|' || coalesce(e.curriculum, ''), ', ') from public.enrolments e
  join public.students s on s.id = e.student_id where s.full_name = 'Legacy Other') = 'Maths|IGCSE',
  'an older client''s child gets a Maths enrolment');
-- A family's choice of course is kept (and fills its exam board); without one, the single course that fits is found
insert into kid select public.add_my_child('Course Other', p_subjects =>
  '[{"subject":"Maths","curriculum":"IGCSE","syllabus_id":"igcse-4ma1"},{"subject":"Chemistry","curriculum":"IGCSE","syllabus_id":"igcse-0580"}]');
select pg_temp.check((select string_agg(e.subject || '|' || coalesce(e.curriculum, '') || '|' || coalesce(e.level, '') || '|' || coalesce(e.exam_board, '') || '|' || coalesce(e.syllabus_id, ''), ', ' order by e.subject)
  from public.enrolments e join public.students s on s.id = e.student_id where s.full_name = 'Course Other')
  = 'Chemistry|IGCSE|||, Maths|IGCSE||Pearson Edexcel|igcse-4ma1',
  'a parent-added Maths IGCSE (Edexcel) child gets syllabus igcse-4ma1, and a course that does not fit the subject is ignored');
insert into kid select public.add_my_child('Infer Other', p_subjects =>
  '[{"subject":"Maths","curriculum":"IGCSE","exam_board":"Pearson Edexcel"},{"subject":"Maths","curriculum":"IB DP","level":"AA HL"},'
  '{"subject":"Additional Maths","curriculum":"IGCSE"},{"subject":"Maths","curriculum":"A-Level","syllabus_id":"made-up"}]');
select pg_temp.check((select string_agg(e.subject || '|' || coalesce(e.curriculum, '') || '|' || coalesce(e.level, '') || '|' || coalesce(e.exam_board, '') || '|' || coalesce(e.syllabus_id, ''), ', ' order by e.subject, e.curriculum)
  from public.enrolments e join public.students s on s.id = e.student_id where s.full_name = 'Infer Other')
  = 'Additional Maths|IGCSE||Cambridge|igcse-0606, Maths|A-Level|||alevel-maths, Maths|IB DP|AA HL|IB|ib-aa-hl, Maths|IGCSE||Pearson Edexcel|igcse-4ma1',
  'without a course, the one built-in course that matches the curriculum, level and exam board is chosen; unknown ids are ignored');
select pg_temp.check(public.builtin_syllabus_for('Maths', 'IGCSE', null, 'Cambridge', 'igcse-4ma1') = 'igcse-0580'
  and public.builtin_syllabus_for('Maths', 'IB DP', 'AI SL', null, 'ib-aa-hl') = 'ib-ai-sl'
  and public.builtin_syllabus_for('Maths', 'IGCSE', 'Additional', null, 'igcse-0580') = 'igcse-0606'
  and public.builtin_syllabus_for('Maths', 'IGCSE', 'Extended', 'Cambridge', 'igcse-0580') = 'igcse-0580',
  'a requested course is dropped when the level or exam board given beside it contradicts it');
insert into kid select public.add_my_child('Unsure Other', p_subjects => '[{"subject":"Maths","curriculum":"IGCSE"}]');
select pg_temp.check((select coalesce(e.syllabus_id, 'none') from public.enrolments e join public.students s on s.id = e.student_id
  where s.full_name = 'Unsure Other') = 'none', 'when two courses fit, none is guessed');

-- Enquiries record subject and phase -------------------------------------------
reset role;
set role anon;
select pg_temp.as_user('');
select public.submit_enquiry('Rita Rahman', 'rita@x', null, 'Zara', 'British', 'Year 3', 'Reading support', 'Afternoons', 'website',
  p_subject => 'English', p_phase => 'Primary');
reset role;
select pg_temp.check((select subject || '/' || phase from public.enquiries where email = 'rita@x') = 'English/Primary', 'an enquiry from the website stores subject and phase');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject like 'New enquiry: Rita%' and body like '%Subject: English%Phase: Primary%'),
  'the office is told the subject and phase');
select pg_temp.check((select body from public.notification_outbox where email = 'rita@x') like 'Dear Rita,%complimentary consultation%Elite Education | eliteeducation.me',
  'the acknowledgement is formal');

-- Tutor applications record phases ---------------------------------------------
set role anon;
select public.submit_tutor_application('Nina New', 'nina@x', null, '{British,IB DP}', 'English Literature', null, null, null, null, '{Primary,Lower Secondary}');
reset role;
select pg_temp.check((select phases::text from public.tutor_applications) = '{Primary,"Lower Secondary"}', 'an application stores its phases');

-- Booking carries the subject --------------------------------------------------
insert into public.availability (tutor_id, weekday, start_time, end_time)
select 'b0000000-0000-0000-0000-000000000003', d, '15:00', '18:00' from generate_series(0, 6) d;
create temp table req (id uuid);
grant all on req to authenticated;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
insert into req select public.request_lesson('d0000000-0000-0000-0000-000000000005', 'new-lesson', null, 'b0000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000001', (((now() at time zone 'Asia/Dubai')::date + 4) + time '16:00') at time zone 'Asia/Dubai', null, 'Chemistry');
select pg_temp.check((select subject from public.lesson_requests where id = (select id from req)) = 'Chemistry', 'a lesson request stores its subject');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.decide_request((select id from req), true);
select pg_temp.check((select subject from public.lessons where 'd0000000-0000-0000-0000-000000000005' = any (student_ids)) = 'Chemistry',
  'approving the request books a lesson in that subject');
reset role;
\echo 'All subjects tests passed'
