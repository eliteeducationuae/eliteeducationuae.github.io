-- Saved cards, autopay and lesson top-ups. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto Other', 'other@x', null, 'c0000000-0000-0000-0000-000000000002');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
update public.settings set vat_rate = 0.05, bank_details = 'IBAN AE07 0331 2345 6789 0123 456';

-- Stripe customers (normally linked by the Edge Functions with the service role).
select public.link_stripe_customer('c0000000-0000-0000-0000-000000000001', 'cus_mum');
select public.link_stripe_customer('c0000000-0000-0000-0000-000000000001', 'cus_replaced');
select pg_temp.check((select stripe_customer_id from public.family_billing where family_id = 'c0000000-0000-0000-0000-000000000001') = 'cus_mum',
  'link_stripe_customer never replaces a linked customer');
select public.link_stripe_customer('c0000000-0000-0000-0000-000000000002', 'cus_other');

-- Who sees billing details ----------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.family_billing) = 1
  and (select family_id from public.family_billing) = 'c0000000-0000-0000-0000-000000000001', 'a parent sees only their own family billing');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.family_billing where family_id = 'c0000000-0000-0000-0000-000000000001') = 0,
  'another parent cannot see the family billing');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.family_billing) = 0, 'a tutor sees no billing details');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.family_billing) = 2, 'an admin sees all billing details');

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
update public.family_billing set autopay = true, card_last4 = '0000' where family_id = 'c0000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.check((select not autopay and card_last4 is null from public.family_billing where family_id = 'c0000000-0000-0000-0000-000000000001'),
  'a parent cannot update family billing directly');
set role authenticated;
do $$ begin
  insert into public.family_billing (family_id, autopay) values ('c0000000-0000-0000-0000-000000000002', true)
  on conflict (family_id) do update set autopay = true;
  raise exception 'parent wrote billing';
exception when insufficient_privilege then raise notice 'ok - a parent cannot insert family billing';
end $$;

-- set_autopay -----------------------------------------------------------------
do $$ begin
  perform public.set_autopay('c0000000-0000-0000-0000-000000000001', true);
  raise exception 'autopay without a card';
exception when raise_exception then
  if sqlerrm <> 'Save a card first: pay an invoice or buy lessons by card and it will be kept securely for next time.' then raise; end if;
  raise notice 'ok - autopay cannot be switched on without a saved card';
end $$;
select public.set_autopay('c0000000-0000-0000-0000-000000000001', false);
select pg_temp.check(true, 'autopay can be switched off without a card');
do $$ begin
  perform public.set_autopay('c0000000-0000-0000-0000-000000000002', false);
  raise exception 'changed another family';
exception when insufficient_privilege then
  if sqlerrm <> 'Only the family or an admin can change autopay' then raise; end if;
  raise notice 'ok - a parent cannot change another family''s autopay';
end $$;
reset role;
select public.set_family_card('cus_mum', 'Visa', '4242', '04/29');
set role authenticated;
select public.set_autopay('c0000000-0000-0000-0000-000000000001', true);
select pg_temp.check((select autopay and card_brand = 'Visa' and card_expires = '04/29' from public.family_billing), 'a parent switches on autopay for their own family');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.set_autopay('c0000000-0000-0000-0000-000000000001', false);
  raise exception 'tutor changed autopay';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot change autopay';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_autopay('c0000000-0000-0000-0000-000000000002', false);
select pg_temp.check((select not autopay from public.family_billing where family_id = 'c0000000-0000-0000-0000-000000000002'), 'an admin can set autopay');
set role anon;
do $$ begin
  perform public.set_autopay('c0000000-0000-0000-0000-000000000001', false);
  raise exception 'anon changed autopay';
exception when insufficient_privilege then raise notice 'ok - the public cannot call set_autopay';
end $$;
reset role;

-- Package offers ----------------------------------------------------------------
insert into public.package_offers (id, name, service_id, lessons, price, sort) values
  ('f1000000-0000-0000-0000-000000000001', 'Ten IB lessons', 'e0000000-0000-0000-0000-000000000001', 10, 4000, 1);
insert into public.package_offers (id, name, lessons, price, active) values
  ('f1000000-0000-0000-0000-000000000002', 'Old bundle', 5, 2000, false);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select array_agg(name) from public.package_offers) = array['Ten IB lessons'], 'a parent sees only active offers');
do $$ begin
  insert into public.package_offers (name, lessons, price) values ('Free lessons', 10, 1);
  raise exception 'parent created an offer';
