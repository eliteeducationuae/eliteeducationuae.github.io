-- Homework with attachments, hand-ins and feedback, the resource library and classwork storage rules.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss (admin); Tia teaches Sami (family Ahmed); Tom teaches Ollie (family Other).
-- Mona is Sami's mother, Sami has his own login, Otto is Ollie's father.
update public.settings set bank_details = 'Elite Education FZ LLC, IBAN AE990331234567890123456' where id = 1;
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
-- Each student's subjects (enrolments), with the tutor who teaches them.
insert into public.enrolments (student_id, subject, curriculum, level, exam_board, syllabus_id, tutor_id) values
  ('d0000000-0000-0000-0000-000000000001', 'Maths', 'IB DP', 'AA SL', 'IB', 'ib-aa-sl', 'b0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'Chemistry', 'IB DP', 'HL', null, null, 'b0000000-0000-0000-0000-000000000002');
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

-- Setting homework -----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into ids select 'hw', (public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', '  Essay plan ', 'Write 300 words.',
  current_date + 7, '[{"kind":"file","name":"Brief.pdf","path":"students/d0000000-0000-0000-0000-000000000001/brief.pdf","mimeType":"application/pdf"},
                     {"kind":"link","name":"Reading","url":"https://example.com/reading"}]', null)).id;
select pg_temp.check((select title || '/' || tutor_id || '/' || jsonb_array_length(attachments) from public.homework where id = (select id from ids where k = 'hw'))
  = 'Essay plan/b0000000-0000-0000-0000-000000000001/2', 'a tutor sets homework with attachments for their own student');
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000002', 'Not mine', null, current_date + 7, '[]');
  raise exception 'set homework for another tutor''s student';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot set homework for another tutor''s student';
end $$;
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Bad link', null, current_date + 7,
    '[{"kind":"link","name":"x","url":"javascript:x"}]');
  raise exception 'javascript link accepted';
exception when raise_exception then
  if sqlerrm = 'javascript link accepted' then raise; end if;
  raise notice 'ok - links must be http or https';
end $$;
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Bad file', null, current_date + 7,
    '[{"kind":"file","name":"x","path":"students/d0000000-0000-0000-0000-000000000002/x"}]');
  raise exception 'foreign file accepted';
exception when raise_exception then
  if sqlerrm = 'foreign file accepted' then raise; end if;
  raise notice 'ok - files must sit in the student''s own folder or the library';
end $$;
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', '   ', null, current_date + 7, '[]');
  raise exception 'blank title accepted';
exception when raise_exception then
  if sqlerrm = 'blank title accepted' then raise; end if;
  raise notice 'ok - homework needs a title';
end $$;
reset role;
select pg_temp.check(public.valid_attachments('[]', 'd0000000-0000-0000-0000-000000000001')
  and not public.valid_attachments('{}', 'd0000000-0000-0000-0000-000000000001')
  and not public.valid_attachments('[{"kind":"file","name":"","path":"resources/a.pdf"}]', 'd0000000-0000-0000-0000-000000000001')
  and not public.valid_attachments('[{"kind":"file","name":"a","path":"resources/../students/x/a.pdf"}]', 'd0000000-0000-0000-0000-000000000001')
  and not public.valid_attachments('[{"kind":"video","name":"a","url":"https://x"}]', 'd0000000-0000-0000-0000-000000000001')
  and public.valid_attachments('[{"kind":"file","name":"a","path":"resources/a.pdf","resourceId":"x"}]', 'd0000000-0000-0000-0000-000000000001'),
  'attachment shapes are validated');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'New homework: Essay plan'
  and profile_id = 'a0000000-0000-0000-0000-00000000000d' and send_email and url = '/homework/' || (select id from ids where k = 'hw')) = 1,
  'the student is told about homework set outside a lesson, by push and email');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'New homework for Sami: Essay plan'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 1, 'the family is told about homework set outside a lesson');
select pg_temp.check((select body from public.notification_outbox where subject = 'New homework: Essay plan') = 'Due ' || to_char(current_date + 7, 'FMDay FMDD FMMonth') || E'.\n\nWrite 300 words.',
  'the homework notice gives the due date in full and the details');
set role authenticated;

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into ids select 'lessonhw', (public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Ex 4B', null, current_date + 3, '[]',
  'f0000000-0000-0000-0000-000000000001')).id;
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'New homework: Ex 4B'
  and profile_id = 'a0000000-0000-0000-0000-00000000000d' and not send_email) = 1, 'homework set in a lesson pushes the student only');
