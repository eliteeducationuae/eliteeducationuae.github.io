-- Admissions advisory: who sees a case, what the adviser and the family may do, documents, advisory updates,
-- the timeline, fees, storage rules and reminders.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss (admin); Tia teaches Sami (family Ahmed) but is not his adviser; Tom advises Sami and teaches Ollie (family Other).
-- Mona is Sami's mother, Sami has his own login, Otto is Ollie's father.
update public.settings set bank_details = 'Elite Education FZ LLC, IBAN AE990331234567890123456', vat_rate = 0.05 where id = 1;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000d', 'sami@x'), ('a0000000-0000-0000-0000-00000000000e', 'other@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200), ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'), ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'other@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'Sixth Form and IB Diploma');
insert into public.enrolments (id, student_id, subject, curriculum, level, exam_board, syllabus_id, tutor_id) values
  ('70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'IB DP', 'AA SL', 'IB', 'ib-aa-sl', 'b0000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Chemistry', 'IB DP', 'HL', null, null, 'b0000000-0000-0000-0000-000000000002');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000d', 'student', 'Sami Ahmed', 'sami@x', null, null, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto', 'other@x', null, 'c0000000-0000-0000-0000-000000000002', null);
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'online', 'completed'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000002}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'online', 'completed');

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
set role authenticated;

-- Opening cases ----------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into ids select 'case', (public.save_admissions_case(null, 'd0000000-0000-0000-0000-000000000001', 'uk-university',
  '  UK universities 2027 ', '2027', null, 'b0000000-0000-0000-0000-000000000002', 'Medicine and biomedical sciences.')).id;
insert into ids select 'other', (public.save_admissions_case(null, 'd0000000-0000-0000-0000-000000000002', 'boarding',
  'Boarding schools', 'September 2027', 'active', null, null)).id;
select pg_temp.check((select title || '/' || family_id || '/' || status from public.admissions_cases where id = (select id from ids where k = 'case'))
  = 'UK universities 2027/c0000000-0000-0000-0000-000000000001/active', 'the office opens a case; the family comes from the student');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'You are now advising Sami'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b2' and url = '/admissions/' || (select id from ids where k = 'case')) = 1,
  'the adviser is told when a case is given to them');
select pg_temp.check((select count(*) from public.admissions_events where case_id = (select id from ids where k = 'case')
  and kind = 'case' and title = 'Admissions advisory opened: UK universities 2027') = 1, 'opening a case starts the timeline');
set role authenticated;
do $$ begin
  insert into public.admissions_cases (student_id, family_id, kind, title)
  values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'other', 'Wrong family');
  if (select family_id from public.admissions_cases where title = 'Wrong family') <> 'c0000000-0000-0000-0000-000000000001' then
    raise exception 'family_id trusted from input';
  end if;
  delete from public.admissions_cases where title = 'Wrong family';
  raise notice 'ok - a case''s family is always taken from its student';
end $$;

-- Who sees what ----------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check(public.admissions_access((select id from ids where k = 'case')) = 'adviser'
  and public.admissions_access((select id from ids where k = 'other')) is null, 'the adviser has access to their case only');
select pg_temp.check((select count(*) from public.admissions_cases) = 1, 'the adviser sees only the case they advise, not one for a student they teach');
with x as (insert into public.admissions_targets (case_id, institution, country, programme)
  values ((select id from ids where k = 'case'), 'University of Oxford', 'United Kingdom', 'Medicine') returning id) insert into ids select 'oxford', id from x;
with x as (insert into public.admissions_targets (case_id, institution, country)
  values ((select id from ids where k = 'case'), 'UCL', 'United Kingdom') returning id) insert into ids select 'ucl', id from x;
update public.admissions_targets set status = 'submitted' where id = (select id from ids where k = 'oxford');
update public.admissions_targets set notes = 'Strong fit.' where id = (select id from ids where k = 'ucl');
with x as (insert into public.admissions_dates (case_id, target_id, kind, title, due_on, time_of_day, enrolment_id, lesson_id)
  values ((select id from ids where k = 'case'), (select id from ids where k = 'oxford'), 'deadline', 'UCAS deadline', current_date + 30, '18:00',
          '70000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001') returning id) insert into ids select 'ucas', id from x;
