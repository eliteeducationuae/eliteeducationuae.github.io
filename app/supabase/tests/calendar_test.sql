-- Google Calendar sync: the lesson queue, token privacy, busy blocks and open slots.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200), ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma');
-- Each student's subjects (enrolments), with the tutor who teaches them.
insert into public.enrolments (student_id, subject, curriculum, level, exam_board, syllabus_id, tutor_id) values
  ('d0000000-0000-0000-0000-000000000001', 'Maths', 'IB DP', 'AA SL', 'IB', 'ib-aa-sl', 'b0000000-0000-0000-0000-000000000001');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
-- Both tutors are available 15:00–18:00 every day.
insert into public.availability (tutor_id, weekday, start_time, end_time)
select t, d, '15:00', '18:00' from generate_series(0, 6) d,
  unnest(array['b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002']::uuid[]) t;
create temp table days as select (now() at time zone 'Asia/Dubai')::date + 3 as d3, (now() at time zone 'Asia/Dubai')::date + 4 as d4;
grant select on days to authenticated, anon;

-- The queue ------------------------------------------------------------------
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location)
select 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
  'e0000000-0000-0000-0000-000000000001', (d4 + time '15:00') at time zone 'Asia/Dubai', (d4 + time '16:00') at time zone 'Asia/Dubai', 'online' from days;
select pg_temp.check((select count(*) from public.calendar_sync_queue) = 0, 'nothing is queued while no calendar is connected');

insert into public.calendar_connections (profile_id, google_email, refresh_token, access_token, access_token_expires_at)
values ('a0000000-0000-0000-0000-0000000000b1', 'tia@gmail.example', 'secret-refresh', 'secret-access', now() + interval '1 hour'),
       ('a0000000-0000-0000-0000-0000000000b2', 'tom@gmail.example', 'secret-refresh-2', null, null);

insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location)
select 'f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
  'e0000000-0000-0000-0000-000000000001', (d4 + time '17:00') at time zone 'Asia/Dubai', (d4 + time '18:00') at time zone 'Asia/Dubai', 'online' from days;
select pg_temp.check((select reason from public.calendar_sync_queue order by id desc limit 1) = 'created', 'a new lesson is queued as created');

update public.lessons set start_at = start_at - interval '30 minutes', end_at = end_at - interval '30 minutes'
 where id = 'f0000000-0000-0000-0000-000000000002';
select pg_temp.check((select reason from public.calendar_sync_queue order by id desc limit 1) = 'changed', 'a rescheduled lesson is queued as changed');

update public.lessons set status = 'cancelled' where id = 'f0000000-0000-0000-0000-000000000002';
select pg_temp.check((select reason from public.calendar_sync_queue order by id desc limit 1) = 'cancelled', 'a cancelled lesson is queued as cancelled');

create temp table before_count as select count(*) as n from public.calendar_sync_queue;
update public.lessons set reminded_at = now() where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.calendar_sync_queue) = (select n from before_count), 'a reminder stamp alone queues nothing');

delete from public.lessons where id = 'f0000000-0000-0000-0000-000000000002';
select pg_temp.check((select reason || '/' || lesson_id from public.calendar_sync_queue order by id desc limit 1)
  = 'deleted/f0000000-0000-0000-0000-000000000002', 'a deleted lesson is queued as deleted');

-- Connection privacy -----------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select status || '/' || google_email from public.calendar_connections where profile_id = 'a0000000-0000-0000-0000-0000000000b1')
  = 'connected/tia@gmail.example', 'a tutor sees the status of their own connection');
select pg_temp.check((select count(*) from public.calendar_connections where profile_id = 'a0000000-0000-0000-0000-0000000000b2') = 0,
  'a tutor cannot see another tutor''s connection');
do $$ begin
  perform refresh_token from public.calendar_connections;
  raise exception 'read a refresh token';
exception when insufficient_privilege then raise notice 'ok - tokens cannot be read from the app';
end $$;
do $$ begin
  perform access_token from public.calendar_connections;
  raise exception 'read an access token';
exception when insufficient_privilege then raise notice 'ok - access tokens cannot be read from the app';
end $$;
do $$ begin
  update public.calendar_connections set status = 'error';
  raise exception 'changed a connection';
exception when insufficient_privilege then raise notice 'ok - the app cannot change a connection';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.calendar_connections) = 2, 'the admin sees every connection');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.calendar_connections) = 0, 'a parent sees no connections');
do $$ begin
  perform 1 from public.calendar_sync_queue;
  raise exception 'read the queue';