exception when insufficient_privilege then raise notice 'ok - a parent cannot create offers';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.package_offers (name, lessons, price) values ('Five lessons', 5, 2100);
select pg_temp.check((select count(*) from public.package_offers) = 3, 'an admin creates offers and sees inactive ones');
do $$ begin
  insert into public.package_offers (name, lessons, price) values ('  ', 5, 2100);
  raise exception 'blank offer';
exception when check_violation then raise notice 'ok - offers need a name';
end $$;
reset role;

-- Autopay is queued for sent invoices of autopay families with a card -------------
insert into public.invoices (id, number, family_id, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000001', 'INV-9001', 'c0000000-0000-0000-0000-000000000001', current_date + 7, 'sent',
   '[{"description":"IB 1:1","quantity":2,"unitPrice":450}]', 0.05),
  ('10000000-0000-0000-0000-000000000002', 'INV-9002', 'c0000000-0000-0000-0000-000000000001', current_date + 7, 'draft',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450}]', 0.05),
  ('10000000-0000-0000-0000-000000000003', 'INV-9003', 'c0000000-0000-0000-0000-000000000002', current_date + 7, 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450}]', 0.05);
select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000001') = 'pending',
  'a sent invoice for an autopay family is queued');
select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000002') is null,
  'a draft invoice is not queued');
select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000003') is null,
  'an invoice for a family without autopay is not queued');
update public.invoices set status = 'sent' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000002') = 'pending',
  'a draft that is sent later is queued');
update public.invoices set status = 'void' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000002') is null,
  'voiding an invoice cancels its autopay');