with x as (insert into public.admissions_tasks (case_id, title, details, due_on, owner)
  values ((select id from ids where k = 'case'), 'Draft personal statement', 'About 4,000 characters.', current_date + 10, 'family') returning id) insert into ids select 'ftask', id from x;
with x as (insert into public.admissions_tasks (case_id, title, owner)
  values ((select id from ids where k = 'case'), 'Request school reference', 'adviser') returning id) insert into ids select 'atask', id from x;
select pg_temp.check((select count(*) from public.admissions_targets) = 2 and (select count(*) from public.admissions_dates) = 1
  and (select count(*) from public.admissions_tasks) = 2, 'the adviser adds and edits targets, key dates and tasks');
do $$ begin
  insert into public.admissions_targets (case_id, institution) values ((select id from ids where k = 'other'), 'Eton');
  raise exception 'adviser wrote to another case';
exception when insufficient_privilege then raise notice 'ok - the adviser cannot write to a case they do not advise';
end $$;
do $$ begin
  update public.admissions_dates set reminders_sent = '{14,7,1,0}' where id = (select id from ids where k = 'ucas');
  if (select reminders_sent from public.admissions_dates where id = (select id from ids where k = 'ucas')) <> '{}' then
    raise exception 'reminders_sent written from the app';
  end if;
  raise notice 'ok - the app cannot write reminder bookkeeping';
end $$;
-- The adviser may change only the summary and status.
do $$ begin
  perform public.save_admissions_case(null, 'd0000000-0000-0000-0000-000000000001', 'other', 'Mine', null, null, null, null);
  raise exception 'adviser opened a case';
exception when insufficient_privilege then raise notice 'ok - an adviser cannot open a case';
end $$;
select public.save_admissions_case((select id from ids where k = 'case'), 'd0000000-0000-0000-0000-000000000002', 'other', 'Renamed',
  '2030', 'on-hold', 'b0000000-0000-0000-0000-000000000001', 'Updated summary.');
select pg_temp.check((select kind || '/' || title || '/' || entry_year || '/' || status || '/' || adviser_tutor_id || '/' || student_id || '/' || summary
  from public.admissions_cases where id = (select id from ids where k = 'case'))
  = 'uk-university/UK universities 2027/2027/on-hold/b0000000-0000-0000-0000-000000000002/d0000000-0000-0000-0000-000000000001/Updated summary.',
  'the adviser can change the summary and status, but not the student, kind, title or adviser');
select public.save_admissions_case((select id from ids where k = 'case'), null, null, null, null, 'active', null, 'Updated summary.');

-- Linked records must stay within the case
do $$ begin
  insert into public.admissions_tasks (case_id, target_id, title, owner)
  values ((select id from ids where k = 'case'), (select id from ids where k = 'oxford'), 'Fine', 'adviser');
  delete from public.admissions_tasks where title = 'Fine';
  reset role;
  insert into public.admissions_targets (id, case_id, institution) values ('60000000-0000-0000-0000-000000000001', (select id from ids where k = 'other'), 'Harrow');
  set role authenticated;
  insert into public.admissions_dates (case_id, target_id, kind, title, due_on)
  values ((select id from ids where k = 'case'), '60000000-0000-0000-0000-000000000001', 'deadline', 'Wrong target', current_date);
  raise exception 'foreign target accepted';
exception when raise_exception then
  if sqlerrm not like 'Please choose a school or university%' then raise; end if;
  raise notice 'ok - a key date cannot point at another case''s target';
end $$;
do $$ begin
  insert into public.admissions_dates (case_id, kind, title, due_on, enrolment_id)
  values ((select id from ids where k = 'case'), 'test', 'Wrong course', current_date, '70000000-0000-0000-0000-000000000002');
  raise exception 'foreign enrolment accepted';
exception when raise_exception then
  if sqlerrm not like 'Please choose a course%' then raise; end if;
  raise notice 'ok - a key date cannot link to another student''s course';
end $$;
do $$ begin
  insert into public.admissions_dates (case_id, kind, title, due_on, lesson_id)
  values ((select id from ids where k = 'case'), 'interview', 'Wrong lesson', current_date, 'f0000000-0000-0000-0000-000000000002');
  raise exception 'foreign lesson accepted';
exception when raise_exception then
  if sqlerrm not like 'Please choose a lesson%' then raise; end if;
  raise notice 'ok - a key date cannot link to a lesson without the student';
