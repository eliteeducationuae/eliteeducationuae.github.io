-- Launch readiness after the round 5 merge: account deletion and "Download my data" reach every round 5 table, and
-- invoices, credit notes, payments and refunds are kept. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss and Bea are administrators. Tia (with a login) advises Sami and tutors him; Tom has no login.
-- Mona is the Ahmed parent; Books is the accountant.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000aa', 'bea@x'),
  ('a0000000-0000-0000-0000-0000000000b1', 'tia@x'), ('a0000000-0000-0000-0000-00000000000c', 'mona@x'),
  ('a0000000-0000-0000-0000-0000000000ac', 'books@x');
insert into public.tutors (id, full_name, email, subjects) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 'tia@x', '{Maths}'),
  ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 'tom@x', '{Maths}');
insert into public.families (id, name, parent_name, email, phone) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mona@x', '+971501112233');
insert into public.students (id, family_id, full_name, curriculum) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000aa', 'admin', 'Bea', 'bea@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 'tia@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mona@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000ac', 'accountant', 'Books', 'books@x', null, null);
insert into public.accountant_invites (email, full_name, accepted_at) values ('books@x', 'Books', now());
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'online', 'scheduled', 'Maths');

-- Money: an invoice, a payment, a credit note and a refund.
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('90000000-0000-0000-0000-000000000001', 'INV-1001', 'c0000000-0000-0000-0000-000000000001', current_date - 7, current_date,
   'sent', '[{"description":"IB 1:1 — Sami Ahmed","quantity":1,"unitPrice":450}]', 0.05);
insert into public.payments (id, invoice_id, amount, method, reference) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 472.5, 'bank-transfer', 'TT-1');
insert into public.credit_notes (id, number, invoice_id, family_id, reason, vat_rate, lines, subtotal, vat, total, customer) values
  ('92000000-0000-0000-0000-000000000001', 'CN-1001', '90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'Lesson cancelled by the tutor', 0.05, '[{"description":"IB 1:1 — Sami Ahmed","net":100,"vat":5}]', 100, 5, 105,
   '{"name":"Mona Ahmed","email":"mona@x"}');
insert into public.refunds (invoice_id, family_id, payment_id, amount, method, status, reason, request_key, credit_note_id) values
  ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001',
   105, 'bank-transfer', 'succeeded', 'Lesson cancelled by the tutor', 'rk-1', '92000000-0000-0000-0000-000000000001');

