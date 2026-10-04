-- Sign-up, enquiries, booking, messaging, notifications and cover. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', id, false)
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x', 200),
  ('b0000000-0000-0000-0000-000000000002', 'Cal Cover', 'cover@x', 200);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-sl'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'IB', 'ib-aa-sl');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto Other', 'other@x', null, 'c0000000-0000-0000-0000-000000000002');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
-- Tia is available 15:00–18:00 every day; Cal too.
insert into public.availability (tutor_id, weekday, start_time, end_time)
select t, d, '15:00', '18:00' from generate_series(0, 6) d,
  unnest(array['b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002']::uuid[]) t;

-- Day 3 from now (local) has an existing 16:00 lesson for Sami with Tia; day 5 is a closure; day 6 Tia is absent.
create temp table days as select (now() at time zone 'Asia/Dubai')::date + 3 as d3, (now() at time zone 'Asia/Dubai')::date + 5 as d5,
  (now() at time zone 'Asia/Dubai')::date + 6 as d6;
grant select on days to authenticated, anon;
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location)
select 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
  'e0000000-0000-0000-0000-000000000001', (d3 + time '16:00') at time zone 'Asia/Dubai', (d3 + time '17:00') at time zone 'Asia/Dubai', 'online' from days;
insert into public.closures (name, start_date, end_date) select 'Holiday', d5, d5 from days;
insert into public.tutor_absences (tutor_id, start_date, end_date) select 'b0000000-0000-0000-0000-000000000001', d6, d6 from days;

set role authenticated;

-- Open slots: 15:00–18:00 in 30-minute steps for a 60-minute lesson = 15:00, 15:30, 16:00, 16:30, 17:00;
-- the 16:00–17:00 lesson rules out 15:30, 16:00 and 16:30.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.open_slots('b0000000-0000-0000-0000-000000000001', (select d3 from days), 1, 60)) = 2,
  'open slots skip times that clash with existing lessons');
select pg_temp.check((select count(*) from public.open_slots('b0000000-0000-0000-0000-000000000001', (select d5 from days), 1, 60)) = 0,
  'no slots on a closure day');
select pg_temp.check((select count(*) from public.open_slots('b0000000-0000-0000-0000-000000000001', (select d6 from days), 1, 60)) = 0,
  'no slots while the tutor is away');
select pg_temp.check((select count(*) from public.open_slots('b0000000-0000-0000-0000-000000000002', (select d6 from days), 1, 60)) = 5,
  'another tutor is still available that day');
select pg_temp.check((select count(*) from public.open_slots('b0000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Dubai')::date, 1, 60)) = 0,
  'no slots inside the booking notice period');

-- Requests
create temp table req (id uuid);
grant all on req to authenticated;
insert into req select public.request_lesson('d0000000-0000-0000-0000-000000000001', 'new-lesson', null, 'b0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001', (select (d3 + time '17:00') at time zone 'Asia/Dubai' from days), 'Before mocks please');
select pg_temp.check((select status from public.lesson_requests) = 'pending', 'parent requests an open slot');
do $$ begin
  perform public.request_lesson('d0000000-0000-0000-0000-000000000001', 'new-lesson', null, 'b0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001', (select (d3 + time '16:00') at time zone 'Asia/Dubai' from days), null);
  raise exception 'booked a taken slot';
exception when raise_exception then
  if sqlerrm = 'booked a taken slot' then raise; end if;
  raise notice 'ok - cannot request a slot that is taken';
end $$;
do $$ begin
  perform public.request_lesson('d0000000-0000-0000-0000-000000000002', 'new-lesson', null, 'b0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001', (select (d3 + time '15:00') at time zone 'Asia/Dubai' from days), null);
  raise exception 'booked for someone else''s child';
exception when insufficient_privilege then raise notice 'ok - cannot request lessons for another family''s child';
end $$;
-- Reschedule the existing 16:00 lesson to 15:00 the same day (its own slot doesn't block it).
insert into req select public.request_lesson('d0000000-0000-0000-0000-000000000001', 'reschedule', 'f0000000-0000-0000-0000-000000000001', null, null,
  (select (d3 + time '15:00') at time zone 'Asia/Dubai' from days), null);

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.lesson_requests) = 0, 'other families cannot see requests');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.lesson_requests) = 2, 'the tutor sees requests for their lessons');
do $$ begin
  perform public.decide_request((select id from public.lesson_requests limit 1), true);
  raise exception 'tutor approved';
exception when insufficient_privilege then raise notice 'ok - only admins approve requests';
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.decide_request(id, true, 'See you then') from public.lesson_requests where kind = 'new-lesson';
select pg_temp.check((select count(*) from public.lessons) = 2, 'approving a new-lesson request creates the lesson');
-- The new 17:00 lesson and the requested 15:00 move don't clash.
select public.decide_request(id, true) from public.lesson_requests where kind = 'reschedule';
select pg_temp.check((select to_char(start_at at time zone 'Asia/Dubai', 'HH24:MI') from public.lessons where id = 'f0000000-0000-0000-0000-000000000001') = '15:00',
  'approving a reschedule moves the lesson');
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'Lesson confirmed%' and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 2,
  'the parent is told about each decision');
do $$ begin
  perform public.decide_request((select id from public.lesson_requests limit 1), false);
  raise exception 'decided twice';