end $$;
reset role;
update public.lessons set subject = 'Physics' where id = 'f0000000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
  insert into public.admissions_dates (case_id, kind, title, due_on, enrolment_id, lesson_id)
  values ((select id from ids where k = 'case'), 'test', 'Mismatched lesson', current_date,
    '70000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001');
  raise exception 'lesson in another subject accepted';
exception when raise_exception then
  if sqlerrm not like 'Please choose a lesson in the selected subject%' then raise; end if;
  raise notice 'ok - a preparation lesson must be in the chosen subject';
end $$;
reset role;
update public.lessons set subject = null where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.check((select string_agg(title, ' | ' order by title) from public.admissions_events
  where case_id = (select id from ids where k = 'case') and kind = 'target')
  = 'Application submitted to University of Oxford | UCL added to the shortlist | University of Oxford added to the shortlist',
  'shortlisting and applying appear on the timeline; other edits do not');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'A new task from your admissions adviser'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c' and body like 'Draft personal statement%'
  and url = '/admissions/' || (select id from ids where k = 'case') || '?tab=tasks') = 1, 'the family hears about a new task for them');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'A new task from your admissions adviser') = 1,
  'tasks for the adviser are not sent to the family');
set role authenticated;

-- A tutor who teaches the student but does not advise sees nothing
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check('d0000000-0000-0000-0000-000000000001' = any (public.visible_student_ids()), 'Tia teaches Sami');
select pg_temp.check((select count(*) from public.admissions_cases) + (select count(*) from public.admissions_targets)
  + (select count(*) from public.admissions_dates) + (select count(*) from public.admissions_tasks)
  + (select count(*) from public.admissions_documents) + (select count(*) from public.admissions_updates)
  + (select count(*) from public.admissions_events) = 0, 'a tutor who teaches the student but is not the adviser sees nothing');
select pg_temp.check(public.admissions_access((select id from ids where k = 'case')) is null, 'teaching is not access');
do $$ begin
  insert into public.admissions_targets (case_id, institution) values ((select id from ids where k = 'case'), 'Cambridge');
  raise exception 'non-adviser tutor wrote a target';
exception when insufficient_privilege then raise notice 'ok - a tutor who is not the adviser cannot add targets';
end $$;

-- The family
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.admissions_cases) = 1
  and not exists (select 1 from public.admissions_cases where id = (select id from ids where k = 'other')),
  'a parent sees their own child''s case and not another family''s');
select pg_temp.check((select count(*) from public.admissions_targets) = 2 and (select count(*) from public.admissions_tasks) = 2,
  'the family reads the shortlist and tasks');
do $$ begin
  insert into public.admissions_targets (case_id, institution) values ((select id from ids where k = 'case'), 'Parent pick');
  raise exception 'parent inserted a target';
exception when insufficient_privilege then raise notice 'ok - a parent cannot add a target directly';
end $$;
do $$ begin
  insert into public.admissions_tasks (case_id, title, owner) values ((select id from ids where k = 'case'), 'Parent task', 'family');
  raise exception 'parent inserted a task';
exception when insufficient_privilege then raise notice 'ok - a parent cannot add a task directly';
end $$;
update public.admissions_tasks set done_at = now() where id = (select id from ids where k = 'ftask');
select pg_temp.check((select done_at from public.admissions_tasks where id = (select id from ids where k = 'ftask')) is null,
  'a parent cannot complete a task by writing to it directly');
select public.set_admissions_task_done((select id from ids where k = 'ftask'), true);
select pg_temp.check((select done_by_name from public.admissions_tasks where id = (select id from ids where k = 'ftask') and done_at is not null)
  = 'Mona Ahmed', 'a parent completes a family task');
do $$ begin
  perform public.set_admissions_task_done((select id from ids where k = 'atask'), true);
  raise exception 'parent completed an adviser task';
exception when insufficient_privilege then
  if sqlerrm <> 'Only the adviser can complete this task.' then raise; end if;
  raise notice 'ok - a parent cannot complete the adviser''s task';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.admissions_cases) = 1 and public.admissions_access((select id from ids where k = 'case')) = 'family',
  'the student sees their own case');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.admissions_cases) = 1 and (select count(*) from public.admissions_targets) = 0
  and (select count(*) from public.admissions_events where case_id = (select id from ids where k = 'case')) = 0,
  'another family sees nothing of this case');
