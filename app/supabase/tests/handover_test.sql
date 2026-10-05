-- Session plans and tutor handover packs.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
-- Run a statement that must fail, with the given SQLSTATE or message.
create function pg_temp.fails(stmt text, want text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED (no error): %', label;
exception when others then
  if sqlerrm like 'FAILED (no error)%' then raise; end if;
  if want is not null and sqlstate <> want and sqlerrm <> want then
    raise exception 'FAILED: % (got % %)', label, sqlstate, sqlerrm;
  end if;
  raise notice 'ok - %', label;
end $$;

-- Boss (admin); Tia taught Sami Maths; Tom covers; Cy is unrelated.
-- Mona is Sami's mother, Sami has his own login, Otto is another family's father.
update public.settings set bank_details = 'Elite Education FZ LLC, IBAN AE990331234567890123456' where id = 1;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b3', 't3@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'), ('a0000000-0000-0000-0000-00000000000d', 'sami@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200), ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250),
  ('b0000000-0000-0000-0000-000000000003', 'Cy Three', 't3@x', 250);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'), ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'other@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'Sixth Form and IB Diploma');
insert into public.enrolments (id, student_id, subject, curriculum, level, tutor_id) values
  ('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'IB DP', 'AA SL', 'b0000000-0000-0000-0000-000000000001');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Cy Three', 't3@x', 'b0000000-0000-0000-0000-000000000003', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000d', 'student', 'Sami Ahmed', 'sami@x', null, null, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto', 'other@x', null, 'c0000000-0000-0000-0000-000000000002', null);
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '9 days', now() - interval '9 days' + interval '1 hour', 'online', 'completed', 'Maths'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'online', 'completed', 'Maths'),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'online', 'scheduled', 'Maths');
insert into public.lesson_notes (lesson_id, summary, topic_ids) values
  ('f0000000-0000-0000-0000-000000000001', 'Quadratics: completing the square.', '{ib-aa-sl-2.1}'),
  ('f0000000-0000-0000-0000-000000000002', 'Sequences and series.', '{ib-aa-sl-1.2}');
insert into public.lesson_private_notes (lesson_id, private_note) values
  ('f0000000-0000-0000-0000-000000000001', 'Private: anxious before tests');
insert into public.student_notes (student_id, notes) values ('d0000000-0000-0000-0000-000000000001', 'Prefers worked examples');
insert into public.topic_ratings (student_id, topic_id, lesson_id, rating, rated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'ib-aa-sl-2.1', 'f0000000-0000-0000-0000-000000000001', 2, now() - interval '9 days'),
  ('d0000000-0000-0000-0000-000000000001', 'ib-aa-sl-1.2', 'f0000000-0000-0000-0000-000000000002', 4, now() - interval '2 days');
insert into public.resources (id, title, kind, path, url, student_ids) values
  ('e2000000-0000-0000-0000-000000000001', 'Worksheet', 'file', 'resources/sheet.pdf', null, '{}'),
  ('e2000000-0000-0000-0000-000000000002', 'Video', 'link', null, 'https://example.com/video', '{}'),
  ('e2000000-0000-0000-0000-000000000003', 'Unrelated', 'link', null, 'https://example.com/other', '{}');
insert into public.homework (student_id, lesson_id, title, due_date, done, tutor_id, attachments) values
  ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'Ex 4B', current_date + 2, false,
   'b0000000-0000-0000-0000-000000000001',
   '[{"kind":"file","name":"Worksheet","path":"resources/sheet.pdf","resourceId":"e2000000-0000-0000-0000-000000000001"}]'),
  ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Ex 3A', current_date - 5, true,
   'b0000000-0000-0000-0000-000000000001', '[]');
insert into public.report_cycles (id, name, starts_on, due_date) values
  ('e3000000-0000-0000-0000-000000000001', 'Autumn term', current_date - 60, current_date - 10);