select pg_temp.check((select count(*) from public.notification_outbox where subject like '%Ex 4B%') = 1,
  'homework set in a lesson is left to the lesson-notes email for the family');
set role authenticated;

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.save_homework((select id from ids where k = 'hw'), 'd0000000-0000-0000-0000-000000000001', 'Essay plan', 'Write 400 words.',
  current_date + 8, '[{"kind":"file","name":"Brief.pdf","path":"students/d0000000-0000-0000-0000-000000000001/brief.pdf"}]');
select pg_temp.check((select details || '/' || jsonb_array_length(attachments) from public.homework where id = (select id from ids where k = 'hw'))
  = 'Write 400 words./1', 'a tutor edits homework they set');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.save_homework((select id from ids where k = 'hw'), 'd0000000-0000-0000-0000-000000000002', 'Moved', null, current_date, '[]');
  raise exception 'edited homework under the wrong student';
exception when raise_exception then
  if sqlerrm <> 'Homework not found' then raise; end if;
  raise notice 'ok - edits must name the right student';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Parent task', null, current_date, '[]');
  raise exception 'parent set homework';
exception when insufficient_privilege then raise notice 'ok - parents cannot set homework';
end $$;

-- Handing in -----------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.submit_homework((select id from ids where k = 'hw'), 'tutor hand-in', '[]');
  raise exception 'tutor handed in';
exception when insufficient_privilege then raise notice 'ok - tutors cannot hand in homework';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.homework) = 0, 'another family cannot see the homework');
do $$ begin
  perform public.submit_homework((select id from ids where k = 'hw'), 'not mine', '[]');
  raise exception 'other parent handed in';
exception when raise_exception then
  if sqlerrm <> 'Homework not found' then raise; end if;
  raise notice 'ok - another family cannot hand in the homework';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
do $$ begin
  perform public.submit_homework((select id from ids where k = 'hw'), '  ', '[]');
  raise exception 'empty hand-in';
exception when raise_exception then
  if sqlerrm = 'empty hand-in' then raise; end if;
  raise notice 'ok - a hand-in needs a note or a file';
end $$;
do $$ begin
  perform public.submit_homework((select id from ids where k = 'hw'), null,
    '[{"kind":"file","name":"x.jpg","path":"students/d0000000-0000-0000-0000-000000000002/x.jpg"}]');
  raise exception 'foreign hand-in file';
exception when raise_exception then
  if sqlerrm = 'foreign hand-in file' then raise; end if;
  raise notice 'ok - hand-in files must be in the student''s own folder';
end $$;
insert into ids select 'sub', (public.submit_homework((select id from ids where k = 'hw'), 'All done.',
  '[{"kind":"file","name":"Answer.jpg","path":"students/d0000000-0000-0000-0000-000000000001/answer.jpg","mimeType":"image/jpeg"}]')).id;
select pg_temp.check((select done from public.homework where id = (select id from ids where k = 'hw')), 'handing in marks the homework done');
select pg_temp.check((select submitted_by_name || '/' || note from public.homework_submissions) = 'Sami Ahmed/All done.', 'the hand-in records who handed it in');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.homework_submissions) = 1, 'the family sees the hand-in');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.homework_submissions) = 0, 'another family cannot see the hand-in');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.homework_submissions) = 0, 'another tutor cannot see the hand-in');
do $$ begin
  update public.homework_submissions set feedback = 'sneaky';
  raise exception 'direct write allowed';
exception when insufficient_privilege then raise notice 'ok - hand-ins cannot be written directly';
end $$;
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Sami has handed in homework: Essay plan'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b1' and send_email and push_title is not null) = 1, 'the tutor is told about the hand-in');
set role authenticated;

-- With no tutor known, the business hears about the hand-in instead.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into ids select 'adminhw', (public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Holiday reading', null, current_date + 14, '[]')).id;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.submit_homework((select id from ids where k = 'adminhw'), 'Sami read two chapters.', null);
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Sami has handed in homework: Holiday reading'
  and profile_id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'admins are told when no tutor set the homework');
set role authenticated;

-- Feedback -------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
do $$ begin
  perform public.give_homework_feedback((select id from ids where k = 'sub'), 'Not my student', null);
  raise exception 'other tutor gave feedback';
exception when insufficient_privilege then raise notice 'ok - another tutor cannot give feedback';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.give_homework_feedback((select id from ids where k = 'sub'), 'Lovely', null);
  raise exception 'parent gave feedback';
exception when insufficient_privilege then raise notice 'ok - parents cannot give feedback';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.give_homework_feedback((select id from ids where k = 'sub'), ' ', null);
  raise exception 'blank feedback';