do $$ begin
  perform public.set_admissions_task_done((select id from ids where k = 'ftask'), false);
  raise exception 'other parent changed a task';
exception when raise_exception then
  if sqlerrm <> 'Task not found' then raise; end if;
  raise notice 'ok - another family cannot change the task';
end $$;
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Sami''s family has completed a task: Draft personal statement'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b2') = 1, 'the adviser hears when the family completes a task');
select pg_temp.check((select count(*) from public.admissions_events where kind = 'task' and title = 'Completed: Draft personal statement') = 1,
  'a completed task appears on the timeline');
set role authenticated;

-- Documents ----------------------------------------------------------------------------
-- Uploaded files in the test shim's Supabase Storage, so the "family lists only their own uploads" rule is exercised.
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('admissions', 'cases/' || (select id from ids where k = 'case') || '/report.pdf', 'a0000000-0000-0000-0000-00000000000c'),
  ('admissions', 'cases/' || (select id from ids where k = 'case') || '/ref.pdf', 'a0000000-0000-0000-0000-0000000000b2'),
  ('admissions', 'cases/' || (select id from ids where k = 'case') || '/staff-only.pdf', 'a0000000-0000-0000-0000-0000000000b2');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
insert into ids select 'pdoc', (public.add_admissions_document((select id from ids where k = 'case'), null, 'transcript', 'Year 12 report',
  'cases/' || (select id from ids where k = 'case') || '/report.pdf', 'application/pdf', false)).id;
select pg_temp.check((select family_visible and uploaded_by_name = 'Mona Ahmed' from public.admissions_documents where id = (select id from ids where k = 'pdoc')),
  'a parent adds a document to their case; it is always visible to the family');
do $$ begin
  perform public.add_admissions_document((select id from ids where k = 'case'), null, 'other', 'Wrong folder',
    'cases/' || (select id from ids where k = 'other') || '/x.pdf', null, true);
  raise exception 'foreign path accepted';
exception when raise_exception then
  if sqlerrm not like 'The file could not be accepted%' then raise; end if;
  raise notice 'ok - a document must sit in its own case''s folder';
end $$;
do $$ begin
  perform public.add_admissions_document((select id from ids where k = 'case'), null, 'other', 'Escape',
    'cases/' || (select id from ids where k = 'case') || '/../x.pdf', null, true);
  raise exception 'dot-dot path accepted';
exception when raise_exception then
  if sqlerrm not like 'The file could not be accepted%' then raise; end if;
  raise notice 'ok - paths with .. are refused';
end $$;
do $$ begin
  perform public.add_admissions_document((select id from ids where k = 'other'), null, 'other', 'Not mine',
    'cases/' || (select id from ids where k = 'other') || '/x.pdf', null, true);
  raise exception 'document added to another family''s case';
exception when insufficient_privilege then raise notice 'ok - a parent cannot add documents to another family''s case';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
insert into ids select 'hdoc', (public.add_admissions_document((select id from ids where k = 'case'), (select id from ids where k = 'oxford'),
  'reference', 'Draft reference', 'cases/' || (select id from ids where k = 'case') || '/ref.pdf', 'application/pdf', false)).id;
insert into ids select 'sdoc', (public.add_admissions_document((select id from ids where k = 'case'), null,
  'other', 'Reading list', 'cases/' || (select id from ids where k = 'case') || '/reading.pdf', 'application/pdf', true)).id;
select pg_temp.check((select count(*) from public.admissions_documents) = 3, 'the adviser sees every document on the case');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select string_agg(name, ', ' order by name) from public.admissions_documents) = 'Reading list, Year 12 report',
  'a parent cannot see a document the adviser kept from the family');
select pg_temp.check((select count(*) from public.admissions_events where kind = 'document') = 2,
  'the family''s timeline leaves out hidden documents');
reset role;
select pg_temp.check((select count(*) from public.admissions_events where kind = 'document') = 3, 'every document is on the staff timeline');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'New admissions document for Sami: Year 12 report'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b2' and url like '%?tab=documents') = 1, 'the adviser hears when the family adds a document');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'A new document has been shared for Sami'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 1, 'the family hears only about documents shared with them');
set role authenticated;