-- Rates: Sami's Maths with Tia, at an agreed price and pay.
insert into public.enrolments (id, student_id, subject, tutor_id) values
  ('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'b0000000-0000-0000-0000-000000000001');
insert into public.enrolment_family_price (enrolment_id, hourly_price) values ('e1000000-0000-0000-0000-000000000001', 480);
insert into public.enrolment_tutor_pay (enrolment_id, hourly_pay) values ('e1000000-0000-0000-0000-000000000001', 220);

-- Admissions advised by Tia: a shortlist, a key date, two ticked-off tasks, an update Tia wrote, and the timeline.
insert into public.admissions_cases (id, student_id, family_id, kind, title, status, adviser_tutor_id) values
  ('a1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'uk-university', 'UK universities 2027', 'active', 'b0000000-0000-0000-0000-000000000001');
insert into public.admissions_targets (case_id, institution, country) values
  ('a1000000-0000-0000-0000-000000000001', 'Imperial College London', 'United Kingdom');
insert into public.admissions_dates (case_id, kind, title, due_on) values
  ('a1000000-0000-0000-0000-000000000001', 'deadline', 'UCAS deadline', current_date + 60);
insert into public.admissions_tasks (case_id, title, owner, done_at, done_by_name) values
  ('a1000000-0000-0000-0000-000000000001', 'Draft personal statement', 'family', now(), 'Mona Ahmed'),
  ('a1000000-0000-0000-0000-000000000001', 'Book the TMUA', 'adviser', now(), 'Tia One');
insert into public.admissions_updates (case_id, kind, title, body, status, author_id, author_name, published_at) values
  ('a1000000-0000-0000-0000-000000000001', 'ad-hoc', 'Shortlist agreed', 'We agreed five choices.', 'published',
   'a0000000-0000-0000-0000-0000000000b1', 'Tia One', now());
insert into public.admissions_events (case_id, kind, title, family_visible) values
  ('a1000000-0000-0000-0000-000000000001', 'milestone', 'Shortlist agreed', true),
  ('a1000000-0000-0000-0000-000000000001', 'milestone', 'Office note: staff only', false);

-- Handover from Tia to Tom, a shared lesson plan, and a vetting override for Tia.
insert into public.handovers (reason, student_id, student_name, subject, from_tutor_id, to_tutor_id, note) values
  ('reassigned', 'd0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Maths', 'b0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'Sami is strong on vectors.');
insert into public.lesson_plans (lesson_id, tutor_id, objectives, homework, shared_with_family) values
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Revise vectors',
   '[{"title":"Everyone: sheet 1"},{"studentId":"d0000000-0000-0000-0000-000000000001","title":"Sami: sheet 2"},'
   '{"studentId":"d0000000-0000-0000-0000-000000000099","title":"Another child: sheet 3"}]', true);
insert into public.tutor_vetting_overrides (tutor_id, reason, expires_at, created_by, created_by_name) values
  ('b0000000-0000-0000-0000-000000000001', 'Police clearance renewal is in progress', now() + interval '14 days',
   'a0000000-0000-0000-0000-00000000000a', 'Boss');
insert into public.submission_log (kind, email, outcome) values
  ('application', 'tia@x', 'accepted'), ('application', 'tom@x', 'accepted'), ('enquiry', 'other@x', 'accepted');

-- 4. Download my data ---------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
create temp table parent_export as select public.export_my_data() as d;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
create temp table tutor_export as select public.export_my_data() as d;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000ac');
create temp table accountant_export as select public.export_my_data() as d;
reset role;

select pg_temp.check((select d->'admissions'->0->'shortlist'->0->>'institution' = 'Imperial College London'
                             and jsonb_array_length(d->'admissions'->0->'keyDates') = 1
                             and jsonb_array_length(d->'admissions'->0->'tasks') = 2
                             and jsonb_array_length(d->'admissions'->0->'updates') = 1
                        from parent_export), 'a parent''s download holds the admissions shortlist, key dates, tasks and updates');
select pg_temp.check((select not (d->'admissions'->0->'timeline')::text like '%staff only%'
                             and (d->'admissions'->0->'timeline')::text like '%Shortlist agreed%' from parent_export),
  'the admissions timeline in the download holds only what the family sees');
select pg_temp.check((select (d->'agreedPrices'->0->>'hourlyPrice')::numeric = 480 and d->'agreedPrices'->0->>'subject' = 'Maths'
                        from parent_export), 'a parent''s download holds the agreed hourly price');
select pg_temp.check((select jsonb_array_length(d->'lessonPlans') = 1
                             and jsonb_array_length(d->'lessonPlans'->0->'homework') = 2
                             and not (d->'lessonPlans')::text like '%Another child%' from parent_export),
  'a parent''s download holds shared lesson plans, without homework planned for other children');
select pg_temp.check((select jsonb_array_length(d->'tutorPay') = 0 and jsonb_array_length(d->'handovers') = 0
                             and jsonb_array_length(d->'vettingOverrides') = 0 and d->'accountantInvitation' = 'null'::jsonb
                             and jsonb_array_length(d->'creditNotes') = 1 and jsonb_array_length(d->'refunds') = 1
                        from parent_export), 'a parent''s download holds their credit notes and refunds but no tutor records');
select pg_temp.check((select (d->'tutorPay'->0->>'hourlyPay')::numeric = 220 and d->'handovers'->0->>'direction' = 'written'
                             and d->'handovers'->0->>'note' = 'Sami is strong on vectors.'
                             and (d->'lessonPlans'->0->>'sharedWithFamily')::boolean
                             and d->'vettingOverrides'->0->>'reason' = 'Police clearance renewal is in progress'
                             and jsonb_array_length(d->'agreedPrices') = 0 and jsonb_array_length(d->'admissions') = 0
                        from tutor_export), 'a tutor''s download holds their pay rates, handover packs, lesson plans and vetting overrides');
select pg_temp.check((select d->'accountantInvitation'->>'email' = 'books@x' from accountant_export),
  'an accountant''s download holds their invitation');

-- 2 and 3. Closing Tia's login: her name beside her actions, and her address in the spam log --------------------
set role service_role;
create temp table tia_del as
  select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-0000000000b1',
                                                                      'a0000000-0000-0000-0000-0000000000b1'), null) as s;