exception when raise_exception then
  if sqlerrm = 'blank feedback' then raise; end if;
  raise notice 'ok - feedback cannot be blank';
end $$;
select public.give_homework_feedback((select id from ids where k = 'sub'), 'A well-argued plan.', ' 7/10 ');
select pg_temp.check((select feedback || '/' || mark || '/' || feedback_by_name || '/' || (feedback_at is not null) from public.homework_submissions
  where id = (select id from ids where k = 'sub')) = 'A well-argued plan./7/10/Tia One/true', 'the tutor''s feedback and mark are saved');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Feedback on Essay plan'
  and profile_id = 'a0000000-0000-0000-0000-00000000000d' and body like '%Mark: 7/10%') = 1, 'the student is told about the feedback');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Feedback on Essay plan'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c' and body like '%A well-argued plan.%') = 1, 'the family is told about the feedback');
set role authenticated;

-- Resource library -----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into public.resources (id, title, subject, level, kind, path, file_name, tags, uploaded_by)
values ('90000000-0000-0000-0000-000000000001', 'Past paper 2025', 'Mathematics', 'HL', 'file', 'resources/r1.pdf', 'r1.pdf', '{exam}',
        'a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select uploaded_by::text || '/' || uploaded_by_name from public.resources)
  = 'a0000000-0000-0000-0000-0000000000b1/Tia One', 'the uploader is recorded from the signed-in user');
do $$ begin
  insert into public.resources (title, kind, url, student_ids) values ('For Ollie', 'link', 'https://x.test', '{d0000000-0000-0000-0000-000000000002}');
  raise exception 'shared with a stranger';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot share a new resource with another tutor''s student';
end $$;
do $$ begin
  insert into public.resources (title, kind, url) values ('Bad', 'link', 'javascript:alert(1)');
  raise exception 'bad resource url';
exception when check_violation then raise notice 'ok - resource links must be http or https';
end $$;
do $$ begin
  insert into public.resources (title, kind, path) values ('Bad', 'file', 'students/d0000000-0000-0000-0000-000000000001/x.pdf');
  raise exception 'bad resource path';
exception when check_violation then raise notice 'ok - resource files live in the library folder';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.list_resources()) = 1, 'every tutor sees the library');
select pg_temp.check((select count(*) from public.resources) = 0,
  'a tutor cannot read other tutors'' resources (and whom they are shared with) from the table directly');
update public.resources set title = 'Hijacked';
delete from public.resources;
select pg_temp.check((select title from public.list_resources()) = 'Past paper 2025', 'only the uploader can change or delete a resource');
do $$ begin
  perform public.share_resource('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
  raise exception 'shared with someone else''s student';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot share with another tutor''s student';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.list_resources()) = 0, 'families cannot see resources that have not been shared');
do $$ begin
  insert into public.resources (title, kind, url) values ('Parent link', 'link', 'https://x.test');
  raise exception 'parent added a resource';
exception when insufficient_privilege then raise notice 'ok - families cannot add resources';
end $$;
select pg_temp.check(not public.classwork_can_read('resources/r1.pdf'), 'families cannot open unshared library files');

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
update public.resources set description = 'Paper 1 with mark scheme.' where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check((select description from public.resources) = 'Paper 1 with mark scheme.', 'the uploader edits their resource');
select public.share_resource('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
select public.share_resource('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
select pg_temp.check((select array_length(student_ids, 1) || '/' || visibility from public.resources) = '1/students', 'sharing adds the student once');
do $$ begin
  update public.resources set student_ids = student_ids || 'd0000000-0000-0000-0000-000000000002'::uuid;
  raise exception 'widened sharing';
exception when insufficient_privilege then raise notice 'ok - an uploader cannot share with students they do not teach';
end $$;
-- An admin also shares it with Ollie, so the row now names a second family's child.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.share_resource('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select array_to_string(student_ids, ',') from public.list_resources()) = 'd0000000-0000-0000-0000-000000000001',
  'a tutor sees only their own students among those a resource is shared with');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select array_to_string(student_ids, ',') from public.list_resources()) = 'd0000000-0000-0000-0000-000000000002'
  and not exists (select 1 from public.resources), 'another tutor sees only their own student, and never the stored list');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.list_resources()) = 1, 'the family sees a resource once it is shared');
select pg_temp.check((select array_to_string(student_ids, ',') from public.list_resources()) = 'd0000000-0000-0000-0000-000000000001',
  'the family never sees which other students a resource is shared with');
