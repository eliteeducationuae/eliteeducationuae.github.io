-- Closing accounts (anonymisation that keeps tax records) and "Download my data". Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss and Bea are admins. Tia teaches Sami; Tom teaches a group of Sami and Ollie.
-- Mona is the Ahmed parent (Sami and Lina); Sami has his own login. Otto is the Other parent (Ollie).
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000aa', 'bea@x'),
  ('a0000000-0000-0000-0000-0000000000b1', 'tia@x'), ('a0000000-0000-0000-0000-0000000000b2', 'tom@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mona@x'), ('a0000000-0000-0000-0000-00000000000d', 'sami@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'otto@x');
insert into public.tutors (id, full_name, email, phone, subjects) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 'tia@x', '+971500000001', '{Maths}'),
  ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 'tom@x', null, '{Chemistry}');
insert into public.families (id, name, parent_name, email, phone) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mona@x', '+971501112233'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'otto@x', null);
insert into public.students (id, family_id, full_name, curriculum, syllabus_id, school, year_group, current_grade, target_grade) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-sl', 'Dubai College', 'Year 12', '5', '7'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Lina Ahmed', 'IGCSE', 'igcse-0580', 'Dubai College', 'Year 10', '6', '8'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'IB', 'ib-aa-sl', 'GEMS', 'Year 12', '4', '6');
insert into public.profiles (id, role, full_name, email, phone, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null, null),
  ('a0000000-0000-0000-0000-0000000000aa', 'admin', 'Bea', 'bea@x', null, null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 'tia@x', '+971500000001', 'b0000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 'tom@x', null, 'b0000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mona@x', '+971501112233', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000d', 'student', 'Sami Ahmed', 'sami@x', null, null, null, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto Other', 'otto@x', null, null, 'c0000000-0000-0000-0000-000000000002', null);
update public.profiles set whatsapp_opt_in = true, whatsapp_number = '+971501112233', whatsapp_opted_in_at = now(), push_token = 'ExponentPushToken[x]'
 where id = 'a0000000-0000-0000-0000-00000000000c';
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status) values
  -- past, completed (Sami with Tia)
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '7 days', now() - interval '7 days' + interval '1 hour', 'online', 'completed'),
  -- upcoming (Sami with Tia)
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'online', 'scheduled'),
  -- upcoming group (Sami and Ollie with Tom)
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000003}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days' + interval '1 hour', 'in-person', 'scheduled'),
  -- upcoming (Ollie with Tia)
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000003}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days' + interval '1 hour', 'online', 'scheduled');
insert into public.lesson_notes (lesson_id, summary) values ('f0000000-0000-0000-0000-000000000001', 'Worked on vectors.');
insert into public.lesson_private_notes (lesson_id, private_note) values ('f0000000-0000-0000-0000-000000000001', 'PRIVATE remark for staff');
insert into public.student_notes (student_id, notes) values ('d0000000-0000-0000-0000-000000000001', 'Needs encouragement');
insert into public.lesson_notes (lesson_id, summary) values ('f0000000-0000-0000-0000-000000000004', 'Ollie only note.');
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('90000000-0000-0000-0000-000000000001', 'INV-1001', 'c0000000-0000-0000-0000-000000000001', current_date - 7, current_date,
   'sent', '[{"description":"IB 1:1 — Sami Ahmed","quantity":1,"unitPrice":450}]', 0.05),
  ('90000000-0000-0000-0000-000000000002', 'INV-1002', 'c0000000-0000-0000-0000-000000000002', current_date - 7, current_date,
   'sent', '[{"description":"IB 1:1 — Ollie Other","quantity":1,"unitPrice":450}]', 0.05);
insert into public.charges (lesson_id, student_id, family_id, description, amount, status, invoice_id, date) values
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'IB 1:1 — Sami Ahmed', 450, 'invoiced', '90000000-0000-0000-0000-000000000001', now() - interval '7 days');
insert into public.payments (invoice_id, amount, method, reference) values ('90000000-0000-0000-0000-000000000001', 200, 'bank-transfer', 'TT-1');
insert into public.packages (family_id, name, lessons_total, price) values ('c0000000-0000-0000-0000-000000000001', 'Ten lessons', 10, 4000);
insert into public.homework (id, student_id, lesson_id, title, due_date, attachments) values
  ('70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Vectors sheet', current_date + 3,
   '[{"kind":"file","name":"Brief.pdf","path":"students/d0000000-0000-0000-0000-000000000001/brief.pdf"},
     {"kind":"file","name":"Shared.pdf","path":"resources/shared.pdf"}]');
