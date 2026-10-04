-- New-invoice notifications after payments and WhatsApp: autopay wording, never bank details, and the reminders that
-- follow (overdue chases held while autopay is charging, homework already handed in). Run after the migrations.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Admin; the Ahmed family (Mona, autopay with a Visa) with Sami; the Other family (Otto, no card) with Ollie.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x'),
  ('a0000000-0000-0000-0000-00000000000f', 'sami@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'Sixth Form and IB Diploma');
-- Each student's subjects (enrolments), with the tutor who teaches them.
insert into public.enrolments (student_id, subject, curriculum, level, exam_board, syllabus_id, tutor_id) values
  ('d0000000-0000-0000-0000-000000000001', 'Maths', 'IB DP', 'AA SL', 'IB', 'ib-aa-sl', 'b0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'Maths', 'IB DP', 'AA SL', 'IB', 'ib-aa-sl', null);
insert into public.profiles (id, role, full_name, email, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto Other', 'other@x', 'c0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-00000000000f', 'student', 'Sami Ahmed', 'sami@x', null, 'd0000000-0000-0000-0000-000000000001');
update public.settings set bank_details = 'Elite Education FZ LLC, IBAN AE07 0331 2345 6789 0123 456' where id = 1;

-- Both parents opt in to WhatsApp.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_whatsapp(true, '+971501234567');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select public.set_whatsapp(true, '+971501234568');
reset role;

-- Mona has a saved Visa and autopay on (as the Stripe functions and set_autopay would leave it).
select public.link_stripe_customer('c0000000-0000-0000-0000-000000000001', 'cus_mum');
select public.set_family_card('cus_mum', 'Visa', '4242', '08/29');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_autopay('c0000000-0000-0000-0000-000000000001', true);
reset role;

-- New invoices ------------------------------------------------------------------
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000001', 'INV-7001', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15', 'draft',
   '[{"description":"Lessons","quantity":2,"unitPrice":450}]'),
  ('10000000-0000-0000-0000-000000000002', 'INV-7002', 'c0000000-0000-0000-0000-000000000002', '2026-10-01', '2026-10-15', 'draft',
   '[{"description":"Lessons","quantity":1,"unitPrice":450}]');
update public.invoices set status = 'sent' where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000001') = 'pending',
  'the autopay family''s invoice waits for autopay');
select pg_temp.check((select count(*) from public.notification_outbox where not whatsapp and subject like 'Invoice INV-7001%') = 1
  and (select body from public.notification_outbox where not whatsapp and subject like 'Invoice INV-7001%')
    = 'A new invoice for AED 900.00 is ready in the Elite Education app. As autopay is on, it will be paid automatically from your saved Visa ending 4242. There is nothing you need to do; we will let you know if the payment does not go through.'
  and (select push_body from public.notification_outbox where not whatsapp and subject like 'Invoice INV-7001%')
    = 'AED 900.00 will be paid automatically from your Visa ending 4242',
  'an autopay family is told the invoice will be paid from their saved card (brand and last 4)');
select pg_temp.check(not exists (select 1 from public.notification_outbox
    where (subject like '%INV-7001%' or url = '/invoice/10000000-0000-0000-0000-000000000001')
      and (coalesce(body, '') ilike '%pay it%' or coalesce(push_body, '') ilike '%due%' or coalesce(body, '') ilike '%due by%')),
  'the autopay notice carries no due date or "pay it" call to action');
select pg_temp.check((select body from public.notification_outbox where not whatsapp and subject like 'Invoice INV-7002%')
    = 'A new invoice for AED 450.00 is due by 15 Oct 2026. You can view and pay it in the Elite Education app.',
  'a family without autopay is asked to pay in the app, without bank details');

select pg_temp.check((select count(*) from public.notification_outbox where whatsapp
    and profile_id = 'a0000000-0000-0000-0000-00000000000c' and whatsapp_template = 'invoice_autopay') = 1
  and not exists (select 1 from public.notification_outbox where whatsapp
    and profile_id = 'a0000000-0000-0000-0000-00000000000c' and whatsapp_template = 'invoice_sent')
  and (select body = 'Dear Mona, invoice INV-7001 for AED 900.00 is now available in the Elite Education app. As autopay is on, it will be paid automatically from your saved Visa ending 4242. Elite Education | eliteeducation.me'
      and whatsapp_vars->>'4' = 'Visa ending 4242' and subject = 'WhatsApp: invoice sent (autopay)'
    from public.notification_outbox where whatsapp and whatsapp_template = 'invoice_autopay'),
  'the autopay family''s WhatsApp uses the autopay template with the card');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp
    and profile_id = 'a0000000-0000-0000-0000-00000000000e' and whatsapp_template = 'invoice_sent') = 1,
  'other families get the usual invoice WhatsApp');
