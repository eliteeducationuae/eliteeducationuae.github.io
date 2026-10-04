-- WhatsApp reminders: opt-in, templates, invoice and lesson-notes triggers, daily reminder queueing and privileges.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
create function pg_temp.wa(p_profile text, p_template text) returns setof public.notification_outbox language sql as $$
  select * from public.notification_outbox where whatsapp and profile_id = p_profile::uuid and whatsapp_template = p_template
$$;

-- Admin; tutor Tia; the Ahmed family (Mona opts in, Karim does not) with Sami and Lina; the Other family (Otto) with Ollie;
-- a student login for Sami.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000d', 'dad@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x'),
  ('a0000000-0000-0000-0000-00000000000f', 'sami@x'),
  ('a0000000-0000-0000-0000-000000000010', 'lina@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-sl'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'IB', 'ib-aa-sl'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Lina Ahmed', 'IB', 'ib-aa-sl');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000d', 'parent', 'Karim Ahmed', 'dad@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Mr Otto Other', 'other@x', null, 'c0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-00000000000f', 'student', 'Sami Ahmed', 'sami@x', null, null, 'd0000000-0000-0000-0000-000000000001');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);

-- Templates ------------------------------------------------------------------
select pg_temp.check(public.whatsapp_clean(E'  Ex 13A:\n vectors\t\tq1-5  ') = 'Ex 13A: vectors q1-5', 'variables are cleaned to a single line');
select pg_temp.check(public.whatsapp_preview('lesson_reminder', '{"1":"Mona","2":"Sami","3":"Tia Tutor","4":"Tue 6 Oct, 16:00"}')
  = 'Dear Mona, this is a reminder that Sami has a lesson with Tia Tutor on Tue 6 Oct, 16:00 (UAE time). Elite Education | eliteeducation.me',
  'the lesson reminder preview fills every placeholder');