insert into public.student_reports (cycle_id, student_id, tutor_id, status, subject, comment, published_at) values
  ('e3000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'published', 'Maths', 'Working towards a 6.', now() - interval '10 days');

create temp table ids (k text primary key, id uuid);
create temp table packs (k text primary key, j jsonb);
grant all on ids, packs to authenticated;
set role authenticated;

-- (1) Planning a lesson -----------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', '  Consolidate sequences. ', '{ib-aa-sl-1.2, " ", ib-aa-sl-1.2}',
  '{e2000000-0000-0000-0000-000000000002}',
  '[{"studentId":"d0000000-0000-0000-0000-000000000001","title":" Ex 5A ","details":""}]', false);
select pg_temp.check((select objectives || '|' || array_to_string(topic_ids, ',') || '|' || tutor_id || '|' || homework::text
  from public.lesson_plans where lesson_id = 'f0000000-0000-0000-0000-000000000003')
  = 'Consolidate sequences.|ib-aa-sl-1.2|b0000000-0000-0000-0000-000000000001|[{"title": "Ex 5A", "studentId": "d0000000-0000-0000-0000-000000000001"}]',
  'the lesson''s tutor saves a plan, trimmed and normalised');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null, null, false)$$,
  '42501', 'another tutor cannot plan the lesson');
select pg_temp.fails($$select public.delete_lesson_plan('f0000000-0000-0000-0000-000000000003')$$, '42501', 'another tutor cannot delete the plan');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null, null, false)$$,
  '42501', 'a parent cannot plan a lesson');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null, null, false)$$,
  '42501', 'a student cannot plan a lesson');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null,
  (select jsonb_agg(jsonb_build_object('title', 'Task ' || n)) from generate_series(1, 11) n), false)$$,
  'A plan can include up to 10 homework items.', 'no more than ten planned homework items');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null,
  '[{"title":"   ","details":"Something"}]', false)$$, 'Each planned homework item needs a title.', 'planned homework needs a title');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null,
  '[{"studentId":"d0000000-0000-0000-0000-000000000002","title":"Ex 1"}]', false)$$,
  'Planned homework must be for a student in this lesson.', 'planned homework must be for a student in the lesson');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', '   ', null, '{}', '[]', false)$$,
  'Please add an objective, a topic, a resource or planned homework.', 'an empty plan is refused');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000002', 'x', null, null, null, false)$$,
  'Only scheduled lessons can be planned.', 'only scheduled lessons can be planned');

-- (2) Who sees the plan ------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.visible_lesson_plans()) = 0, 'a private plan is hidden from the parent');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.visible_lesson_plans()) = 0, 'a private plan is hidden from the student');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.lesson_plans) = 1, 'the tutor sees their plan');
select pg_temp.check((select count(*) from public.visible_lesson_plans('f0000000-0000-0000-0000-000000000003')) = 1,
  'the tutor reads their plan through visible_lesson_plans');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.lesson_plans) = 1, 'admins see every plan');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'Consolidate sequences.', '{ib-aa-sl-1.2}',
  '{e2000000-0000-0000-0000-000000000002, e2000000-0000-0000-0000-0000000000ff}',
  '[{"studentId":"d0000000-0000-0000-0000-000000000001","title":"Ex 5A"}]', true);
select pg_temp.check((select resource_ids = '{e2000000-0000-0000-0000-000000000002}' from public.lesson_plans),
  'unknown resources are dropped from the plan');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.lesson_plans) = 0, 'parents cannot read the plans table directly');
select pg_temp.check((select count(*) from public.visible_lesson_plans()) = 1, 'a shared plan is visible to the parent');
select pg_temp.check((select count(*) from public.visible_lesson_plans(null, now(), now() + interval '7 days')) = 1,
  'the parent lists shared plans by date');
select pg_temp.check((select count(*) from public.visible_lesson_plans(null, now() + interval '7 days', now() + interval '14 days')) = 0,
  'the date range is respected');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.lesson_plans) = 0, 'students cannot read the plans table directly');
select pg_temp.check((select count(*) from public.visible_lesson_plans('f0000000-0000-0000-0000-000000000003')) = 1,
  'a shared plan is visible to the student');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.visible_lesson_plans()) = 0, 'another family never sees the plan');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.lesson_plans) = 0, 'another tutor does not see the plan');
select pg_temp.check((select count(*) from public.visible_lesson_plans()) = 0, 'another tutor does not read the plan through the function');