select pg_temp.check(public.whatsapp_template_body('invoice_autopay') like '%Elite Education | eliteeducation.me'
  and position('''' in public.whatsapp_template_body('invoice_autopay')) = 0,
  'the autopay template carries the footer and no apostrophes');

-- Autopay off: the next invoice is the ordinary one again.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_autopay('c0000000-0000-0000-0000-000000000001', false);
reset role;
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000003', 'INV-7003', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-20', 'sent',
   '[{"description":"Lessons","quantity":1,"unitPrice":450}]');
select pg_temp.check((select body from public.notification_outbox where not whatsapp and subject like 'Invoice INV-7003%')
    = 'A new invoice for AED 450.00 is due by 20 Oct 2026. You can view and pay it in the Elite Education app.'
  and (select count(*) from public.notification_outbox where whatsapp and url = '/invoice/10000000-0000-0000-0000-000000000003'
    and whatsapp_template = 'invoice_sent') = 1,
  'with autopay off the family is asked to pay as usual');

-- A held autopay WhatsApp is dropped once the invoice is paid.
update public.notification_outbox set whatsapp_status = 'pending' where whatsapp_template = 'invoice_autopay';
select public.record_stripe_payment('10000000-0000-0000-0000-000000000001', 900, 'pi_test_1', null, true);
select pg_temp.check((select whatsapp_status from public.notification_outbox where whatsapp_template = 'invoice_autopay') = 'skipped',
  'a held autopay notice is skipped once the invoice is paid');

-- Overdue chases wait while autopay is charging ---------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.set_autopay('c0000000-0000-0000-0000-000000000001', true);
reset role;
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000004', 'INV-7004', 'c0000000-0000-0000-0000-000000000001', '2026-09-20', '2026-10-01', 'sent',
   '[{"description":"Lessons","quantity":1,"unitPrice":450}]');
update public.invoices set autopay_status = 'processing' where id = '10000000-0000-0000-0000-000000000004';
-- 11:00 UAE time on 5 Oct.
select public.queue_whatsapp_reminders('2026-10-05T07:00:00Z');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp and whatsapp_template = 'invoice_overdue'
    and url = '/invoice/10000000-0000-0000-0000-000000000004')
  and (select overdue_whatsapp_at is null from public.invoices where id = '10000000-0000-0000-0000-000000000004'),
  'an overdue invoice is not chased while autopay is charging it');
update public.invoices set autopay_status = 'failed' where id = '10000000-0000-0000-0000-000000000004';
select public.queue_whatsapp_reminders('2026-10-05T07:00:00Z');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'invoice_overdue'
    and url = '/invoice/10000000-0000-0000-0000-000000000004') = 1,
  'once autopay has failed the overdue chase goes out');

-- Homework reminders with hand-ins -----------------------------------------------
insert into public.homework (id, student_id, title, due_date, details, tutor_id) values
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Vectors', '2026-10-07', 'Q1-5', 'b0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Handed in early', '2026-10-07', null, 'b0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'Ollie work', '2026-10-07', null, null);
insert into public.homework_submissions (homework_id, student_id, note)
  values ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Done');
-- 10:00 UAE time on 6 Oct: homework due 7 Oct.
select public.queue_whatsapp_reminders('2026-10-06T06:00:00Z');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_template = 'homework_due') = 2
  and exists (select 1 from public.notification_outbox where whatsapp and whatsapp_template = 'homework_due'
    and url = '/homework/f0000000-0000-0000-0000-000000000001'
    and body = 'Dear Mona, this is a reminder that Sami has homework due on Wed 7 Oct: Vectors. Elite Education | eliteeducation.me')
  and not exists (select 1 from public.notification_outbox where whatsapp and url = '/homework/f0000000-0000-0000-0000-000000000002'),
  'homework already handed in is not reminded, and the reminder links to the homework');

-- Never bank details --------------------------------------------------------------
select pg_temp.check(not exists (select 1 from public.notification_outbox
    where coalesce(body, '') || coalesce(push_body, '') || coalesce(subject, '') || coalesce(whatsapp_vars::text, '')
      ~* '(iban|AE07|bank transfer|FZ LLC)'),
  'no notification, email or WhatsApp carries bank details');
select pg_temp.check(position('bank_details' in pg_get_functiondef('public.on_invoice_sent()'::regprocedure)) = 0,
  'the new-invoice notification no longer reads the bank details');