select pg_temp.check((select bool_and(public.whatsapp_template_body(t) is not null and position('''' in public.whatsapp_template_body(t)) = 0
    and public.whatsapp_template_body(t) like '%Elite Education | eliteeducation.me')
  from unnest(array['lesson_reminder', 'lesson_notes', 'invoice_sent', 'invoice_overdue', 'homework_due']) t),
  'all five templates exist, carry the footer and contain no apostrophes');
select pg_temp.check(public.whatsapp_template_body('nope') is null, 'unknown templates have no body');
select pg_temp.check(public.whatsapp_clean('Read {{4}} and {{1}}') = 'Read 4 and 1', 'variables cannot carry placeholders of their own');
select pg_temp.check(public.whatsapp_preview('homework_due', jsonb_build_object('4', public.whatsapp_clean('{{2}}'))) like '%: 2. Elite%',
  'cleaned values are not substituted twice');
select pg_temp.check(public.whatsapp_join_names('{}') = '' and public.whatsapp_join_names('{Omar}') = 'Omar'
  and public.whatsapp_join_names('{Omar,Layla}') = 'Omar and Layla'
  and public.whatsapp_join_names('{Omar,Layla,Sami}') = 'Omar, Layla and Sami', 'names are joined in house style');
select pg_temp.check(public.whatsapp_first_name('Mrs Mona Al Mansoori') = 'Mona' and public.whatsapp_first_name('Dr. Sarah Khan') = 'Sarah'
  and public.whatsapp_first_name('Sheikha Fatima') = 'Fatima' and public.whatsapp_first_name('mr  omar') = 'omar'
  and public.whatsapp_first_name('Mona Ahmed') = 'Mona' and public.whatsapp_first_name('  ') = ''
  and public.whatsapp_first_name(null) = '' and public.whatsapp_first_name('Misha Roy') = 'Misha',
  'greetings use the first name without an honorific');

-- Opting in --------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_whatsapp(true, '+971501234567');
reset role;
select pg_temp.check((select whatsapp_opt_in and whatsapp_number = '+971501234567' and whatsapp_opted_in_at is not null
  from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'), 'a parent opts in with their number');
update public.profiles set whatsapp_opted_in_at = '2026-01-01T00:00:00Z' where id = 'a0000000-0000-0000-0000-00000000000c';
set role authenticated;
select public.set_whatsapp(true, ' +971 50 123 4567 ');
reset role;
select pg_temp.check((select whatsapp_opted_in_at = '2026-01-01T00:00:00Z' and whatsapp_number = '+971501234567'
  from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'), 'opting in again with the same number keeps the original time');
set role authenticated;
do $$ begin
  perform public.set_whatsapp(true, '0501234567');
  raise exception 'accepted a number without a country code';
exception when raise_exception then
  if sqlerrm not like 'Please enter your WhatsApp number with its country code%' then raise; end if;
  raise notice 'ok - a number without a country code is rejected';
end $$;
do $$ begin
  perform public.set_whatsapp(true, '  ');
  raise exception 'opted in without a number';
exception when raise_exception then
  if sqlerrm <> 'Please enter your WhatsApp number.' then raise; end if;
  raise notice 'ok - opting in needs a number';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000f');
do $$ begin
  perform public.set_whatsapp(true, '+971500000009');
  raise exception 'a student opted in';
exception when raise_exception then
  if sqlerrm <> 'WhatsApp reminders are available to parents and tutors.' then raise; end if;
  raise notice 'ok - students cannot opt in';
end $$;
select pg_temp.as_user('');
do $$ begin
  perform public.set_whatsapp(true, '+971500000009');
  raise exception 'opted in while signed out';
exception when insufficient_privilege then raise notice 'ok - signed-out callers cannot opt in';
end $$;
-- Nobody can write WhatsApp fields straight into a profile, their own or anyone else's.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ declare n int; begin
  update public.profiles set whatsapp_opt_in = true, whatsapp_number = '+971500000099' where id = 'a0000000-0000-0000-0000-00000000000e';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED: a parent changed another profile'; end if;
  update public.profiles set whatsapp_number = '+971500000099' where id = 'a0000000-0000-0000-0000-00000000000c';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED: a parent wrote their own WhatsApp fields directly'; end if;
  raise notice 'ok - parents cannot update WhatsApp fields directly';
exception when insufficient_privilege then raise notice 'ok - parents cannot update WhatsApp fields directly';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select public.set_whatsapp(true, '+447700900123');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select public.set_whatsapp(true, '+971500000001');
-- Callers cannot queue messages or run the reminders themselves.
do $$ begin
  perform public.queue_whatsapp('a0000000-0000-0000-0000-00000000000c', 'lesson_notes', '{}');
  raise exception 'authenticated queued a WhatsApp';
exception when insufficient_privilege then raise notice 'ok - signed-in users cannot call queue_whatsapp';
end $$;
do $$ begin
  perform public.queue_whatsapp_reminders();
  raise exception 'authenticated ran the reminders';
exception when insufficient_privilege then raise notice 'ok - signed-in users cannot call queue_whatsapp_reminders';
end $$;
do $$ begin
  perform public.whatsapp_preview('lesson_notes', '{}');
  raise exception 'authenticated previewed a template';
exception when insufficient_privilege then raise notice 'ok - signed-in users cannot call whatsapp_preview';
end $$;
reset role;
select pg_temp.check((select whatsapp_number from public.profiles where id = 'a0000000-0000-0000-0000-00000000000e') = '+447700900123',
  'another parent opts in with a UK number');
select pg_temp.check((select not whatsapp_opt_in and whatsapp_number is null from public.profiles where id = 'a0000000-0000-0000-0000-00000000000f'),
  'the student profile is unchanged');

-- Constraints ----------------------------------------------------------------------
do $$ begin
  insert into public.notification_outbox (profile_id, subject, body, send_email, whatsapp, whatsapp_to, whatsapp_status)
  values ('a0000000-0000-0000-0000-00000000000c', 'x', 'x', false, true, '+971501234567', 'pending');
  raise exception 'accepted a WhatsApp row with no template';
exception when check_violation then raise notice 'ok - WhatsApp outbox rows need a template';
end $$;
do $$ begin
  update public.profiles set whatsapp_opt_in = true where id = 'a0000000-0000-0000-0000-00000000000d';
  raise exception 'opted in with no number';
exception when check_violation then raise notice 'ok - profiles cannot opt in without a number';
end $$;

-- Students never receive WhatsApp messages, even if opted in somehow.
update public.profiles set whatsapp_opt_in = true, whatsapp_number = '+971500000009' where id = 'a0000000-0000-0000-0000-00000000000f';
select pg_temp.check(not public.queue_whatsapp('a0000000-0000-0000-0000-00000000000f', 'homework_due', '{"2":"Sami","3":"Wed 7 Oct","4":"Ex"}'),
  'queue_whatsapp ignores students');
select pg_temp.check(not exists (select 1 from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-00000000000f'),
  'nothing is queued for the student');
select pg_temp.check(not public.queue_whatsapp('a0000000-0000-0000-0000-00000000000d', 'lesson_notes', '{"2":"Sami","3":"1 Oct"}'),
  'queue_whatsapp ignores parents who have not opted in');

-- Invoice sent ---------------------------------------------------------------------
update public.settings set bank_details = 'IBAN AE07 0331 2345 6789 0123 456' where id = 1;
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000042', 'INV-0042', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15', 'draft',
   '[{"description":"IB 1:1","quantity":3,"unitPrice":350}]');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp), 'draft invoices send no WhatsApp');
update public.invoices set status = 'sent' where number = 'INV-0042';
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'invoice_sent') = 1
  and (select count(*) from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'invoice_sent')) = 1,
  'one WhatsApp for the opted-in parent and none for the other parent');
select pg_temp.check((select whatsapp_vars = '{"1":"Mona","2":"INV-0042","3":"AED 1,050.00","4":"15 Oct 2026"}'::jsonb
    and body = 'Dear Mona, invoice INV-0042 for AED 1,050.00 is now available in the Elite Education app and is due by 15 Oct 2026. Elite Education | eliteeducation.me'
    and subject = 'WhatsApp: invoice sent' and whatsapp_to = '+971501234567' and whatsapp_status = 'pending'
    and not send_email and email is null and push_title is null and url = '/invoice/10000000-0000-0000-0000-000000000042'
  from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'invoice_sent')), 'the invoice WhatsApp has the agreed variables and body');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp
    and (body ~ '(IBAN|AE07|ank)' or whatsapp_vars::text ~ '(IBAN|AE07|ank)')), 'WhatsApp messages never carry bank details');
select pg_temp.check(exists (select 1 from public.notification_outbox where not whatsapp and subject = 'Invoice INV-0042 from Elite Education'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c'), 'the invoice email is still queued');
update public.invoices set status = 'sent', notes = 'x' where number = 'INV-0042';
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'invoice_sent') = 1,
  'updating an already-sent invoice sends nothing more');

-- Lesson notes -----------------------------------------------------------------------
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000003}', 'e0000000-0000-0000-0000-000000000001',
   '2026-10-01 10:00+04', '2026-10-01 11:00+04', 'online');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select public.complete_lesson('f0000000-0000-0000-0000-000000000001', 'completed', '{}', 'Vectors: dot product', null, '{}', '[]', '[]');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'lesson_notes') = 1
  and (select body = 'Dear Mona, the lesson notes for Sami and Lina from 1 Oct are now ready in the Elite Education app. Elite Education | eliteeducation.me'
      and whatsapp_vars = '{"1":"Mona","2":"Sami and Lina","3":"1 Oct"}'::jsonb and url = '/lesson/f0000000-0000-0000-0000-000000000001'
    from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'lesson_notes')), 'completing a lesson sends the notes WhatsApp to the opted-in parent');
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status) values
  ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', '2026-10-02 10:00+04', '2026-10-02 11:00+04', 'online', 'no-show');
insert into public.lesson_notes (lesson_id, summary) values ('f0000000-0000-0000-0000-000000000009', '');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'lesson_notes') = 1,
  'no-show lessons send no notes WhatsApp');

-- Reminders on Tuesday 6 October 2026 (Dubai): 00:30, 07:30, 08:30 and 09:30 ---------------
-- Lessons: 16:00 today (Sami and Ollie, two families), Wednesday 14:00 (too far ahead), and 09:30 today (too soon at 08:30).
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-10-06 16:00+04', '2026-10-06 17:00+04', 'online'),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', '2026-10-07 14:00+04', '2026-10-07 15:00+04', 'online'),
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', '2026-10-06 09:30+04', '2026-10-06 10:30+04', 'online');
-- Invoices: due yesterday (sent), due 40 days ago (sent), due yesterday (paid). Inserting the two sent ones queues invoice_sent for Mona.
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000043', 'INV-0043', 'c0000000-0000-0000-0000-000000000001', '2026-09-28', '2026-10-05', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450}]'),
  ('10000000-0000-0000-0000-000000000044', 'INV-0044', 'c0000000-0000-0000-0000-000000000001', '2026-08-20', '2026-08-27', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450}]'),
  ('10000000-0000-0000-0000-000000000045', 'INV-0045', 'c0000000-0000-0000-0000-000000000002', '2026-09-28', '2026-10-05', 'paid',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450}]');
-- INV-0043 has been part paid: 200 of 450.
insert into public.payments (invoice_id, amount, method) values ('10000000-0000-0000-0000-000000000043', 200, 'bank-transfer');
-- Homework: due tomorrow (not done), due tomorrow (done).
insert into public.homework (id, student_id, title, due_date, done) values
  ('20000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', E'Ex 13A:\nvectors  questions 1-5', '2026-10-07', false),
  ('20000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Past paper', '2026-10-07', true);

select pg_temp.check((select status from public.invoices where number = 'INV-0043') = 'sent', 'a part-paid invoice stays sent');
select count(*) as before_rows from public.notification_outbox \gset

-- Just after midnight nothing is sent and nothing is marked, so the items wait for the day.
set role service_role;
select public.queue_whatsapp_reminders('2026-10-06 00:30+04') as midnight \gset
select public.queue_whatsapp_reminders('2026-10-06 07:30+04') as early \gset
reset role;
select pg_temp.check(:midnight = 0 and :early = 0 and (select count(*) from public.notification_outbox) = :before_rows,
  'nothing is queued at 00:30 or 07:30 UAE time');
select pg_temp.check(not exists (select 1 from public.lessons where whatsapp_reminded_at is not null)
  and not exists (select 1 from public.invoices where overdue_whatsapp_at is not null)
  and not exists (select 1 from public.homework where due_whatsapp_at is not null), 'and nothing is marked as reminded');

-- 08:30: lesson reminders only (tutor, Mona and Otto); the overdue chase and homework wait until 09:00.
set role service_role;
select public.queue_whatsapp_reminders('2026-10-06 08:30+04') as lessons_run \gset
reset role;
select pg_temp.check(:lessons_run = 3 and (select count(*) from public.notification_outbox where whatsapp
    and whatsapp_template in ('invoice_overdue', 'homework_due')) = 0
  and not exists (select 1 from public.invoices where overdue_whatsapp_at is not null)
  and not exists (select 1 from public.homework where due_whatsapp_at is not null),
  'at 08:30 lessons are reminded but invoices and homework are held back (got ' || :lessons_run || ')');

-- 09:30: Mona for the overdue invoice and Mona for the homework.
set role service_role;
select public.queue_whatsapp_reminders('2026-10-06 09:30+04') as day_run \gset
reset role;
select pg_temp.check(:day_run = 2, 'the 09:30 run queues the overdue chase and the homework reminder (got ' || :day_run || ')');
select pg_temp.check((select count(*) from public.notification_outbox) = :before_rows + 5, 'and the outbox grows by five in all');
select pg_temp.check((select whatsapp_vars = '{"1":"Tia","2":"Sami and Ollie","3":"you","4":"Tue 6 Oct, 16:00"}'::jsonb
    and body = 'Dear Tia, this is a reminder that Sami and Ollie has a lesson with you on Tue 6 Oct, 16:00 (UAE time). Elite Education | eliteeducation.me'
    and whatsapp_to = '+971500000001' and url = '/lesson/f0000000-0000-0000-0000-000000000002'
  from pg_temp.wa('a0000000-0000-0000-0000-00000000000b', 'lesson_reminder')), 'the tutor is reminded of their lesson');
select pg_temp.check((select whatsapp_vars = '{"1":"Mona","2":"Sami","3":"Tia Tutor","4":"Tue 6 Oct, 16:00"}'::jsonb
    and body = 'Dear Mona, this is a reminder that Sami has a lesson with Tia Tutor on Tue 6 Oct, 16:00 (UAE time). Elite Education | eliteeducation.me'
  from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'lesson_reminder')), 'the parent is reminded with the tutor name and Dubai time');
select pg_temp.check((select whatsapp_vars->>'1' = 'Otto' and whatsapp_vars->>'2' = 'Ollie' and whatsapp_to = '+447700900123'
  from pg_temp.wa('a0000000-0000-0000-0000-00000000000e', 'lesson_reminder')), 'each family hears only about its own children, greeted without an honorific');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'lesson_reminder'
  and url <> '/lesson/f0000000-0000-0000-0000-000000000002') = 0, 'lessons 30 hours or 1 hour away are not reminded');
select pg_temp.check((select whatsapp_reminded_at is null from public.lessons where id = 'f0000000-0000-0000-0000-000000000003')
  and (select whatsapp_reminded_at is null from public.lessons where id = 'f0000000-0000-0000-0000-000000000004')
  and (select whatsapp_reminded_at = '2026-10-06 08:30+04' from public.lessons where id = 'f0000000-0000-0000-0000-000000000002'),
  'only the lesson in the window is marked as reminded');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'invoice_overdue') = 1
  and (select body = 'Dear Mona, invoice INV-0043 for AED 250.00 was due on 5 Oct 2026 and remains unpaid. You may view and pay it in the Elite Education app. If you have already paid, please disregard this message. Elite Education | eliteeducation.me'
      and url = '/invoice/10000000-0000-0000-0000-000000000043'
    from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'invoice_overdue')),
  'an invoice due yesterday is chased for the balance still owed; one 40 days late and a paid one are not');
select pg_temp.check((select overdue_whatsapp_at is not null from public.invoices where number = 'INV-0043')
  and (select overdue_whatsapp_at is null from public.invoices where number = 'INV-0044'), 'only the chased invoice is marked');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'homework_due') = 1
  and (select body = 'Dear Mona, this is a reminder that Sami has homework due on Wed 7 Oct: Ex 13A: vectors questions 1-5. Elite Education | eliteeducation.me'
      and subject = 'WhatsApp: homework due'
    from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'homework_due')),
  'undone homework due tomorrow is reminded on one line; done homework is not');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp
    and (body ~ '(IBAN|AE07|ank)' or whatsapp_vars::text ~ '(IBAN|AE07|ank)' or body like '%{{%')),
  'no reminder carries bank details or an unfilled placeholder');

set role service_role;
select public.queue_whatsapp_reminders('2026-10-06 09:30+04') as again \gset
reset role;
select pg_temp.check(:again = 0 and (select count(*) from public.notification_outbox) = :before_rows + 5,
  'running the reminders again queues nothing');

-- Opting out ------------------------------------------------------------------------------
update public.notification_outbox set whatsapp_status = 'sent', whatsapp_sent_at = now()
  where profile_id = 'a0000000-0000-0000-0000-00000000000c' and whatsapp_template = 'invoice_sent'
    and url = '/invoice/10000000-0000-0000-0000-000000000042';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_whatsapp(false, '+971501234567');
reset role;
select pg_temp.check((select not whatsapp_opt_in and whatsapp_number = '+971501234567' and whatsapp_opted_in_at is null
  from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'), 'opting out keeps the number but clears the opt-in');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_whatsapp(false, null);
reset role;
select pg_temp.check((select not whatsapp_opt_in and whatsapp_number = '+971501234567'
  from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'), 'opting out with no number still keeps the saved number');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp
    and profile_id = 'a0000000-0000-0000-0000-00000000000c' and whatsapp_status = 'pending')
  and (select count(*) from public.notification_outbox where whatsapp
    and profile_id = 'a0000000-0000-0000-0000-00000000000c' and whatsapp_status = 'skipped') = 6
  and (select whatsapp_status from pg_temp.wa('a0000000-0000-0000-0000-00000000000c', 'invoice_sent')
    where url = '/invoice/10000000-0000-0000-0000-000000000042') = 'sent',
  'opting out skips unsent WhatsApp messages and leaves sent ones alone');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_status = 'pending'
  and profile_id <> 'a0000000-0000-0000-0000-00000000000c') = 2, 'other people''s messages are untouched');
select pg_temp.check(not public.queue_whatsapp('a0000000-0000-0000-0000-00000000000c', 'lesson_notes', '{"2":"Sami","3":"1 Oct"}'),
  'nothing more is queued after opting out');
set role authenticated;
select public.set_whatsapp(true, '+971501234567');
reset role;
select pg_temp.check((select whatsapp_opt_in and whatsapp_opted_in_at > '2026-01-01T00:00:00Z'
  from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'), 'opting back in records a fresh time');

-- Names ------------------------------------------------------------------------------------
-- Karim opts in but his profile has no name and the family record is Mona's, so nothing is queued rather than a nameless message.
update public.profiles set full_name = '', whatsapp_opt_in = true, whatsapp_number = '+971500000077'
  where id = 'a0000000-0000-0000-0000-00000000000d';
select pg_temp.check(not public.queue_whatsapp('a0000000-0000-0000-0000-00000000000d', 'lesson_notes', '{"2":"Sami","3":"1 Oct"}')
  and not exists (select 1 from public.notification_outbox where whatsapp and profile_id = 'a0000000-0000-0000-0000-00000000000d'),
  'a profile with no name is not sent a message addressed to nobody');
-- When the family record is his, its parent name is used instead.
update public.families set parent_name = 'Mr Karim Ahmed', email = 'DAD@x' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.check(public.queue_whatsapp('a0000000-0000-0000-0000-00000000000d', 'lesson_notes', '{"2":"Sami","3":"1 Oct"}')
  and (select whatsapp_vars->>'1' = 'Karim' and body like 'Dear Karim, %'
    from pg_temp.wa('a0000000-0000-0000-0000-00000000000d', 'lesson_notes')), 'a nameless parent is greeted by the family record name');
\echo 'All WhatsApp tests passed'