-- Autopay on but no card (cleared by Stripe): nothing is queued.
update public.family_billing set autopay = true where family_id = 'c0000000-0000-0000-0000-000000000002';
insert into public.invoices (id, number, family_id, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000004', 'INV-9004', 'c0000000-0000-0000-0000-000000000002', current_date + 7, 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450}]', 0.05);
select pg_temp.check((select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000004') is null,
  'an autopay family without a card is not queued');

-- From here on, no notification written by the payment functions may mention bank details.
create temp table outbox_before as select id from public.notification_outbox;

-- record_stripe_payment ---------------------------------------------------------
select public.record_stripe_payment('10000000-0000-0000-0000-000000000001', 945, 'pi_1', 'cs_1');
select public.record_stripe_payment('10000000-0000-0000-0000-000000000001', 945, 'pi_1', 'cs_1');
select public.record_stripe_payment('10000000-0000-0000-0000-000000000001', 945, 'pi_1');
select pg_temp.check((select count(*) from public.payments where invoice_id = '10000000-0000-0000-0000-000000000001') = 1,
  'record_stripe_payment records a payment once, whichever event reports it');
select pg_temp.check((select status || '/' || autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000001') = 'paid/succeeded',
  'the invoice is paid and its autopay succeeded');
select public.record_stripe_payment('10000000-0000-0000-0000-000000000003', 472.50, 'pi_3');
select pg_temp.check((select status from public.invoices where id = '10000000-0000-0000-0000-000000000003') = 'paid'
  and (select autopay_status from public.invoices where id = '10000000-0000-0000-0000-000000000003') is null,
  'a Checkout payment marks the invoice paid without touching autopay');

-- fulfil_package_offer --------------------------------------------------------------
create temp table topup (id uuid);
insert into topup select public.fulfil_package_offer('c0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 4200, 'pi_top', 'cs_top');
insert into topup select public.fulfil_package_offer('c0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 4200, 'pi_top');
select pg_temp.check((select count(distinct id) from topup) = 1, 'fulfil_package_offer returns the same invoice when repeated');
select pg_temp.check((select count(*) from public.packages where family_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select name || '/' || lessons_total || '/' || price || '/' || service_id from public.packages)
      = 'Ten IB lessons/10/4000.00/e0000000-0000-0000-0000-000000000001', 'one package is created from the offer');
select pg_temp.check((select count(*) from public.invoices i where i.id in (select id from topup) and i.status = 'paid'
  and i.items->0->>'description' = 'Ten IB lessons (10 lessons)' and i.vat_rate = 0.05
  and (i.items->0->>'packageId')::uuid = (select id from public.packages)) = 1, 'one paid receipt invoice is created');
select pg_temp.check((select count(*) from public.payments where stripe_payment_intent = 'pi_top' and amount = 4200
  and stripe_session_id = 'cs_top' and method = 'card') = 1, 'one card payment is recorded');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Thank you: 10 lessons added'
  and body = 'Your payment of AED 4,200.00 has been received and 10 lessons have been added to your account. Your receipt is in the Billing tab of the Elite Education app.'
  and url = '/parent/billing') = 1, 'the family is thanked once');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Lessons bought: Ahmed') = 1, 'the office is told once');
select pg_temp.check(not exists (select 1 from public.notification_outbox o where o.id not in (select id from outbox_before)
  and (o.subject like 'Invoice %' or o.push_title like 'New invoice%')), 'no "new invoice" message is sent for a top-up receipt');
do $$ begin
  perform public.fulfil_package_offer('c0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 2100, 'pi_old');
  raise exception 'sold an inactive offer';
exception when raise_exception then
  if sqlerrm = 'sold an inactive offer' then raise; end if;
  raise notice 'ok - an inactive offer cannot be fulfilled';
end $$;
do $$ begin
  perform public.fulfil_package_offer('c0000000-0000-0000-0000-000000000001', gen_random_uuid(), 2100, 'pi_missing');
  raise exception 'sold a missing offer';
exception when raise_exception then
  if sqlerrm = 'sold a missing offer' then raise; end if;
  raise notice 'ok - a missing offer cannot be fulfilled';
end $$;

-- autopay_failed -------------------------------------------------------------------
insert into public.invoices (id, number, family_id, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000005', 'INV-9005', 'c0000000-0000-0000-0000-000000000001', current_date + 7, 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":1000}]', 0.05);
-- Its "new invoice" message comes from the existing invoice trigger, not from the payment functions.
insert into outbox_before select id from public.notification_outbox where id not in (select id from outbox_before);
update public.invoices set autopay_status = 'processing', autopay_attempts = 1 where id = '10000000-0000-0000-0000-000000000005';
select public.autopay_failed('10000000-0000-0000-0000-000000000005', 'Your card has insufficient funds.');
select public.autopay_failed('10000000-0000-0000-0000-000000000005', 'Your card has expired.');
select pg_temp.check((select autopay_status || '/' || autopay_error from public.invoices where id = '10000000-0000-0000-0000-000000000005')
  = 'failed/Your card has expired.', 'autopay_failed keeps the latest reason');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'We could not take payment for invoice INV-9005'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 1, 'the family is told about a failed autopay once');
select pg_temp.check((select body from public.notification_outbox where subject = 'We could not take payment for invoice INV-9005')
  = 'We tried to take AED 1,050.00 for invoice INV-9005 using your saved card, but the payment did not go through: your card has insufficient funds. Please update your card with Manage cards in the Billing tab, or pay the invoice in the Elite Education app.',
  'the failed-autopay message is clear and complete');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Autopay failed: INV-9005 (Ahmed)') = 1,
  'the office is told about a failed autopay once');

select pg_temp.check(not exists (select 1 from public.notification_outbox o where o.id not in (select id from outbox_before)
  and (o.body ilike '%AE07%' or o.body ilike '%IBAN%' or o.body ilike '%bank transfer%' or o.body like '%pi\_%' or o.body like '%cus\_%')),
  'payment notifications never contain bank details or Stripe ids');

-- set_family_card --------------------------------------------------------------------
select public.set_family_card('cus_mum', null, null, null);
select pg_temp.check((select not autopay and card_brand is null and card_last4 is null and card_expires is null
  from public.family_billing where family_id = 'c0000000-0000-0000-0000-000000000001'), 'removing the last card switches autopay off');

-- Only the service role can move money ----------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$
declare f text;
begin
  foreach f in array array[
    'select public.record_stripe_payment(''10000000-0000-0000-0000-000000000005'', 1, ''pi_x'')',
    'select public.fulfil_package_offer(''c0000000-0000-0000-0000-000000000001'', ''f1000000-0000-0000-0000-000000000001'', 1, ''pi_y'')',
    'select public.autopay_failed(''10000000-0000-0000-0000-000000000005'', ''x'')',
    'select public.set_family_card(''cus_mum'', ''Visa'', ''1111'', ''01/30'')',
    'select public.link_stripe_customer(''c0000000-0000-0000-0000-000000000002'', ''cus_evil'')'] loop
    begin
      execute f;
      raise exception 'allowed: %', f;
    exception when insufficient_privilege then raise notice 'ok - signed-in users cannot run %', split_part(split_part(f, '(', 1), '.', 2);
    end;
  end loop;
end $$;
reset role;
\echo 'All payments tests passed'