-- Storage rules
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.admissions_can_write('cases/' || (select id from ids where k = 'case') || '/new.pdf')
  and not public.admissions_can_write('cases/' || (select id from ids where k = 'other') || '/new.pdf')
  and not public.admissions_can_write('cases/' || (select id from ids where k = 'case'))
  and not public.admissions_can_write('cases/' || (select id from ids where k = 'case') || '/')
  and not public.admissions_can_write('cases/' || (select id from ids where k = 'case') || '/../x.pdf')
  and not public.admissions_can_write('cases/not-a-uuid/x.pdf')
  and not public.admissions_can_write('students/' || (select id from ids where k = 'case') || '/x.pdf')
  and not public.admissions_can_write(null), 'the family uploads into their own case folder only');
select pg_temp.check(public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/report.pdf')
  and public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/reading.pdf')
  and not public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/ref.pdf')
  and not public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/unlisted.pdf')
  and not public.admissions_can_read('cases/x/../' || (select id from ids where k = 'case') || '/report.pdf'),
  'the family opens only files listed as documents they may see');
do $$ begin
  perform public.add_admissions_document((select id from ids where k = 'case'), null, 'other', 'x',
    'cases/' || (select id from ids where k = 'case') || '/ref.pdf', null, true);
  raise exception 'confidential path re-listed';
exception when raise_exception then
  if sqlerrm not like 'The file could not be accepted%' then raise; end if;
  raise notice 'ok - a parent cannot list the file of a confidential document again';
end $$;
do $$ begin
  perform public.add_admissions_document((select id from ids where k = 'case'), null, 'other', 'x',
    'cases/' || (select id from ids where k = 'case') || '/staff-only.pdf', null, true);
  raise exception 'someone else''s upload listed';
exception when raise_exception then
  if sqlerrm not like 'The file could not be accepted%' then raise; end if;
  raise notice 'ok - a parent can list only a file they uploaded themselves';
end $$;
select pg_temp.check(not public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/ref.pdf')
  and not public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/staff-only.pdf')
  and (select count(*) from public.admissions_documents) = 2, 'the confidential file stays closed to the family');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check(public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/ref.pdf')
  and public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/unlisted.pdf')
  and not public.admissions_can_read('cases/' || (select id from ids where k = 'other') || '/x.pdf'), 'the adviser opens their case''s files only');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(not public.admissions_can_read('cases/' || (select id from ids where k = 'case') || '/reading.pdf')
  and not public.admissions_can_write('cases/' || (select id from ids where k = 'case') || '/x.pdf'), 'a tutor who is not the adviser has no file access');
select pg_temp.check(not public.admissions_can_delete('cases/' || (select id from ids where k = 'case') || '/report.pdf')
  and public.admissions_can_delete('cases/' || (select id from ids where k = 'case') || '/unlisted.pdf')
  and not public.admissions_can_delete('') and not public.admissions_can_delete(null), 'a file still listed as a document cannot be deleted');

-- Deleting documents
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.delete_admissions_document((select id from ids where k = 'sdoc'));
  raise exception 'parent deleted the adviser''s document';
exception when insufficient_privilege then raise notice 'ok - a parent cannot delete a document the adviser added';
end $$;
select pg_temp.check(public.delete_admissions_document((select id from ids where k = 'pdoc'))
  = 'cases/' || (select id from ids where k = 'case') || '/report.pdf', 'the uploader deletes their document and gets the path back');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
reset role;
insert into public.admissions_documents (case_id, category, name, path) values
  ((select id from ids where k = 'case'), 'other', 'Copy', 'cases/' || (select id from ids where k = 'case') || '/reading.pdf');
set role authenticated;
select pg_temp.check(public.delete_admissions_document((select id from ids where k = 'sdoc')) is null,
  'a file another document still uses is kept');
-- The adviser deletes a document the office uploaded: the stored file goes too (same rule as the "admissions delete" policy).
reset role;
-- The migration's own "admissions read" and "admissions delete" policies apply (the test shim provides Storage).
insert into storage.objects (bucket_id, name, owner_id) values
  ('admissions', 'cases/' || (select id from ids where k = 'case') || '/office.pdf', 'a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into ids select 'odoc', (public.add_admissions_document((select id from ids where k = 'case'), null, 'reference', 'Confidential reference',
  'cases/' || (select id from ids where k = 'case') || '/office.pdf', 'application/pdf', false)).id;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