select pg_temp.check((select count(*) from public.resources) = 0, 'families cannot read the library table directly');
select pg_temp.check((select count(*) from public.list_resources('d0000000-0000-0000-0000-000000000001')) = 1
  and (select count(*) from public.list_resources('d0000000-0000-0000-0000-000000000002')) = 0, 'the list can be narrowed to one child');
select pg_temp.check(public.classwork_can_read('resources/r1.pdf'), 'the family can open a shared library file');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.list_resources()) = 1, 'the student sees a resource once it is shared');
-- The admin withdraws the share with Ollie again.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.unshare_resource('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.list_resources()) = 0, 'another family cannot see it once the share is withdrawn');
select pg_temp.check(not public.classwork_can_read('resources/r1.pdf'), 'another family cannot open the file once the share is withdrawn');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
do $$ begin
  perform public.unshare_resource('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
  raise exception 'unshared another tutor''s student';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot change sharing for another tutor''s student';
end $$;
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'A new resource from Elite Education: Past paper 2025'
  and profile_id in ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000d')) = 2,
  'the student and family are told about a shared resource once');
select pg_temp.check((select url from public.notification_outbox where subject like 'A new resource%' and profile_id = 'a0000000-0000-0000-0000-00000000000c')
  = '/parent/progress?tab=homework', 'the family notice opens the homework tab');
select pg_temp.check((select url from public.notification_outbox where subject like 'A new resource%' and profile_id = 'a0000000-0000-0000-0000-00000000000d')
  = '/student/homework', 'the student notice opens their homework');
set role authenticated;

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into public.resources (id, title, kind, url) values ('90000000-0000-0000-0000-000000000002', 'Video', 'link', 'https://video.test/1');
delete from public.resources where id = '90000000-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.resources) = 1, 'the uploader deletes their resource');
do $$ begin
  insert into public.resources (title, kind, url) values (repeat('x', 201), 'link', 'https://x.test');
  raise exception 'long title accepted';
exception when check_violation then raise notice 'ok - resource titles are limited to 200 characters';
end $$;
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Long', repeat('x', 4001), current_date + 7, '[]');
  raise exception 'long details accepted';
exception when raise_exception then
  if sqlerrm = 'long details accepted' then raise; end if;
  raise notice 'ok - homework details are limited to 4,000 characters';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
update public.resources set title = 'Past paper 2025 (Paper 1)';
select pg_temp.check((select title from public.resources) = 'Past paper 2025 (Paper 1)', 'admins can edit any resource');

-- Classwork storage ----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.classwork_can_read('students/d0000000-0000-0000-0000-000000000001/x.jpg')
  and public.classwork_can_write('students/d0000000-0000-0000-0000-000000000001/x.jpg'), 'a parent reads and writes their child''s folder');
select pg_temp.check(not public.classwork_can_write('resources/x.pdf') and not public.classwork_can_read('resources/r9.pdf'),
  'a parent cannot write to or browse the library');
select pg_temp.check(not public.classwork_can_read('x') and not public.classwork_can_read('students/not-a-uuid/x')
  and not public.classwork_can_write('students/not-a-uuid/x') and not public.classwork_can_read('students/d0000000-0000-0000-0000-000000000001')
  and not public.classwork_can_read('students/d0000000-0000-0000-0000-000000000001/') and not public.classwork_can_read('')
  and not public.classwork_can_read(null) and not public.classwork_can_read('resources/../students/d0000000-0000-0000-0000-000000000002/x'),
  'junk paths are refused without errors');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check(not public.classwork_can_read('students/d0000000-0000-0000-0000-000000000001/x.jpg')
  and not public.classwork_can_write('students/d0000000-0000-0000-0000-000000000001/x.jpg'), 'another parent cannot touch the child''s folder');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check(public.classwork_can_write('students/d0000000-0000-0000-0000-000000000001/answer.jpg')
  and not public.classwork_can_write('students/d0000000-0000-0000-0000-000000000002/answer.jpg'), 'a student writes to their own folder only');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(public.classwork_can_read('students/d0000000-0000-0000-0000-000000000001/x.jpg')
  and public.classwork_can_write('students/d0000000-0000-0000-0000-000000000001/x.jpg'), 'the tutor reads and writes their student''s folder');
