-- Row-level security and RPC tests. Run with: npm run test:db (needs a local Postgres 15+).
\set ON_ERROR_STOP on

-- Fixture data (as superuser).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x'),
  ('00000000-0000-0000-0000-00000000000b', 'tutor@x'),
  ('00000000-0000-0000-0000-00000000000c', 'parent@x'),
  ('00000000-0000-0000-0000-00000000000d', 'student@x'),
  ('00000000-0000-0000-0000-00000000000e', 'other-parent@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('10000000-0000-0000-0000-000000000001', 'Tutor One', 't1@x', 200),
  ('10000000-0000-0000-0000-000000000002', 'Tutor Two', 't2@x', 200);
insert into public.families (id, name, parent_name, email) values
  ('20000000-0000-0000-0000-000000000001', 'Fam A', 'Parent A', 'a@x'),
  ('20000000-0000-0000-0000-000000000002', 'Fam B', 'Parent B', 'b@x');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Kid A', 'IB', 'ib-aa-hl'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Kid B', 'IGCSE', 'igcse-4ma1');
insert into public.student_notes values ('30000000-0000-0000-0000-000000000001', 'secret');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Admin', 'admin@x', null, null, null),
  ('00000000-0000-0000-0000-00000000000b', 'tutor', 'Tutor One', 'tutor@x', '10000000-0000-0000-0000-000000000001', null, null),
  ('00000000-0000-0000-0000-00000000000c', 'parent', 'Parent A', 'parent@x', null, '20000000-0000-0000-0000-000000000001', null),
  ('00000000-0000-0000-0000-00000000000d', 'student', 'Kid A', 'student@x', null, null, '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000000e', 'parent', 'Parent B', 'other-parent@x', null, '20000000-0000-0000-0000-000000000002', null);
insert into public.services (id, name, duration_min, rate) values
  ('40000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '{30000000-0000-0000-0000-000000000001}', '40000000-0000-0000-0000-000000000001', now() - interval '2 hours', now() - interval '1 hour', 'online'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '{30000000-0000-0000-0000-000000000002}', '40000000-0000-0000-0000-000000000001', now() + interval '3 hours', now() + interval '4 hours', 'online'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '{30000000-0000-0000-0000-000000000001}', '40000000-0000-0000-0000-000000000001', now() + interval '5 hours', now() + interval '6 hours', 'online'),
  ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '{30000000-0000-0000-0000-000000000001}', '40000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 1 hour', 'online');
insert into public.packages (id, family_id, name, lessons_total, lessons_used, price) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'B pack', 5, 0, 2000);

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- Tutor: completes their own lesson.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from public.lessons) = 3, 'tutor sees only own lessons');
select pg_temp.check((select count(*) from public.students) = 1, 'tutor sees only own students');
select pg_temp.check((select count(*) from public.student_notes) = 1, 'tutor reads student notes');
select pg_temp.check((select count(*) from public.invoices) = 0, 'tutor sees no invoices');
select public.complete_lesson('50000000-0000-0000-0000-000000000001', 'completed', '{}', 'Vectors', 'private!', '{ib-aa:x}',
  '[{"studentId":"30000000-0000-0000-0000-000000000001","topicId":"ib-aa:x","rating":4}]',
  '[{"studentId":"30000000-0000-0000-0000-000000000001","title":"Ex 4B","dueDate":"2030-01-01"}]');
do $$ begin
  perform public.complete_lesson('50000000-0000-0000-0000-000000000002', 'completed', '{}', '', null, '{}', '[]', '[]');
  raise exception 'tutor completed another tutor''s lesson';
exception when insufficient_privilege then raise notice 'ok - tutor cannot complete another tutor''s lesson';
end $$;
do $$ begin
  insert into public.charges (lesson_id, student_id, family_id, description, amount, date)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'x', 0, now());
  raise exception 'tutor wrote a charge';
exception when insufficient_privilege then raise notice 'ok - tutor cannot write charges';
end $$;