insert into public.homework_submissions (homework_id, student_id, submitted_by, submitted_by_name, note, files) values
  ('70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000d', 'Sami Ahmed', 'Done',
   '[{"kind":"file","name":"Answer.pdf","path":"students/d0000000-0000-0000-0000-000000000001/answer.pdf"}]');
insert into public.topic_ratings (student_id, topic_id, rating) values ('d0000000-0000-0000-0000-000000000001', 'vectors', 4);
insert into public.messages (family_id, sender_id, sender_name, sender_role, body) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000c', 'Mona Ahmed', 'parent', 'Hello from Mona'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000e', 'Otto Other', 'parent', 'Hello from Otto');
insert into public.enquiries (parent_name, email, phone, student_name, family_id) values
  ('Mona Ahmed', 'mona@x', '+971501112233', 'Sami', 'c0000000-0000-0000-0000-000000000001');
insert into public.family_billing (family_id, stripe_customer_id, autopay, card_brand, card_last4, card_expires) values
  ('c0000000-0000-0000-0000-000000000001', 'cus_mona', true, 'Visa', '4242', '04/29');
insert into public.availability (tutor_id, weekday, start_time, end_time) values ('b0000000-0000-0000-0000-000000000001', 0, '16:00', '19:00');
insert into public.tutor_absences (tutor_id, start_date, end_date) values ('b0000000-0000-0000-0000-000000000001', current_date + 30, current_date + 31);
insert into public.tutor_payment_details (tutor_id, account_name, bank_name, iban) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 'Emirates NBD', 'AE070331234567890123456');
insert into public.tutor_invoices (tutor_id, number, period_start, period_end, status, items) values
  ('b0000000-0000-0000-0000-000000000001', 'TI-0001', date_trunc('month', current_date)::date - interval '1 month',
   (date_trunc('month', current_date) - interval '1 day')::date, 'paid', '[{"description":"Lessons","quantity":4,"unitPrice":200}]');

-- Download my data ------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
create temp table export_parent as select public.export_my_data() as d;
select pg_temp.check((select d->>'format' = 'elite-education-export/1' and d->'family'->>'name' = 'Ahmed'
                             and d->'account'->>'email' = 'mona@x' from export_parent), 'a parent''s export holds their account and family');
select pg_temp.check((select jsonb_array_length(d->'students') = 2 from export_parent), 'a parent''s export holds all their children');
select pg_temp.check((select position('Ollie' in d::text) = 0 and position('Otto' in d::text) = 0 and position('INV-1002' in d::text) = 0
                        from export_parent), 'a parent''s export never holds another family''s data, even from a shared group lesson');
select pg_temp.check((select position('PRIVATE' in d::text) = 0 and position('Needs encouragement' in d::text) = 0 from export_parent),
  'a parent''s export never holds private tutor notes');
select pg_temp.check((select jsonb_array_length(d->'invoices') = 1 and jsonb_array_length(d->'payments') = 1
                             and jsonb_array_length(d->'lessons') = 3 and jsonb_array_length(d->'messages') = 1
                             and (d->'messages'->0->>'fromMe')::boolean and jsonb_array_length(d->'homework') = 1
                             and jsonb_array_length(d->'homeworkSubmissions') = 1 and d->'tutor' = 'null'::jsonb
                        from export_parent), 'a parent''s export holds lessons, invoices, payments, messages and homework');
