-- Roles & bids, hiring, bank details, tutor invoices, student reports and expenses.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200), ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'), ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'other@x');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-sl'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'IB', 'ib-aa-sl');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto', 'other@x', null, 'c0000000-0000-0000-0000-000000000002');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
-- Tia taught Sami twice last month (one 90 minutes) and once this month; Tom taught Ollie once last month.
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location, status)
select tutor, students, 'e0000000-0000-0000-0000-000000000001', s, s + dur, 'online', st from (values
  ('b0000000-0000-0000-0000-000000000001'::uuid, '{d0000000-0000-0000-0000-000000000001}'::uuid[], date_trunc('month', now()) - interval '20 days', interval '60 minutes', 'completed'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}', date_trunc('month', now()) - interval '13 days', interval '90 minutes', 'completed'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}', date_trunc('month', now()) - interval '6 days', interval '60 minutes', 'cancelled'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}', date_trunc('month', now()) + interval '1 day', interval '60 minutes', 'completed'),
  ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000002}', date_trunc('month', now()) - interval '10 days', interval '60 minutes', 'completed')
) v(tutor, students, s, dur, st);

set role authenticated;

-- Roles & bidding ------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.opportunities (id, title, description, curriculum, schedule, pay_rate, visibility)
values ('f0000000-0000-0000-0000-000000000001', 'Year 12 IB AA HL', 'Strong student aiming for a 7', 'IB', 'Tuesdays 5pm', 220, 'all');
insert into public.opportunities (id, title, pay_rate, visibility, invited_tutor_ids)
values ('f0000000-0000-0000-0000-000000000002', 'Invite-only IGCSE', 200, 'invited', '{b0000000-0000-0000-0000-000000000002}');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'New student opportunity: Year 12%') = 2, 'all tutors are told about an open role');
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'New student opportunity: Invite-only%') = 1, 'only invited tutors hear about invite-only roles');
set role authenticated;

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.opportunities) = 1, 'tutors only see roles open to them');
select public.place_bid('f0000000-0000-0000-0000-000000000001', 'I teach AA HL and have three 7s this year.', 'Tuesdays after 4');
do $$ begin
  perform public.place_bid('f0000000-0000-0000-0000-000000000002', 'please', null);
  raise exception 'bid on invite-only';
exception when raise_exception then
  if sqlerrm = 'bid on invite-only' then raise; end if;
  raise notice 'ok - cannot bid on a role you were not invited to';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.place_bid('f0000000-0000-0000-0000-000000000001', 'Happy to take this on.', null);
select pg_temp.check((select count(*) from public.opportunity_bids) = 1, 'tutors only see their own bids');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.opportunities) = 0, 'parents cannot see roles');
do $$ begin
  perform public.place_bid('f0000000-0000-0000-0000-000000000001', 'x', null);
  raise exception 'parent bid';
exception when insufficient_privilege then raise notice 'ok - parents cannot bid';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.award_opportunity((select id from public.opportunity_bids limit 1));
  raise exception 'tutor awarded';
exception when insufficient_privilege then raise notice 'ok - only admins award roles';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.opportunity_bids where opportunity_id = 'f0000000-0000-0000-0000-000000000001') = 2, 'admin sees every bid');
select public.award_opportunity(id) from public.opportunity_bids where tutor_id = 'b0000000-0000-0000-0000-000000000001';
select pg_temp.check((select status || '/' || awarded_tutor_id from public.opportunities where id = 'f0000000-0000-0000-0000-000000000001')
  = 'awarded/b0000000-0000-0000-0000-000000000001', 'awarding marks the role filled');
select pg_temp.check((select status from public.opportunity_bids where tutor_id = 'b0000000-0000-0000-0000-000000000002') = 'declined', 'other bids are declined');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.opportunities) = 2, 'tutors keep seeing roles they bid on, plus open ones');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.place_bid('f0000000-0000-0000-0000-000000000001', 'again', null);
  raise exception 'bid after award';
exception when raise_exception then
  if sqlerrm = 'bid after award' then raise; end if;
  raise notice 'ok - no bids once a role is filled';
end $$;

-- Bank details ---------------------------------------------------------------
insert into public.tutor_payment_details (tutor_id, account_name, bank_name, iban, swift)
values ('b0000000-0000-0000-0000-000000000001', 'Tia One', 'Emirates NBD', 'AE070331234567890123456', 'EBILAEAD');
do $$ begin
  insert into public.tutor_payment_details (tutor_id, account_name, bank_name, iban)
  values ('b0000000-0000-0000-0000-000000000002', 'Not me', 'Bank', 'AE070331234567890123456');
  raise exception 'wrote another tutor''s bank details';
exception when insufficient_privilege then raise notice 'ok - tutors cannot set another tutor''s bank details';
end $$;
do $$ begin
  update public.tutor_payment_details set iban = 'not an iban' where tutor_id = 'b0000000-0000-0000-0000-000000000001';
  raise exception 'bad iban accepted';
exception when check_violation then raise notice 'ok - IBAN format is checked';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.tutor_payment_details) = 0, 'tutors cannot read other tutors'' bank details');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.tutor_payment_details) = 0, 'parents cannot read bank details');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.tutor_payment_details) = 1, 'admin reads bank details');