delete from storage.objects where name like '%/office.pdf';
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
delete from storage.objects where name like '%/office.pdf';
reset role;
select pg_temp.check(exists (select 1 from storage.objects where name like '%/office.pdf'), 'a listed file cannot be removed from storage, even by the adviser');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
-- As the app does: delete the record, then remove the file at the path it returns.
create temp table removed as select public.delete_admissions_document((select id from ids where k = 'odoc')) as path;
delete from storage.objects using removed where storage.objects.name = removed.path;
reset role;
select pg_temp.check(not exists (select 1 from storage.objects where name like '%/office.pdf'),
  'the adviser deletes a document the office uploaded and no stored file is left behind');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(not public.admissions_can_remove('cases/' || (select id from ids where k = 'case') || '/unlisted.pdf', 'a0000000-0000-0000-0000-00000000000a')
  and not public.admissions_can_remove('cases/' || (select id from ids where k = 'case') || '/unlisted.pdf', null),
  'a tutor who is not the adviser cannot remove the case''s files');

-- Advisory updates ----------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
insert into ids select 'upd', (public.save_advisory_update(null, (select id from ids where k = 'case'), 'monthly', 'October advisory update',
  'October 2026', 'Sami has submitted his Oxford application.', true)).id;
select public.save_advisory_update((select id from ids where k = 'upd'), null, 'monthly', 'October advisory update', 'October 2026',
  'Sami has submitted his Oxford application. UCL is next.', false);
select pg_temp.check((select ai_assisted and status = 'draft' and author_name = 'Tom Two' and body like '%UCL is next.'
  from public.admissions_updates where id = (select id from ids where k = 'upd')), 'the adviser drafts an update; AI assistance is remembered');
insert into ids select 'upd2', (public.save_advisory_update(null, (select id from ids where k = 'case'), 'ad-hoc', 'Interview news', null, 'Draft', false)).id;
select public.set_advisory_update_status((select id from ids where k = 'upd'), 'submitted');
do $$ begin
  perform public.set_advisory_update_status((select id from ids where k = 'upd'), 'published');
  raise exception 'adviser published';
exception when insufficient_privilege then raise notice 'ok - the adviser cannot publish';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.save_advisory_update(null, (select id from ids where k = 'case'), 'ad-hoc', 'Parent note', null, 'x', false);
  raise exception 'parent wrote an update';
exception when insufficient_privilege then raise notice 'ok - families cannot write advisory updates';
end $$;
select pg_temp.check((select count(*) from public.admissions_updates) = 0, 'the family sees no unpublished updates');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Advisory update ready for review: Sami'
  and profile_id = 'a0000000-0000-0000-0000-00000000000a' and url = '/admissions/update?id=' || (select id from ids where k = 'upd')) = 1,
  'the office hears when an update is submitted');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_advisory_update_status((select id from ids where k = 'upd'), 'approved');
select public.set_advisory_update_status((select id from ids where k = 'upd'), 'published');
select pg_temp.check((select status = 'published' and submitted_at is not null and approved_at is not null and published_at is not null
  from public.admissions_updates where id = (select id from ids where k = 'upd')), 'the office approves and publishes');
do $$ begin
  perform public.set_advisory_update_status((select id from ids where k = 'upd'), 'draft');
  raise exception 'published update went back to draft';
exception when raise_exception then
  if sqlerrm <> 'A published update cannot be withdrawn.' then raise; end if;
  raise notice 'ok - a published update cannot return to draft';
end $$;
do $$ begin
  perform public.save_advisory_update((select id from ids where k = 'upd'), null, 'monthly', 'Changed', null, 'x', false);
  raise exception 'published update edited';
exception when raise_exception then
  if sqlerrm <> 'A published update cannot be changed.' then raise; end if;
  raise notice 'ok - a published update cannot be edited';
end $$;
do $$ begin
  perform public.delete_advisory_update((select id from ids where k = 'upd'));
  raise exception 'published update deleted';
exception when raise_exception then
  if sqlerrm <> 'A published update cannot be deleted.' then raise; end if;
  raise notice 'ok - a published update cannot be deleted';
end $$;
select public.set_advisory_update_status((select id from ids where k = 'upd2'), 'approved');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
do $$ begin
  perform public.save_advisory_update((select id from ids where k = 'upd2'), null, 'ad-hoc', 'Changed', null, 'x', false);
  raise exception 'adviser edited an approved update';