select pg_temp.check((select position('cus_mona' in d::text) = 0 and position('ics_token' in d::text) = 0
                             and position('ExponentPushToken' in d::text) = 0 from export_parent), 'an export holds no secrets');

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select jsonb_array_length(d->'students') = 1 and d->'students'->0->>'fullName' = 'Sami Ahmed'
                             and jsonb_array_length(d->'invoices') = 0 and d->'family' = 'null'::jsonb and position('Lina' in d::text) = 0
                        from (select public.export_my_data() as d) x), 'a student''s export holds only their own record, no siblings or invoices');

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select d->'paymentDetails'->>'ibanLast4' = '3456' and position('AE070331234567890123456' in d::text) = 0
                             and d->'tutor'->>'fullName' = 'Tia One' and jsonb_array_length(d->'availability') = 1
                             and jsonb_array_length(d->'tutorInvoices') = 1 and jsonb_array_length(d->'lessons') = 3
                             and position('PRIVATE' in d::text) = 0
                        from (select public.export_my_data() as d) x), 'a tutor''s export holds their teaching record with a masked IBAN only');
reset role;

set role anon;
select pg_temp.as_user('');
do $$ begin
  perform public.export_my_data();
  raise exception 'anon exported data';
exception when insufficient_privilege then raise notice 'ok - someone not signed in cannot export data';
end $$;
reset role;

-- Who may close accounts --------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.begin_account_deletion('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c');
  raise exception 'parent began deletion directly';
exception when insufficient_privilege then raise notice 'ok - a signed-in user cannot call begin_account_deletion';
end $$;
do $$ begin
  perform public.perform_account_deletion(gen_random_uuid(), 'a0000000-0000-0000-0000-00000000000c');
  raise exception 'parent performed deletion directly';
exception when insufficient_privilege then raise notice 'ok - a signed-in user cannot call perform_account_deletion';
end $$;
do $$ begin
  perform public.admin_record_deletion_request(p_family_id => 'c0000000-0000-0000-0000-000000000002');
  raise exception 'parent recorded a deletion';
exception when insufficient_privilege then raise notice 'ok - a parent cannot record a deletion request';
end $$;
do $$ begin
  insert into public.deletion_requests (target_kind, label) values ('family', 'x');
  raise exception 'parent wrote deletion_requests';
exception when insufficient_privilege then raise notice 'ok - nobody writes deletion requests directly';
end $$;
reset role;

-- A parent closes their account -------------------------------------------------
-- Lesson details that must not outlive the account: a home address and link on Sami's past lesson, a past group lesson
-- of Sami and Ollie with notes and attendance, and an opportunity written about Sami.
update public.lessons set address = 'Villa 12, Emirates Hills', meeting_url = 'https://meet.example/sami'
 where id = 'f0000000-0000-0000-0000-000000000001';
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, address, status) values
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000003}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'in-person',
   'Villa 12, Emirates Hills', 'completed');
insert into public.lesson_notes (lesson_id, summary, attendance) values
  ('f0000000-0000-0000-0000-000000000005', 'Group work on titrations.',
   '{"d0000000-0000-0000-0000-000000000001":"present","d0000000-0000-0000-0000-000000000003":"late"}');
insert into public.opportunities (id, title, description, student_id, location, pay_rate) values
  ('60000000-0000-0000-0000-000000000001', 'IB Maths AA SL', 'Sami needs help before his mocks.', 'd0000000-0000-0000-0000-000000000001',
   'Emirates Hills', 200);

create temp table totals as
  select (select count(*) from public.invoices) as invoices, (select sum(public.invoice_total(i)) from public.invoices i) as invoiced,
         (select count(*) from public.charges) as charges, (select sum(amount) from public.charges) as charged,
         (select count(*) from public.payments) as payments, (select sum(amount) from public.payments) as paid,
         (select count(*) from public.packages) as packages;
create temp table ids (k text primary key, id uuid);
grant all on ids to service_role, authenticated;
set role service_role;
insert into ids values ('parent', public.begin_account_deletion('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c'));
create temp table parent_summary as
  select public.perform_account_deletion((select id from ids where k = 'parent'), 'a0000000-0000-0000-0000-00000000000c') as s;
reset role;