-- (2b) A group lesson shared with two families ----------------------------------
reset role;
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001',
   '{d0000000-0000-0000-0000-000000000001, d0000000-0000-0000-0000-000000000002}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days' + interval '1 hour', 'online', 'scheduled', 'Physics');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.save_lesson_plan('f0000000-0000-0000-0000-000000000009', 'Forces.', null, null,
  '[{"title":"Read chapter 2"},{"studentId":"d0000000-0000-0000-0000-000000000001","title":"Sami: momentum questions"},
    {"studentId":"d0000000-0000-0000-0000-000000000002","title":"Ollie: catch-up sheet"}]', true);
select pg_temp.check((select jsonb_array_length(homework) = 3 from public.visible_lesson_plans('f0000000-0000-0000-0000-000000000009')),
  'the group lesson''s tutor sees every planned homework item');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select string_agg(h->>'title', ',' order by o) from public.visible_lesson_plans('f0000000-0000-0000-0000-000000000009') p,
  jsonb_array_elements(p.homework) with ordinality x(h, o)) = 'Read chapter 2,Sami: momentum questions',
  'a parent in a group lesson sees general homework and their own child''s only');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select string_agg(h->>'title', ',' order by o) from public.visible_lesson_plans('f0000000-0000-0000-0000-000000000009') p,
  jsonb_array_elements(p.homework) with ordinality x(h, o)) = 'Read chapter 2,Sami: momentum questions',
  'a student in a group lesson sees general homework and their own only');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select string_agg(h->>'title', ',' order by o) from public.visible_lesson_plans('f0000000-0000-0000-0000-000000000009') p,
  jsonb_array_elements(p.homework) with ordinality x(h, o)) = 'Read chapter 2,Ollie: catch-up sheet',
  'the other family never sees homework planned for Sami');
select pg_temp.check(not exists (select 1 from public.visible_lesson_plans() p where p.homework::text like '%d0000000-0000-0000-0000-000000000001%'),
  'the other family never sees Sami''s student id in a plan');

-- (3) No direct writes --------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$insert into public.lesson_plans (lesson_id, objectives) values ('f0000000-0000-0000-0000-000000000002', 'x')$$,
  '42501', 'plans cannot be inserted directly');
select pg_temp.fails($$update public.lesson_plans set objectives = 'x'$$, '42501', 'plans cannot be updated directly');
select pg_temp.fails($$delete from public.lesson_plans$$, '42501', 'plans cannot be deleted directly');
select pg_temp.fails($$insert into public.handovers (reason, student_id, to_tutor_id)
  values ('cover', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')$$,
  '42501', 'handovers cannot be inserted directly');
select pg_temp.fails($$update public.handovers set note = 'x'$$, '42501', 'handovers cannot be updated directly');
select pg_temp.fails($$delete from public.handovers$$, '42501', 'handovers cannot be deleted directly');

-- (4) Cover creates a handover -------------------------------------------------
select public.reassign_lesson('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002');
reset role;
insert into ids select 'cover', id from public.handovers;
select pg_temp.check((select count(*) from public.handovers) = 1, 'covering a lesson creates one handover');
select pg_temp.check((select reason || '/' || from_tutor_id || '/' || to_tutor_id || '/' || lesson_id || '/' || subject || '/' || enrolment_id
  from public.handovers) = 'cover/b0000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000002/f0000000-0000-0000-0000-000000000003/Maths/e1000000-0000-0000-0000-000000000001',
  'the cover handover runs from Tia to Tom for the lesson and enrolment');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b2'
  and subject = 'Handover pack: Sami Ahmed (Maths)' and url = '/handover/' || (select id from ids where k = 'cover')
  and body like 'You are covering Sami Ahmed''s Maths lesson on %. Your handover pack has%') = 1,
  'the incoming tutor is sent the handover pack');
select pg_temp.check((select bool_and(body ~ ' on [A-Z][a-z]+day [1-9][0-9]? [A-Z][a-z]{2} at [0-9]{2}:[0-9]{2}\.') from public.notification_outbox
  where subject = 'Handover pack: Sami Ahmed (Maths)'), 'the lesson date reads naturally, without a leading zero');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b1'
  and subject = 'Handover note for Sami Ahmed' and url = '/handover/' || (select id from ids where k = 'cover')
  and body like 'Tom Two is covering Sami Ahmed''s Maths lesson on %Please add a short handover note%') = 1,
  'the outgoing tutor is asked for a handover note');