exception when insufficient_privilege then raise notice 'ok - the sync queue is server-only';
end $$;
do $$ begin
  perform 1 from public.calendar_oauth_states;
  raise exception 'read oauth states';
exception when insufficient_privilege then raise notice 'ok - OAuth states are server-only';
end $$;

-- Busy blocks ------------------------------------------------------------------
reset role;
-- Tia is busy in Google 16:00–17:00 on day 3, and Tom on day 3 too.
insert into public.busy_blocks (tutor_id, start_at, end_at)
select 'b0000000-0000-0000-0000-000000000001'::uuid, (d3 + time '16:00') at time zone 'Asia/Dubai', (d3 + time '17:00') at time zone 'Asia/Dubai' from days
union all
select 'b0000000-0000-0000-0000-000000000002', (d3 + time '15:00') at time zone 'Asia/Dubai', (d3 + time '16:00') at time zone 'Asia/Dubai' from days;
set role authenticated;

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.busy_blocks) = 0, 'a parent sees no busy blocks');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.busy_blocks) = 1
  and (select tutor_id from public.busy_blocks) = 'b0000000-0000-0000-0000-000000000001', 'a tutor sees only their own busy blocks');
do $$ begin
  insert into public.busy_blocks (tutor_id, start_at, end_at) values ('b0000000-0000-0000-0000-000000000001', now(), now() + interval '1 hour');
  raise exception 'inserted a busy block';
exception when insufficient_privilege then raise notice 'ok - tutors cannot write busy blocks';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.busy_blocks) = 2, 'the admin sees every busy block');

-- Open slots: 15:00, 15:30, 16:00, 16:30, 17:00 for a 60-minute lesson. Busy 16:00–17:00 removes 15:30, 16:00 and 16:30;
-- 15:00 (ending as the block starts) and 17:00 (starting as it ends) remain.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
create temp table slots as
select (o.start_at at time zone 'Asia/Dubai')::time as t from public.open_slots('b0000000-0000-0000-0000-000000000001', (select d3 from days), 1, 60) o;
select pg_temp.check((select array_agg(t order by t) from slots) = array['15:00', '17:00']::time[],
  'open slots skip Google busy times but keep the adjacent slots');
select pg_temp.check((select count(*) from public.open_slots('b0000000-0000-0000-0000-000000000001', (select d3 from days) + 2, 1, 60)) = 5,
  'busy blocks on other days do not affect a day');
do $$ begin
  perform public.request_lesson('d0000000-0000-0000-0000-000000000001', 'new-lesson', null, 'b0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001', (select (d3 + time '16:00') at time zone 'Asia/Dubai' from days), null);
  raise exception 'requested a busy time';
exception when raise_exception then
  if sqlerrm = 'requested a busy time' then raise; end if;
  raise notice 'ok - a family cannot request a time when the tutor is busy in Google';
end $$;

-- Backfill ---------------------------------------------------------------------
do $$ begin
  perform public.queue_calendar_backfill('a0000000-0000-0000-0000-0000000000b1');
  raise exception 'ran backfill';
exception when insufficient_privilege then raise notice 'ok - the app cannot run a backfill';
end $$;
reset role;
-- Tia: lesson 1 (day 4) and a new one next week; Tom: one next week; one long-past lesson and one too far ahead are skipped.
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location, status)
select tutor, '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001', s, s + interval '1 hour', 'online', st from (values
  ('b0000000-0000-0000-0000-000000000001'::uuid, now() + interval '7 days', 'scheduled'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, now() + interval '8 days', 'scheduled'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, now() + interval '9 days', 'cancelled'),
  ('b0000000-0000-0000-0000-000000000001'::uuid, now() - interval '3 days', 'scheduled'),
  ('b0000000-0000-0000-0000-000000000001'::uuid, now() + interval '200 days', 'scheduled')
) v(tutor, s, st);
select pg_temp.check(public.queue_calendar_backfill('a0000000-0000-0000-0000-0000000000b1') = 2, 'backfill queues the tutor''s upcoming lessons');
select pg_temp.check(public.queue_calendar_backfill('a0000000-0000-0000-0000-00000000000a') = 3, 'backfill queues every upcoming lesson for the admin');
select pg_temp.check(public.queue_calendar_backfill('a0000000-0000-0000-0000-00000000000c') = 0, 'backfill does nothing for a parent');
select pg_temp.check((select count(*) from public.calendar_sync_queue where reason = 'backfill') = 5, 'backfill rows are recorded');