select pg_temp.check(public.classwork_can_read('resources/x.pdf') and public.classwork_can_write('resources/x.pdf'), 'tutors read and write the library');
select public.save_homework(null, 'd0000000-0000-0000-0000-000000000001', 'Worksheet', null, current_date + 5,
  '[{"kind":"file","name":"Worksheet.pdf","path":"resources/r3.pdf","resourceId":"90000000-0000-0000-0000-000000000003"}]');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check(not public.classwork_can_read('students/d0000000-0000-0000-0000-000000000001/x.jpg')
  and not public.classwork_can_write('students/d0000000-0000-0000-0000-000000000001/x.jpg'), 'another tutor cannot touch the student''s folder');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.classwork_can_read('resources/r3.pdf'), 'the family can open a library file attached to their homework');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check(not public.classwork_can_read('resources/r3.pdf'), 'another family cannot open it');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.classwork_can_read('students/d0000000-0000-0000-0000-000000000002/x.jpg') and public.classwork_can_write('resources/y.pdf'),
  'admins can reach every folder');

-- Deleting a library file keeps the stored copy while homework still uses it.
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into public.resources (id, title, kind, path, file_name) values
  ('90000000-0000-0000-0000-000000000003', 'Worksheet', 'file', 'resources/r3.pdf', 'r3.pdf'),
  ('90000000-0000-0000-0000-000000000004', 'Unused', 'file', 'resources/r4.pdf', 'r4.pdf');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
do $$ begin
  perform public.delete_resource('90000000-0000-0000-0000-000000000003');
  raise exception 'deleted another tutor''s resource';
exception when insufficient_privilege then raise notice 'ok - only the uploader or an admin deletes a resource';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(public.delete_resource('90000000-0000-0000-0000-000000000003') is null,
  'deleting a library file that homework uses keeps the stored file');
select pg_temp.check(public.delete_resource('90000000-0000-0000-0000-000000000004') = 'resources/r4.pdf',
  'deleting an unused library file hands back its path for removal');
select pg_temp.check(not exists (select 1 from public.resources where id in ('90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000004')),
  'both library entries are gone');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(public.classwork_can_read('resources/r3.pdf'), 'the family can still open the homework copy');

-- Stored files still in use cannot be deleted (the classwork delete policy checks classwork_can_delete).
select pg_temp.check(not public.classwork_can_delete('resources/r3.pdf'), 'a library file attached to homework cannot be deleted');
select pg_temp.check(public.classwork_can_delete('resources/r4.pdf'), 'a file nothing refers to any more can be deleted');
select pg_temp.check(not public.classwork_can_delete(null) and not public.classwork_can_delete(''), 'an empty name is never deletable');
select pg_temp.check((select bool_and(not public.classwork_can_delete(f->>'path'))
    from public.homework_submissions s, jsonb_array_elements(s.files) f where f->>'path' is not null)
  and exists (select 1 from public.homework_submissions s, jsonb_array_elements(s.files) f where f->>'path' is not null),
  'hand-in files cannot be deleted');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into public.resources (id, title, kind, path, file_name) values
  ('90000000-0000-0000-0000-000000000005', 'Kept', 'file', 'resources/r5.pdf', 'r5.pdf');
select pg_temp.check(not public.classwork_can_delete('resources/r5.pdf'), 'a library resource''s file cannot be deleted while the resource exists');

reset role;
set role anon;
do $$ begin
  perform 1 from public.resources;
  raise exception 'anon read resources';
exception when insufficient_privilege then raise notice 'ok - anonymous visitors cannot read the library';
end $$;
reset role;

-- Subjects: a tutor who teaches a student through an enrolment, before any lesson, can set homework;
-- a tutor whose enrolment has ended cannot.
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Rami Ahmed', 'Lower Secondary');
insert into public.enrolments (id, student_id, subject, curriculum, tutor_id) values
  ('70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'English', 'British', 'b0000000-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((public.save_homework(null, 'd0000000-0000-0000-0000-000000000003', 'Reading log', null, current_date + 7, '[]')).tutor_id
  = 'b0000000-0000-0000-0000-000000000002', 'a tutor sets homework for a student they teach through an enrolment, before any lesson');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000003', 'Not mine', null, current_date + 7, '[]');
  raise exception 'set homework for a student taught only by another tutor';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot set homework for a student enrolled only with another tutor';
end $$;
reset role;
update public.enrolments set active = false where id = '70000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
do $$ begin
  perform public.save_homework(null, 'd0000000-0000-0000-0000-000000000003', 'After the subject ended', null, current_date + 7, '[]');
  raise exception 'set homework after the enrolment ended';
exception when insufficient_privilege then raise notice 'ok - once the enrolment ends the tutor can no longer set homework';
end $$;
reset role;

select pg_temp.check(not exists (select 1 from public.notification_outbox where body like '%AE9903312345%' or body like '%IBAN%'),
  'bank details never appear in homework notifications');