set role authenticated;

-- (5) The incoming tutor's pack -----------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.handovers) = 1, 'the incoming tutor sees the handover');
insert into packs select 'tom', public.handover_pack((select id from ids where k = 'cover'));
select pg_temp.check((select j->'handover'->>'id' = (select id::text from ids where k = 'cover') from packs where k = 'tom'), 'the pack carries the handover');
select pg_temp.check((select j->'student'->>'full_name' = 'Sami Ahmed' and j->'student'->'student_notes'->>'notes' = 'Prefers worked examples'
  from packs where k = 'tom'), 'the pack includes the tutor-only student notes');
select pg_temp.check((select j->'enrolment'->>'subject' = 'Maths' from packs where k = 'tom'), 'the pack includes the enrolment');
select pg_temp.check((select jsonb_array_length(j->'lessons') = 2 and j->'lessons'->0->>'id' = 'f0000000-0000-0000-0000-000000000002'
  from packs where k = 'tom'), 'the pack lists recent lessons, newest first');
select pg_temp.check((select jsonb_array_length(j->'notes') = 2 and j->'notes'->0->>'summary' = 'Sequences and series.'
  from packs where k = 'tom'), 'the pack includes the lesson summaries');
select pg_temp.check((select bool_and(n->'lesson_private_notes' = 'null'::jsonb) from packs, jsonb_array_elements(j->'notes') n where k = 'tom'),
  'Tia''s private lesson notes are not in Tom''s pack');
select pg_temp.check((select jsonb_array_length(j->'homework') = 1 and j->'homework'->0->>'title' = 'Ex 4B' from packs where k = 'tom'),
  'the pack lists open homework only');
select pg_temp.check((select jsonb_array_length(j->'plans') = 1 and j->'plans'->0->>'objectives' = 'Consolidate sequences.'
  and j->'plans'->0 ? 'lesson_start_at' from packs where k = 'tom'), 'the pack includes the lesson plan');
select pg_temp.check((select jsonb_array_length(j->'ratings') = 2 and (j->'ratings'->0->>'rating')::int = 2 from packs where k = 'tom'),
  'the pack includes the topic ratings, oldest first');
select pg_temp.check((select string_agg(r->>'title', ',' order by r->>'title') = 'Video,Worksheet' and bool_and(not r ? 'student_ids')
  from packs, jsonb_array_elements(j->'resources') r where k = 'tom'), 'the pack lists the planned and attached resources');
select pg_temp.check((select j->'latest_report'->>'comment' = 'Working towards a 6.' from packs where k = 'tom'), 'the pack includes the latest report');
select pg_temp.check((select count(*) from public.lesson_plans) = 1, 'the covering tutor now sees the lesson plan');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($$select public.save_lesson_plan('f0000000-0000-0000-0000-000000000003', 'x', null, null, null, false)$$,
  '42501', 'the outgoing tutor can no longer plan the covered lesson');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into packs select 'boss', public.handover_pack((select id from ids where k = 'cover'));
select pg_temp.check((select count(*) from packs, jsonb_array_elements(j->'notes') n
  where k = 'boss' and n->'lesson_private_notes'->>'private_note' = 'Private: anxious before tests') = 1,
  'admins see the private lesson notes in the pack');

-- (6) The outgoing tutor and everyone else -------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.handovers) = 1, 'the outgoing tutor sees the handover');
select public.save_handover_note((select id from ids where k = 'cover'), '  Sami likes to start with a recap.  ');
select pg_temp.fails($$select public.handover_pack((select id from ids where k = 'cover'))$$, '42501', 'the outgoing tutor cannot open the pack');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select note = 'Sami likes to start with a recap.' and note_updated_at is not null from public.handovers),
  'the outgoing tutor saves a handover note');