-- A reconnecting calendar also has its stale events removed: cancelled, deleted or reassigned lessons it still holds.
insert into public.lesson_calendar_events (lesson_id, profile_id, google_event_id, calendar_id)
select l.id, 'a0000000-0000-0000-0000-0000000000b1'::uuid, 'ev-cancelled', 'primary' from public.lessons l
 where l.status = 'cancelled' and l.tutor_id = 'b0000000-0000-0000-0000-000000000002'
union all
select 'f0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-0000000000b1', 'ev-deleted', 'primary'
union all
select 'f0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000b1', 'ev-current', 'primary';
select pg_temp.check(public.queue_calendar_backfill('a0000000-0000-0000-0000-0000000000b1') = 4,
  'backfill also queues cancelled and deleted lessons the calendar still holds, without duplicates');

-- Busy-time exclusions -----------------------------------------------------------
-- The admin teaches too (like Craig). Their calendar holds Tom's lesson next week, which must not become their busy time.
update public.profiles set tutor_id = 'b0000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-00000000000a';
insert into public.lesson_calendar_events (lesson_id, profile_id, google_event_id, calendar_id)
select l.id, 'a0000000-0000-0000-0000-00000000000a', 'ev-tom', 'primary' from public.lessons l
 where l.status = 'scheduled' and l.tutor_id = 'b0000000-0000-0000-0000-000000000002';
create temp table excl as
select * from public.calendar_lessons_for('a0000000-0000-0000-0000-00000000000a', now(), now() + interval '60 days');
select pg_temp.check((select count(*) from excl where tutor_id = 'b0000000-0000-0000-0000-000000000002' and in_calendar) = 1,
  'another tutor''s lesson written into the admin''s calendar is listed as ours');
select pg_temp.check((select count(*) from excl where tutor_id = 'b0000000-0000-0000-0000-000000000001') = 2,
  'the admin''s own lessons are listed even before they reach the calendar');
select pg_temp.check((select count(*) from excl where tutor_id = 'b0000000-0000-0000-0000-000000000002' and not in_calendar) = 0,
  'lessons in neither the calendar nor the tutor''s own diary are left out');
select pg_temp.check((select count(*) from public.calendar_lessons_for('a0000000-0000-0000-0000-0000000000b2', now(), now() + interval '60 days')
  where tutor_id = 'b0000000-0000-0000-0000-000000000001') = 0, 'a tutor''s calendar lists none of another tutor''s lessons');

-- One run at a time -------------------------------------------------------------------
select pg_temp.check(public.calendar_sync_acquire('11111111-1111-1111-1111-111111111111', 600), 'the first run takes the lease');
select pg_temp.check(not public.calendar_sync_acquire('22222222-2222-2222-2222-222222222222', 600), 'an overlapping run is turned away');
select public.calendar_sync_release('22222222-2222-2222-2222-222222222222');
select pg_temp.check(not public.calendar_sync_acquire('22222222-2222-2222-2222-222222222222', 600), 'only the holder can release the lease');
select public.calendar_sync_release('11111111-1111-1111-1111-111111111111');
select pg_temp.check(public.calendar_sync_acquire('22222222-2222-2222-2222-222222222222', 600), 'a released lease can be taken');
update public.calendar_sync_lock set expires_at = now() - interval '1 second';
select pg_temp.check(public.calendar_sync_acquire('33333333-3333-3333-3333-333333333333', 600), 'an expired lease (a crashed run) can be taken');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.calendar_sync_acquire(gen_random_uuid(), 600);
  raise exception 'took the lease';
exception when insufficient_privilege then raise notice 'ok - the app cannot take the sync lease';
end $$;
do $$ begin
  perform * from public.calendar_lessons_for('a0000000-0000-0000-0000-00000000000a', now(), now() + interval '1 day');
  raise exception 'read calendar lessons';
exception when insufficient_privilege then raise notice 'ok - calendar lesson lists are server-only';
end $$;
do $$ begin
  perform 1 from public.calendar_sync_lock;
  raise exception 'read the lock';
exception when insufficient_privilege then raise notice 'ok - the sync lease is server-only';
end $$;
reset role;
