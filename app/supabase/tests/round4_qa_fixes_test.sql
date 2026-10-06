-- Final round 4 review: notification links, British dates on lesson charges, the private classwork bucket and the
-- office alert for a card payment that could not be recorded. Run after the migrations.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- Links: no function still points at a route the app does not have.
select pg_temp.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.prosrc like '%''/admin/%' or p.prosrc like '%/manage/tutor-invoice/%')),
  'no notification links to /admin/... or /manage/tutor-invoice/...');
select pg_temp.check((select prosrc from pg_proc where proname = 'request_lesson') like '%''/manage/requests''%',
  'lesson requests link to /manage/requests');
select pg_temp.check((select prosrc from pg_proc where proname = 'submit_enquiry') like '%''/manage/enquiries''%',
  'enquiries link to /manage/enquiries');
select pg_temp.check((select prosrc from pg_proc where proname = 'submit_tutor_invoice') like '%''/tutor-invoices/''%',
  'tutor invoices link to /tutor-invoices/<id>');

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-00000000000a', 'boss@x');
insert into public.profiles (id, role, full_name, email) values ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name) values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);

-- Charges: '17 Aug 2026', as everywhere else in the app.
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', array['d0000000-0000-0000-0000-000000000001'::uuid],
   'e0000000-0000-0000-0000-000000000001', '2026-08-17 10:00+04', '2026-08-17 11:00+04', 'online', 'completed');
select public.apply_charges('f0000000-0000-0000-0000-000000000001');
select pg_temp.check((select description from public.charges where lesson_id = 'f0000000-0000-0000-0000-000000000001')
  = 'IB 1:1 — Sami Ahmed, 17 Aug 2026', 'lesson charges use a British date');

-- The classwork bucket stays private with its limits.
select pg_temp.check((select not public and file_size_limit = 26214400 and 'application/pdf' = any (allowed_mime_types)
  from storage.buckets where id = 'classwork'), 'classwork bucket is private and limited');

-- Unrecorded card payments reach the office; only the webhook (service role) can raise one.
select pg_temp.check(not has_function_privilege('authenticated', 'public.alert_unrecorded_payment(text, text, numeric, text)', 'execute'),
  'signed-in users cannot raise a payment alert');
select pg_temp.check(not has_function_privilege('anon', 'public.alert_unrecorded_payment(text, text, numeric, text)', 'execute'),
  'the public cannot raise a payment alert');
select pg_temp.check(has_function_privilege('service_role', 'public.alert_unrecorded_payment(text, text, numeric, text)', 'execute'),
  'the webhook can raise a payment alert');
update public.settings set bank_details = 'IBAN AE07 0331 2345 6789 0123 456';
select public.alert_unrecorded_payment('invoice-paid', 'pi_123', 1250.5, 'insert or update on table "payments" violates foreign key constraint');
select pg_temp.check((select count(*) from public.notification_outbox
   where profile_id = 'a0000000-0000-0000-0000-00000000000a' and subject = 'Card payment needs reconciling'
     and body like '%AED 1,250.50 for an invoice%' and body like '%pi_123%' and url = '/manage/money') = 1,
  'the office is told about the unrecorded payment');
select pg_temp.check(not exists (select 1 from public.notification_outbox where body like '%IBAN%' or body like '%AE07%'),
  'the payment alert never carries bank details');