exception when raise_exception then
  if sqlerrm = 'decided twice' then raise; end if;
  raise notice 'ok - requests can only be decided once';
end $$;

-- Messaging
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.send_message('c0000000-0000-0000-0000-000000000001', 'Can we focus on vectors next time?');
do $$ begin
  perform public.send_message('c0000000-0000-0000-0000-000000000002', 'hello');
  raise exception 'wrote to another family';
exception when insufficient_privilege then raise notice 'ok - parents cannot write in another family''s conversation';
end $$;
do $$ begin
  insert into public.messages (family_id, sender_id, sender_name, sender_role, body)
  values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000c', 'Mona', 'admin', 'spoof');
  raise exception 'spoofed role';
exception when insufficient_privilege then raise notice 'ok - cannot pretend to be staff';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check((select unread from public.my_threads() where family_id = 'c0000000-0000-0000-0000-000000000001') = 1, 'tutor sees an unread message');
select public.send_message('c0000000-0000-0000-0000-000000000001', 'Yes — vectors it is.');
select pg_temp.check((select unread from public.my_threads() where family_id = 'c0000000-0000-0000-0000-000000000001') = 0, 'replying marks the thread read');
select pg_temp.check(not exists (select 1 from public.my_threads() where family_id = 'c0000000-0000-0000-0000-000000000002'), 'tutor cannot see families they do not teach');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.messages) = 0, 'other parents cannot read the conversation');

reset role;
select pg_temp.check((select send_email from public.notification_outbox where subject = 'New message from Tia Tutor' and profile_id = 'a0000000-0000-0000-0000-00000000000c'),
  'parents are emailed when staff message them');
select pg_temp.check((select bool_and(not send_email) from public.notification_outbox where subject = 'New message from Mona Ahmed'),
  'staff get a push, not an email, for parent messages');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'New message from Mona Ahmed' and profile_id = 'a0000000-0000-0000-0000-00000000000b'),
  'the tutor is notified of the parent''s message');

-- Lesson notes and invoices are emailed to the family
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select public.complete_lesson('f0000000-0000-0000-0000-000000000001', 'completed', '{}', 'Vectors: dot product', null, '{}', '[]',
  '[{"studentId":"d0000000-0000-0000-0000-000000000001","title":"Ex 13A","dueDate":"2030-01-01"}]');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.invoice_unbilled('c0000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.check((select body from public.notification_outbox where subject like 'Lesson notes for Sami%') like '%Ex 13A%', 'lesson notes email includes homework');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject like 'Invoice INV-%' and profile_id = 'a0000000-0000-0000-0000-00000000000c'), 'invoice email queued');

-- Announcements
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.announcements (author_name, title, body, audience) values ('Boss', 'Tutor meeting', 'Monday 9am', 'tutors');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.announcements) = 0, 'parents do not see tutor-only announcements');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.announcements) = 1, 'tutors see their announcements');

-- Cover
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.reassign_lesson(id, 'b0000000-0000-0000-0000-000000000002') from public.lessons where status = 'scheduled' limit 1;
select pg_temp.check(exists (select 1 from public.lessons where tutor_id = 'b0000000-0000-0000-0000-000000000002'), 'admin reassigns a lesson for cover');

-- Enquiries from the public website (not signed in)
reset role;
set role anon;
select pg_temp.as_user('');
select public.submit_enquiry('Rita Rahman', 'rita@x', '+971500000000', 'Zara', 'IGCSE', 'Year 10', 'Help with algebra', 'Weekday evenings', 'website');
do $$ begin
  perform public.submit_enquiry('No Contact', '', '', null, null, null, null, null, 'website');
  raise exception 'accepted no contact details';
exception when raise_exception then
  if sqlerrm = 'accepted no contact details' then raise; end if;
  raise notice 'ok - enquiries need an email or phone';
end $$;
do $$ begin
  perform count(*) from public.enquiries;
  raise exception 'anon read enquiries';
exception when insufficient_privilege then raise notice 'ok - the public cannot read enquiries';
end $$;
reset role;
select pg_temp.check((select source from public.enquiries) = 'website', 'website enquiry saved');
select pg_temp.check(exists (select 1 from public.notification_outbox where email = 'rita@x' and subject like 'Thank you%'), 'enquirer gets a confirmation email');

-- Self sign-up creates a prospect family; parents can then add children
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values ('a0000000-0000-0000-0000-0000000000f1', 'new@x', now(), '{"signup":"parent","full_name":"Nadia Khan","phone":"050"}');
select pg_temp.check((select f.status || '/' || f.name from public.profiles p join public.families f on f.id = p.family_id
  where p.id = 'a0000000-0000-0000-0000-0000000000f1') = 'prospect/Khan', 'self sign-up creates a prospect family');
insert into auth.users (id, email, email_confirmed_at) values ('a0000000-0000-0000-0000-0000000000f2', 'nobody@x', now());
select pg_temp.check(not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-0000000000f2'), 'sign-ups without parent details get no access');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000f1');
select public.add_my_child('Zain Khan', 'IGCSE', 'igcse-4ma1', 'Repton', 'Year 9');
select pg_temp.check((select count(*) from public.students) = 1, 'parent adds a child and sees only them');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.add_my_child('X', 'IB', 'ib-aa-sl');
  raise exception 'tutor added a child';
exception when insufficient_privilege then raise notice 'ok - only parents add children';
end $$;
reset role;
\echo 'All engagement tests passed'