select pg_temp.check((select (invoices, invoiced, charges, charged, payments, paid, packages) =
                             ((select count(*) from public.invoices), (select sum(public.invoice_total(i)) from public.invoices i),
                              (select count(*) from public.charges), (select sum(amount) from public.charges),
                              (select count(*) from public.payments), (select sum(amount) from public.payments),
                              (select count(*) from public.packages)) from totals),
  'invoices, charges, payments and packages are kept with the same totals');
select pg_temp.check((select email = 'deleted-c0000000@deleted.invalid' and phone is null and parent_name = 'Ahmed' and name = 'Ahmed'
                             and deleted_at is not null and status = 'archived'
                        from public.families where id = 'c0000000-0000-0000-0000-000000000001'),
  'the family email is a placeholder, the phone is removed and the surname stays as the bill-to name');
select pg_temp.check((select bool_and(full_name = 'Former student' and school is null and year_group is null and current_grade is null
                                      and target_grade is null and deleted_at is not null)
                        from public.students where family_id = 'c0000000-0000-0000-0000-000000000001'), 'both children are anonymised');
select pg_temp.check((select full_name = 'Ollie Other' and deleted_at is null from public.students where id = 'd0000000-0000-0000-0000-000000000003'),
  'another family''s child is untouched');
select pg_temp.check((select status = 'cancelled' and cancel_reason = 'Account closed' and cancelled_at is not null
                        from public.lessons where id = 'f0000000-0000-0000-0000-000000000002'), 'upcoming lessons are cancelled with reason Account closed');
select pg_temp.check((select status = 'scheduled' and student_ids = '{d0000000-0000-0000-0000-000000000003}'
                        from public.lessons where id = 'f0000000-0000-0000-0000-000000000003'), 'the child is removed from an upcoming group lesson');
select pg_temp.check((select status = 'completed' from public.lessons where id = 'f0000000-0000-0000-0000-000000000001'), 'past lessons are kept');
select pg_temp.check((select bool_and(address is null and meeting_url is null) from public.lessons
                        where student_ids && '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000002}'
                           or id in ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000005')),
  'no lesson the children were in keeps a home address or meeting link');
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000002' and status = 'completed'
                             and student_ids = '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000003}'
                        from public.lessons where id = 'f0000000-0000-0000-0000-000000000005'), 'a past group lesson keeps its date, tutor and status');