exception when insufficient_privilege then raise notice 'ok - the adviser cannot edit an approved update';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.delete_advisory_update((select id from ids where k = 'upd2'));
select pg_temp.check(not exists (select 1 from public.admissions_updates where id = (select id from ids where k = 'upd2')),
  'an unpublished update can be deleted');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select string_agg(title, ',') from public.admissions_updates) = 'October advisory update', 'the family sees the published update');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'A new advisory update for Sami'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c' and body = 'October advisory update is ready to read in the Elite Education app.'
  and url = '/admissions/' || (select id from ids where k = 'case') || '?tab=updates') = 1,
  'publishing tells the family, without the text of the update');
select pg_temp.check((select count(*) from public.admissions_events where kind = 'update' and title = 'Advisory update sent: October 2026'
  and family_visible) = 1, 'a published update appears on the timeline');

-- Milestones and hidden timeline entries
insert into public.admissions_events (case_id, kind, title, family_visible)
values ((select id from ids where k = 'case'), 'milestone', 'Internal note', false);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.add_admissions_milestone((select id from ids where k = 'case'), 'Predicted grades confirmed', '7, 7, 6');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(exists (select 1 from public.admissions_events where title = 'Predicted grades confirmed' and detail = '7, 7, 6')
  and not exists (select 1 from public.admissions_events where title = 'Internal note'), 'the family sees milestones but not hidden entries');
do $$ begin
  perform public.add_admissions_milestone((select id from ids where k = 'case'), 'Parent milestone', null);
  raise exception 'parent added a milestone';
exception when insufficient_privilege then raise notice 'ok - families cannot add milestones';
end $$;
do $$ begin
  insert into public.admissions_events (case_id, kind, title) values ((select id from ids where k = 'case'), 'milestone', 'Forged');
  raise exception 'parent wrote an event';
exception when insufficient_privilege then raise notice 'ok - nobody writes the timeline directly';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check(exists (select 1 from public.admissions_events where title = 'Internal note'), 'the adviser sees hidden entries');

-- Fees -----------------------------------------------------------------------------------
do $$ begin
  perform public.bill_admissions_fee((select id from ids where k = 'case'), 'Advisory', 1, 5000);
  raise exception 'adviser billed';
exception when insufficient_privilege then raise notice 'ok - only the office bills admissions fees';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into ids select 'inv', (public.bill_admissions_fee((select id from ids where k = 'case'), ' UK university advisory, term 1 ', 1, 5000)).id;
select pg_temp.check((select status = 'sent' and family_id = 'c0000000-0000-0000-0000-000000000001' and vat_rate = 0.05
    and items->0->>'admissionsCaseId' = (select id from ids where k = 'case')::text
    and items->0->>'description' = 'UK university advisory, term 1' and (items->0->>'unitPrice')::numeric = 5000
  from public.invoices where id = (select id from ids where k = 'inv')), 'the office bills the family; the item names the case');
do $$ begin
  perform public.bill_admissions_fee((select id from ids where k = 'case'), 'Nothing', 0, 100);
  raise exception 'zero quantity billed';
exception when raise_exception then
  if sqlerrm not like 'Please enter a quantity%' then raise; end if;
  raise notice 'ok - a fee needs a quantity';
end $$;
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'Invoice INV-%'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 1, 'the usual invoice notice goes to the family');

-- Reminders ----------------------------------------------------------------------------------
-- 10:00 UAE time on a fixed day.
create temp table clock as select timestamptz '2026-11-02 06:00:00+00' as now, date '2026-11-02' as today;
grant select on clock to authenticated, service_role;
update public.admissions_dates set done = true where case_id = (select id from ids where k = 'case');
insert into public.admissions_dates (id, case_id, kind, title, due_on) values
  ('50000000-0000-0000-0000-000000000007', (select id from ids where k = 'case'), 'interview', 'Oxford interview', (select today + 7 from clock)),
  ('50000000-0000-0000-0000-000000000005', (select id from ids where k = 'case'), 'test', 'UCAT', (select today + 5 from clock)),
  ('50000000-0000-0000-0000-000000000006', (select id from ids where k = 'case'), 'deadline', 'Done already', (select today + 1 from clock)),
  ('50000000-0000-0000-0000-000000000008', (select id from ids where k = 'case'), 'deadline', 'Far away', (select today + 30 from clock)),
  ('50000000-0000-0000-0000-000000000009', (select id from ids where k = 'case'), 'deadline', 'Missed', (select today - 1 from clock)),
  ('50000000-0000-0000-0000-000000000010', (select id from ids where k = 'other'), 'open-day', 'Harrow open day', (select today from clock));