-- Parent A: sees own family only, no private notes, can cancel (late → charged).
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from public.students) = 1, 'parent sees own child only');
select pg_temp.check((select count(*) from public.lessons) = 3, 'parent sees own child''s lessons only');
select pg_temp.check((select count(*) from public.lesson_notes) = 1, 'parent reads lesson notes');
select pg_temp.check((select count(*) from public.lesson_private_notes) = 0, 'parent cannot read private notes');
select pg_temp.check((select count(*) from public.student_notes) = 0, 'parent cannot read tutor notes on student');
select pg_temp.check((select count(*) from public.charges) = 1 and (select amount from public.charges) = 450, 'completion created a 450 charge');
select pg_temp.check((select count(*) from public.packages) = 0, 'parent cannot see other family packages');
select pg_temp.check((public.cancel_lesson('50000000-0000-0000-0000-000000000003', 'clash') ->> 'status') = 'late-cancel', 'late cancel is charged');
select pg_temp.check((public.cancel_lesson('50000000-0000-0000-0000-000000000004', 'holiday') ->> 'status') = 'cancelled', 'early cancel is free');
select pg_temp.check((select count(*) from public.charges) = 2, 'late cancel added a charge');
do $$ begin
  perform public.cancel_lesson('50000000-0000-0000-0000-000000000002', 'not mine');
  raise exception 'parent cancelled someone else''s lesson';
exception when raise_exception then
  if sqlerrm like 'parent cancelled%' then raise; end if;
  raise notice 'ok - parent cannot cancel another family''s lesson';
end $$;
do $$ begin
  perform public.invoice_unbilled('20000000-0000-0000-0000-000000000001');
  raise exception 'parent created an invoice';
exception when insufficient_privilege then raise notice 'ok - parent cannot invoice';
end $$;
update public.lessons set status = 'scheduled' where id = '50000000-0000-0000-0000-000000000004';
select pg_temp.check((select status from public.lessons where id = '50000000-0000-0000-0000-000000000004') = 'cancelled', 'parent cannot update lessons directly');

-- Student: sees self, can tick homework, cannot cancel.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from public.homework) = 1, 'student sees own homework');
select public.set_homework_done((select id from public.homework limit 1), true);
select pg_temp.check((select done from public.homework limit 1), 'student ticks homework');
select pg_temp.check((select count(*) from public.invoices) = 0, 'student sees no invoices');

-- Admin: invoices unbilled charges; payment marks paid.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((public.invoice_unbilled('20000000-0000-0000-0000-000000000001')).number = 'INV-1001', 'admin invoices unbilled charges');
select pg_temp.check(public.invoice_total(i) = 900, 'invoice total') from public.invoices i;
insert into public.payments (invoice_id, amount, method) select id, 900, 'bank-transfer' from public.invoices;
select pg_temp.check((select status from public.invoices) = 'paid', 'full payment marks invoice paid');
select pg_temp.check((select count(*) from public.charges where status = 'unbilled') = 0, 'charges marked invoiced');

-- Package credits are drawn before invoicing.
select pg_temp.check((public.sell_package('20000000-0000-0000-0000-000000000001', 'A pack', null, 5, 2000)).number = 'INV-1002', 'admin sells a package');
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '{30000000-0000-0000-0000-000000000001}', '40000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '23 hours', 'online');
select public.complete_lesson('50000000-0000-0000-0000-000000000005', 'completed', '{}', 'x', null, '{}', '[]', '[]');
select pg_temp.check((select lessons_used from public.packages where name = 'A pack') = 1, 'package credit drawn');
select pg_temp.check((select status from public.charges where lesson_id = '50000000-0000-0000-0000-000000000005') = 'package', 'charge covered by package');

-- Other parent sees nothing of family A.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.check((select count(*) from public.invoices) = 0, 'other parent sees no family A invoices');
select pg_temp.check((select count(*) from public.packages) = 1, 'other parent sees own package');

reset role;
\echo 'All database tests passed'