select pg_temp.check(not exists (select 1 from public.lesson_notes where lesson_id = 'f0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.lesson_private_notes where lesson_id = 'f0000000-0000-0000-0000-000000000001'),
  'notes and private notes on the family''s own lessons are deleted');
select pg_temp.check((select attendance = '{"d0000000-0000-0000-0000-000000000003":"late"}' and summary = 'Group work on titrations.'
                        from public.lesson_notes where lesson_id = 'f0000000-0000-0000-0000-000000000005'),
  'in a group lesson only the child''s attendance is removed');
select pg_temp.check((select summary = 'Ollie only note.' from public.lesson_notes where lesson_id = 'f0000000-0000-0000-0000-000000000004'),
  'another family''s lesson notes are untouched');
select pg_temp.check((select status = 'closed' and student_id is null and description is null and location is null
                        from public.opportunities where id = '60000000-0000-0000-0000-000000000001'),
  'an opportunity written about the child is closed and its details cleared');
select pg_temp.check(not exists (select 1 from public.student_notes where student_id = 'd0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.homework where student_id = 'd0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.homework_submissions where student_id = 'd0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.topic_ratings where student_id = 'd0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.enrolments where student_id = 'd0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.messages where family_id = 'c0000000-0000-0000-0000-000000000001'),
  'notes, homework, hand-ins, ratings, subjects and messages are deleted');
select pg_temp.check((select count(*) = 1 from public.messages where family_id = 'c0000000-0000-0000-0000-000000000002'),
  'another family''s messages are untouched');
select pg_temp.check((select autopay = false and card_last4 is null and card_brand is null and stripe_customer_id is null
                        from public.family_billing where family_id = 'c0000000-0000-0000-0000-000000000001'),
  'the saved card summary is removed and the Stripe customer cleared when no card payment needs it');
select pg_temp.check((select parent_name = 'Former family' and email is null and phone is null and student_name is null from public.enquiries),
  'the family''s enquiry is anonymised');
select pg_temp.check((select phone is null and not whatsapp_opt_in and whatsapp_number is null and push_token is null
                        from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'), 'the login''s contact details and tokens are cleared');
select pg_temp.check((select status = 'completed' and completed_at is not null and label = 'Parent account (closed)'
                             and (summary->>'studentsAnonymised')::int = 2 and (summary->>'futureLessonsCancelled')::int = 1
                             and (summary->>'invoicesRetained')::int = 1 and (summary->>'paymentsRetained')::int = 1
                             and (summary->>'familyAnonymised')::boolean and summary->>'role' = 'parent'
                        from public.deletion_requests where id = (select id from ids where k = 'parent')),
  'the deletion request is completed with its summary');
select pg_temp.check((select s->'storagePaths' @> '["classwork/students/d0000000-0000-0000-0000-000000000001/brief.pdf",
                                                   "classwork/students/d0000000-0000-0000-0000-000000000001/answer.pdf"]'
                             and not (s->'storagePaths' @> '["classwork/resources/shared.pdf"]')
                             and s->'linkedProfileIds' = '["a0000000-0000-0000-0000-00000000000d"]'
                             and s->>'profileId' = 'a0000000-0000-0000-0000-00000000000c'
                        from parent_summary), 'the summary lists the child''s files (never shared library files) and the child''s login');
select pg_temp.check(not exists (select 1 from public.notification_outbox
                                  where profile_id in ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000d')
                                     or lower(email) = 'mona@x'), 'notifications for the family are removed');
select pg_temp.check((select count(*) = 2 and count(distinct profile_id) = 2
                             and bool_and(profile_id in ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000aa'))
                             and bool_and(url = '/manage/deletion-requests')
                        from public.notification_outbox where subject = 'An account has been closed'), 'each admin is told once');
select pg_temp.check((select bool_and(position('Ahmed' in body) = 0 and position('Sami' in body) = 0 and position('Lina' in body) = 0
                                      and position('Mona' in body) = 0 and position('mona@x' in body) = 0 and position('+971' in body) = 0
                                      and position('Parent account' in body) > 0)
                        from public.notification_outbox where subject = 'An account has been closed'),
  'the admin notice holds no names or contact details');
select pg_temp.check((select (summary->>'invoicesRetained') is not null from public.deletion_requests where id = (select id from ids where k = 'parent'))
  , 'retained counts are recorded');

-- Admins see deletion requests; nobody else does.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) = 0 from public.deletion_requests), 'a parent cannot see deletion requests');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) = 0 from public.deletion_requests), 'a tutor cannot see deletion requests');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 1 from public.deletion_requests), 'an admin sees deletion requests');

-- The office records a tutor's request ---------------------------------------------
insert into ids values ('tutor', public.admin_record_deletion_request(p_profile_id => 'a0000000-0000-0000-0000-0000000000b1', p_reason => 'Moving abroad'));
select pg_temp.check((select label = 'Tutor (Tia One)' and status = 'pending' and target_kind = 'profile' and role = 'tutor'
                        from public.deletion_requests where id = (select id from ids where k = 'tutor')), 'a pending request is labelled for the office');
select pg_temp.check((select public.admin_record_deletion_request(p_profile_id => 'a0000000-0000-0000-0000-0000000000b1') = (select id from ids where k = 'tutor')),
  'recording the same request twice returns the waiting one');
insert into ids values ('other', public.admin_record_deletion_request(p_family_id => 'c0000000-0000-0000-0000-000000000002'));
select public.admin_cancel_deletion_request((select id from ids where k = 'other'));
select pg_temp.check((select status = 'cancelled' from public.deletion_requests where id = (select id from ids where k = 'other')),
  'an admin can cancel a waiting request');
do $$ begin
  perform public.admin_record_deletion_request(p_family_id => 'c0000000-0000-0000-0000-000000000002', p_tutor_id => 'b0000000-0000-0000-0000-000000000002');
  raise exception 'two targets accepted';
exception when raise_exception then
  if sqlerrm <> 'Please choose exactly one account to close.' then raise; end if;
  raise notice 'ok - a request names exactly one account';