select pg_temp.fails($$select public.save_handover_note((select id from ids where k = 'cover'), 'mine')$$, '42501',
  'the incoming tutor cannot write the outgoing note');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b2'
  and subject = 'Handover note for Sami Ahmed' and body = 'Tia One has added a handover note for Sami Ahmed (Maths).') = 1,
  'the incoming tutor hears about the note');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
select pg_temp.check((select count(*) from public.handovers) = 0, 'an unrelated tutor sees no handovers');
select pg_temp.fails($$select public.handover_pack((select id from ids where k = 'cover'))$$, '42501', 'an unrelated tutor cannot open the pack');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.handovers) = 0, 'parents see no handovers');
select pg_temp.fails($$select public.handover_pack((select id from ids where k = 'cover'))$$, '42501', 'parents cannot open the pack');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.handovers) = 0, 'students see no handovers');
select pg_temp.fails($$select public.handover_pack((select id from ids where k = 'cover'))$$, '42501', 'students cannot open the pack');

-- (7) Viewed -------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.mark_handover_viewed((select id from ids where k = 'cover'));
reset role;
select pg_temp.check((select viewed_at is null from public.handovers), 'only the incoming tutor marks the pack viewed');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.mark_handover_viewed((select id from ids where k = 'cover'));
reset role;
select pg_temp.check((select viewed_at is not null from public.handovers), 'the incoming tutor marks the pack viewed');

-- (8) Enrolment changes ----------------------------------------------------------
update public.enrolments set tutor_id = 'b0000000-0000-0000-0000-000000000002' where id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.handovers) = 1, 'moving the enrolment to the covering tutor reuses the recent handover');
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'Handover pack:%') = 1, 'and sends no second pack');
insert into public.enrolments (id, student_id, subject, tutor_id) values
  ('e1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Chemistry', 'b0000000-0000-0000-0000-000000000001');
update public.enrolments set tutor_id = 'b0000000-0000-0000-0000-000000000002' where id = 'e1000000-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.handovers where reason = 'reassigned' and subject = 'Chemistry'
  and enrolment_id = 'e1000000-0000-0000-0000-000000000002' and from_tutor_id = 'b0000000-0000-0000-0000-000000000001'
  and to_tutor_id = 'b0000000-0000-0000-0000-000000000002') = 1, 'reassigning another subject creates a new handover');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Handover pack: Sami Ahmed (Chemistry)'
  and body like 'You are now Sami Ahmed''s Chemistry tutor. Your handover pack has%') = 1, 'the new tutor is welcomed to the subject');

-- (9) Awarded roles ---------------------------------------------------------------
insert into public.opportunities (id, title, pay_rate, student_id, subject) values
  ('e4000000-0000-0000-0000-000000000001', 'IB Physics for Sami', 250, 'd0000000-0000-0000-0000-000000000001', 'Physics'),
  ('e4000000-0000-0000-0000-000000000002', 'GCSE English', 200, null, 'English');
insert into public.opportunity_bids (opportunity_id, tutor_id, pitch) values
  ('e4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'Physics specialist.'),
  ('e4000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'English specialist.');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.award_opportunity(id) from public.opportunity_bids order by opportunity_id;
reset role;
select pg_temp.check((select count(*) from public.handovers where reason = 'awarded' and subject = 'Physics' and from_tutor_id is null
  and to_tutor_id = 'b0000000-0000-0000-0000-000000000003' and opportunity_id = 'e4000000-0000-0000-0000-000000000001') = 1,
  'awarding a role with a student creates a handover for the new tutor');
select pg_temp.check((select count(*) from public.handovers) = 3, 'a role without a student creates no handover');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Handover pack: Sami Ahmed (Physics)'
  and body like 'Welcome to Sami Ahmed''s Physics lessons. Your handover pack has%') = 1, 'the awarded tutor is sent the pack');

-- (10) Bank details ----------------------------------------------------------------
select pg_temp.check(not exists (select 1 from public.notification_outbox where body like '%AE99033%' or subject like '%AE99033%'),
  'bank details never appear in notifications');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
select pg_temp.fails($$select public.save_handover_note((select id from public.handovers where reason = 'awarded'), 'x')$$, '42501',
  'nobody but an admin writes the note when there was no previous tutor');
reset role;
\echo 'All handover tests passed'