reset role;
select pg_temp.check((select done_by_name from public.admissions_tasks where title = 'Book the TMUA') = 'Former tutor'
  and (select done_by_name from public.admissions_tasks where title = 'Draft personal statement') = 'Mona Ahmed',
  'a closed adviser''s name leaves the tasks they ticked off, and the family''s stays');
select pg_temp.check((select author_name from public.admissions_updates where title = 'Shortlist agreed') = 'Former tutor',
  'a closed adviser''s name leaves the updates they wrote');
select pg_temp.check(not exists (select 1 from public.submission_log where email = 'tia@x')
  and exists (select 1 from public.submission_log where email = 'other@x'),
  'a closed tutor''s address leaves the spam submission log, and others stay');

-- A tutor without a login, closed by the office.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table tom_req as select public.admin_record_deletion_request(p_tutor_id => 'b0000000-0000-0000-0000-000000000002') as id;
reset role;
grant select on tom_req to service_role;
set role service_role;
select public.perform_account_deletion((select id from tom_req), 'a0000000-0000-0000-0000-00000000000a');
reset role;
select pg_temp.check(not exists (select 1 from public.submission_log where email = 'tom@x'),
  'a tutor without a login leaves the spam submission log when closed');

-- 1. Closing the family keeps invoices, credit notes, payments and refunds ----------------------
set role service_role;
create temp table fam_del as
  select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-00000000000c',
                                                                      'a0000000-0000-0000-0000-00000000000c'), null) as s;
reset role;
select pg_temp.check((select count(*) from public.invoices where family_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.payments where invoice_id = '90000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.credit_notes where family_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.refunds where family_id = 'c0000000-0000-0000-0000-000000000001') = 1,
  'invoices, credit notes, payments and refunds are kept');
select pg_temp.check((select (s->>'invoicesRetained')::int = 1 and (s->>'creditNotesRetained')::int = 1
                             and (s->>'paymentsRetained')::int = 1 and (s->>'refundsRetained')::int = 1 from fam_del),
  'the deletion summary counts the kept credit notes and refunds');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'An account has been closed'
                               and body like '%What was kept, for tax records: 1 invoice, 1 credit note, 1 payment and 1 refund.%'),
  'the administrators'' notice lists the kept credit notes and refunds');
select pg_temp.check(not exists (select 1 from public.admissions_cases where family_id = 'c0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.admissions_tasks where done_by_name = 'Mona Ahmed'),
  'the family''s admissions records go');
select pg_temp.check(public.deletion_kept_records('{"invoicesRetained": 2, "paymentsRetained": 0}') = '2 invoices and 0 payments'
  and public.deletion_kept_records('{"invoicesRetained": 2, "paymentsRetained": 3, "refundsRetained": 2}')
      = '2 invoices, 3 payments and 2 refunds',
  'the kept-records sentence names credit notes and refunds only when there are any');

-- 5. Migrations ledger ---------------------------------------------------------------------------
select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261113000800' and name = 'launch_fix')
  and (select count(*) from public.db_migrations) = :migration_count,
  'the ledger lists every migration file, including this fix');

\echo 'All launch fix tests passed'