end $$;
reset role;

set role service_role;
create temp table tutor_summary as
  select public.perform_account_deletion((select id from ids where k = 'tutor'), 'a0000000-0000-0000-0000-00000000000a') as s;
reset role;
select pg_temp.check((select full_name = 'Former tutor' and email = 'deleted-b0000000@deleted.invalid' and phone is null
                             and subjects = '{Maths}' and deleted_at is not null
                        from public.tutors where id = 'b0000000-0000-0000-0000-000000000001'), 'the tutor record is anonymised, subjects kept');
select pg_temp.check((select count(*) = 1 from public.tutor_invoices where tutor_id = 'b0000000-0000-0000-0000-000000000001'),
  'tutor invoices are kept');
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000001' and status = 'completed'
                        from public.lessons where id = 'f0000000-0000-0000-0000-000000000001'), 'past lessons keep their tutor');
select pg_temp.check(not exists (select 1 from public.tutor_payment_details where tutor_id = 'b0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.availability where tutor_id = 'b0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.tutor_absences where tutor_id = 'b0000000-0000-0000-0000-000000000001'),
  'bank details, availability and absences are deleted');
select pg_temp.check((select (s->>'upcomingLessonsNeedingTutor')::int = 1 and s->>'role' = 'tutor' from tutor_summary),
  'upcoming lessons are counted for reassignment');
select pg_temp.check((select status = 'scheduled' from public.lessons where id = 'f0000000-0000-0000-0000-000000000004'),
  'the tutor''s upcoming lessons are not cancelled');
select pg_temp.check((select label = 'Tutor (closed)' and reason = 'Moving abroad' and status = 'completed'
                        from public.deletion_requests where id = (select id from ids where k = 'tutor')), 'the tutor request is completed');

-- Failure is recorded for a retry
set role service_role;
insert into ids values ('bea', public.begin_account_deletion('a0000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-0000000000aa'));
select public.fail_account_deletion((select id from ids where k = 'bea'), 'Auth user could not be deleted for bea@example.com');
reset role;
select pg_temp.check((select status = 'failed' and error = 'Auth user could not be deleted for [email]'
                        from public.deletion_requests where id = (select id from ids where k = 'bea')), 'a failure is recorded without personal details');

-- The last administrator ---------------------------------------------------------------
set role service_role;
select public.perform_account_deletion((select id from ids where k = 'bea'), 'a0000000-0000-0000-0000-0000000000aa');
reset role;
delete from auth.users where id = 'a0000000-0000-0000-0000-0000000000aa'; -- what the Edge Function does next
set role service_role;
do $$ begin
  perform public.begin_account_deletion('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a');
  raise exception 'deleted the last admin';
exception when raise_exception then
  if sqlerrm <> 'You are the only administrator. Please appoint another administrator before deleting this account.' then raise; end if;
  raise notice 'ok - the only administrator cannot close their account';
end $$;
reset role;

-- Closed accounts cannot be booked ------------------------------------------------------
do $$ begin
  insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location)
  values ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000003}', 'e0000000-0000-0000-0000-000000000001',
          now() + interval '9 days', now() + interval '9 days' + interval '1 hour', 'online');
  raise exception 'booked a closed tutor';
exception when raise_exception then
  if sqlerrm <> 'This tutor''s account has been closed. Please choose another tutor.' then raise; end if;
  raise notice 'ok - a lesson cannot be booked with a closed tutor';
end $$;
do $$ begin
  insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location)
  values ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
          now() + interval '9 days', now() + interval '9 days' + interval '1 hour', 'online');
  raise exception 'booked a closed student';
exception when raise_exception then
  if sqlerrm <> 'This student''s account has been closed and cannot be booked.' then raise; end if;
  raise notice 'ok - a lesson cannot be booked for a closed student';
end $$;
update public.lessons set tutor_id = 'b0000000-0000-0000-0000-000000000002' where id = 'f0000000-0000-0000-0000-000000000004';
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000002' from public.lessons where id = 'f0000000-0000-0000-0000-000000000004'),
  'a closed tutor''s upcoming lesson can be given to another tutor');