update public.admissions_dates set done = true where id = '50000000-0000-0000-0000-000000000006';
update public.admissions_cases set status = 'on-hold' where id = (select id from ids where k = 'other');
update public.admissions_tasks set due_on = (select today + 2 from clock) where id = (select id from ids where k = 'atask');
delete from public.notification_outbox;

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.queue_admissions_reminders();
  raise exception 'authenticated queued reminders';
exception when insufficient_privilege then raise notice 'ok - the app cannot run the reminder queue';
end $$;
reset role;
set role service_role;
select pg_temp.check(public.queue_admissions_reminders((select now - interval '8 hours' from clock)) = 0, 'no reminders overnight (UAE time)');
select pg_temp.check(public.queue_admissions_reminders((select now from clock)) = 3, 'two key dates and one task are reminded');
select pg_temp.check(public.queue_admissions_reminders((select now from clock)) = 0, 'a second run sends nothing');
reset role;
select pg_temp.check((select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000007') = '{14,7}'
  and (select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000005') = '{14,7}',
  'a reminder covers every threshold at or above the days left');
select pg_temp.check((select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000006') = '{}'
  and (select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000010') = '{}'
  and (select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000008') = '{}'
  and (select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000009') = '{}',
  'done dates, paused cases, distant and past dates are skipped');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Interview in 7 days: Oxford interview'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c' and url = '/admissions/' || (select id from ids where k = 'case')) = 1
  and (select count(*) from public.notification_outbox where subject = 'Sami: Interview in 7 days: Oxford interview'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b2') = 1, 'the family and the adviser are reminded of a key date');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Sami: Task due in 2 days: Request school reference'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b2') = 1
  and not exists (select 1 from public.notification_outbox where subject like '%Request school reference' and profile_id = 'a0000000-0000-0000-0000-00000000000c'),
  'an adviser task reminds the adviser only');
set role service_role;
select pg_temp.check(public.queue_admissions_reminders((select now + interval '5 days' from clock)) = 1, 'the day of the test is reminded');
select pg_temp.check(public.queue_admissions_reminders((select now + interval '6 days' from clock)) = 1, 'the day before the interview is reminded');
reset role;
select pg_temp.check((select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000007') = '{14,7,1}'
  and (select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000005') = '{14,7,1,0}'
  and (select count(*) from public.notification_outbox where subject = 'Tomorrow: Oxford interview') = 1
  and (select count(*) from public.notification_outbox where subject = 'Today: UCAT' and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 1,
  'tomorrow and today reminders');

-- A rescheduled date is reminded again from the next threshold.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
update public.admissions_dates set due_on = due_on + 20 where id = '50000000-0000-0000-0000-000000000007';
reset role;
select pg_temp.check((select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000007') = '{}',
  'moving a key date clears its reminders');
delete from public.notification_outbox;
set role service_role;
select pg_temp.check(public.queue_admissions_reminders((select now + interval '13 days' from clock)) = 1, 'the moved interview is reminded again');
reset role;
select pg_temp.check((select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000007') = '{14}'
  and (select count(*) from public.notification_outbox where subject = 'Interview in 14 days: Oxford interview') = 1,
  'the 14-day reminder goes out for the new date');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
update public.admissions_dates set title = 'Oxford interview' where id = '50000000-0000-0000-0000-000000000007';
reset role;
select pg_temp.check((select reminders_sent from public.admissions_dates where id = '50000000-0000-0000-0000-000000000007') = '{14}',
  'editing a key date without moving it keeps its reminders');

select pg_temp.check(not exists (select 1 from public.notification_outbox where body like '%AE9903312345%' or body like '%IBAN%'),
  'bank details never appear in admissions notifications');
set role anon;
do $$ begin
  perform 1 from public.admissions_cases;
  raise exception 'anon read cases';
exception when insufficient_privilege then raise notice 'ok - anonymous visitors cannot read admissions cases';
end $$;
reset role;