-- Tutor invoices -------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
create temp table ti (id uuid);
grant all on ti to authenticated;
insert into ti select public.create_tutor_invoice('b0000000-0000-0000-0000-000000000001', (date_trunc('month', now()) - interval '1 month')::date);
select pg_temp.check((select jsonb_array_length(items) from public.tutor_invoices) = 2, 'invoice lists last month''s taught lessons only');
select pg_temp.check((select public.tutor_invoice_total(t) from public.tutor_invoices t) = 500, 'paid by the hour (1h + 1.5h at 200)');
select public.update_tutor_invoice((select id from ti), '[{"description":"Mock marking","quantity":2,"unitPrice":150}]', 'Thanks!');
select pg_temp.check((select public.tutor_invoice_total(t) from public.tutor_invoices t) = 800, 'extra lines are added');
-- Rebuilding keeps extras and doesn't double-claim lessons.
select public.create_tutor_invoice('b0000000-0000-0000-0000-000000000001', (date_trunc('month', now()) - interval '1 month')::date);
select pg_temp.check((select public.tutor_invoice_total(t) from public.tutor_invoices t) = 800, 'rebuilding keeps extras without duplicating lessons');
do $$ begin
  perform public.create_tutor_invoice('b0000000-0000-0000-0000-000000000002', (date_trunc('month', now()) - interval '1 month')::date);
  raise exception 'invoiced as another tutor';
exception when insufficient_privilege then raise notice 'ok - tutors only invoice for themselves';
end $$;
select public.submit_tutor_invoice((select id from ti));
do $$ begin
  perform public.update_tutor_invoice((select id from ti), '[]', null);
  raise exception 'edited after submit';
exception when raise_exception then
  if sqlerrm = 'edited after submit' then raise; end if;
  raise notice 'ok - submitted invoices are locked';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.tutor_invoices) = 0, 'tutors cannot see each other''s invoices');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.review_tutor_invoice((select id from ti), false, 'Please split the marking by student');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select status from public.tutor_invoices) = 'rejected', 'admin can send an invoice back');
select public.submit_tutor_invoice((select id from ti));
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.mark_tutor_invoice_paid((select id from ti), 'x');
  raise exception 'paid before approval';
exception when raise_exception then
  if sqlerrm = 'paid before approval' then raise; end if;
  raise notice 'ok - invoices must be approved before payment';
end $$;
select public.review_tutor_invoice((select id from ti), true);
select public.mark_tutor_invoice_paid((select id from ti), 'FT26100512');
select pg_temp.check((select status || '/' || payment_reference from public.tutor_invoices) = 'paid/FT26100512', 'admin marks the invoice paid');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'Payment sent:%' and profile_id = 'a0000000-0000-0000-0000-0000000000b1') = 1,
  'the tutor is told they''ve been paid');
select pg_temp.check(not exists (select 1 from public.notification_outbox where body like '%AE0703312345%'), 'bank details never appear in notifications');
set role authenticated;

-- Student reports ------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.open_report_cycle('Term 1', (date_trunc('month', now()) - interval '2 months')::date, (now() + interval '14 days')::date);
select pg_temp.check((select count(*) from public.student_reports) = 2, 'one report per taught student');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.student_reports) = 1, 'tutors only see their own students'' reports');
do $$ begin
  perform public.submit_report((select id from public.student_reports));
  raise exception 'submitted empty';
exception when raise_exception then
  if sqlerrm = 'submitted empty' then raise; end if;
  raise notice 'ok - reports need effort, progress and a comment';
end $$;
select public.save_report((select id from public.student_reports), '6', 4::smallint, 5::smallint, 'Calculus', 'Vectors', 'A great term.', true);
select public.submit_report((select id from public.student_reports));
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.student_reports) = 0, 'parents cannot see unpublished reports');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_report_status(id, 'published') from public.student_reports where tutor_id = 'b0000000-0000-0000-0000-000000000001';
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select comment from public.student_reports) = 'A great term.', 'parents read their child''s published report');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.student_reports) = 0, 'other families cannot see it');
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox where subject like 'Term 1 report for Sami%' and profile_id = 'a0000000-0000-0000-0000-00000000000c'),
  'the family is told when a report is published');
set role authenticated;

-- Expenses -------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.expenses (date, category, amount) values (current_date, 'Software', 99);
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.expenses) = 0, 'tutors cannot see expenses');

-- Hiring ---------------------------------------------------------------------
reset role;
set role anon;
select pg_temp.as_user('');
select public.submit_tutor_application('Nina New', 'nina@x', '050', '{IB,IGCSE}', 'Maths', '5 years at a British school', 'PGCE', 'Evenings');
do $$ begin
  perform count(*) from public.tutor_applications;
  raise exception 'anon read applications';
exception when insufficient_privilege then raise notice 'ok - the public cannot read applications';
end $$;
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox where email = 'nina@x'), 'applicant gets a confirmation email');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.tutor_applications) = 0, 'tutors cannot see applications');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.tutor_applications) = 1, 'admin sees applications');
reset role;
\echo 'All operations tests passed'
