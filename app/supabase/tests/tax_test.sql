-- UAE tax invoices, credit notes, refunds and accountant access. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
/** Runs a statement and checks it fails with the given message (and, if given, SQLSTATE). */
create function pg_temp.raises(stmt text, message text, label text, state text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if (message is null or sqlerrm = message) and (state is null or sqlstate = state) then
      raise notice 'ok - %', label;
      return;
    end if;
    raise exception 'FAILED: % (got % %)', label, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', label;
end $$;

-- Admin, tutor, two families (Mona Ahmed with Sami; Otto Other) and an accountant.
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x', now()),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor@x', now()),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x', now()),
  ('a0000000-0000-0000-0000-00000000000d', 'books@x', now()),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x', now());
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma');
delete from public.profiles;
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000d', 'accountant', 'Bea Books', 'books@x', null, null),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto Other', 'other@x', null, 'c0000000-0000-0000-0000-000000000002');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
update public.settings set vat_rate = 0.05, business_name = 'Elite Education', legal_name = 'Elite Education FZ LLC',
  trn = '100123456700003', registered_address = 'Office 1, Dubai, UAE', notify_email = 'office@x',
  bank_details = 'IBAN AE07 0331 2345 6789 0123 456';
insert into public.family_billing (family_id, trn, billing_address) values
  ('c0000000-0000-0000-0000-000000000001', '100999888777666', 'Villa 2, Dubai');
select pg_temp.raises($$update public.family_billing set trn = '12345' where family_id = 'c0000000-0000-0000-0000-000000000001'$$,
  null, 'a family TRN must have 15 digits', '23514');
select pg_temp.raises($$update public.settings set trn = 'TRN100123456700' where id = 1$$, null, 'the business TRN must have 15 digits', '23514');

-- Two lessons taught to Sami, each charged at AED 450, on 20 and 27 September.
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', '2026-09-20 16:00+04', '2026-09-20 17:00+04', 'online', 'completed'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', '2026-09-27 23:30+04', '2026-09-28 00:30+04', 'online', 'completed');
insert into public.charges (id, lesson_id, student_id, family_id, description, amount, status, date) values
  ('c1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'IB 1:1 — Sami Ahmed, 2026-09-20', 450, 'unbilled', '2026-09-20 16:00+04'),
  ('c1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'IB 1:1 — Sami Ahmed, 2026-09-27', 450, 'unbilled', '2026-09-27 23:30+04');

-- Numbering ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table made (key text primary key, id uuid);
insert into made select 'unbilled', (public.invoice_unbilled('c0000000-0000-0000-0000-000000000001')).id;
insert into made select 'package', (public.sell_package('c0000000-0000-0000-0000-000000000002', 'Ten lessons', null, 10, 4000)).id;
select pg_temp.check((select array_agg(number order by number) from public.invoices) = array['INV-1001', 'INV-1002'],
  'invoice_unbilled and sell_package number invoices INV-1001, INV-1002');
do $$ begin
  perform public.sell_package('c0000000-0000-0000-0000-000000000002', 'Five lessons', null, 5, 2000);
  raise exception 'something else failed';
exception when raise_exception then null;
end $$;
insert into made select 'package2', (public.sell_package('c0000000-0000-0000-0000-000000000002', 'Five lessons', null, 5, 2000)).id;
select pg_temp.check((select number from public.invoices where id = (select id from made where key = 'package2')) = 'INV-1003',
  'an invoice whose creation failed leaves no gap in the numbers');
select pg_temp.raises($$insert into public.invoices (number, family_id, due_date, status) values ('INV-5555', 'c0000000-0000-0000-0000-000000000001', current_date, 'sent')$$,
  null, 'an admin cannot insert an invoice directly', '42501');
select pg_temp.raises($$delete from public.invoices where number = 'INV-1003'$$, null, 'an admin cannot delete an invoice', '42501');
reset role;
select pg_temp.raises($$delete from public.invoices where number = 'INV-1003'$$,
  'Invoices are kept for tax records. Cancel it with a credit note instead.', 'deleting an invoice raises, whoever asks');
select pg_temp.raises($$update public.invoices set items = '[{"description":"Cheaper","quantity":1,"unitPrice":1}]' where number = 'INV-1001'$$,
  'An issued tax invoice cannot be changed. Issue a credit note instead.', 'the items of a sent invoice cannot be changed');
select pg_temp.raises($$update public.invoices set number = 'INV-0001' where number = 'INV-1001'$$,
  'An issued tax invoice cannot be changed. Issue a credit note instead.', 'the number of a sent invoice cannot be changed');
select pg_temp.raises($$update public.invoices set vat_rate = 0 where number = 'INV-1001'$$,
  'An issued tax invoice cannot be changed. Issue a credit note instead.', 'the VAT rate of a sent invoice cannot be changed');
select pg_temp.raises($$update public.invoices set status = 'draft' where number = 'INV-1001'$$,
  'An issued tax invoice cannot be returned to draft. Issue a credit note instead.', 'a sent invoice cannot go back to draft');
update public.invoices set due_date = due_date + 7, notes = 'Thank you' where number = 'INV-1001';
select pg_temp.check(true, 'the due date and notes of a sent invoice can still be changed');
select pg_temp.raises($$update public.settings set next_invoice_number = 2000 where id = 1$$,
  'Invoice numbers run in sequence and cannot be changed once invoices have been issued.',
  'the next invoice number cannot be changed once invoices exist');

-- Snapshot ----------------------------------------------------------------------
select pg_temp.check((select supplier = '{"name":"Elite Education FZ LLC","address":"Office 1, Dubai, UAE","trn":"100123456700003","email":"office@x"}'::jsonb
    and customer = '{"name":"Mona Ahmed","address":"Villa 2, Dubai","trn":"100999888777666","email":"mum@x"}'::jsonb
    and supply_date = '2026-09-27' from public.invoices where number = 'INV-1001'),
  'issuing an invoice records the supplier and customer TRNs and addresses and the date of supply');
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000001', 'INV-9001', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'draft',
   '[{"description":"Lesson A","quantity":1,"unitPrice":333.33},{"description":"Lesson B","quantity":1,"unitPrice":333.33},{"description":"Lesson C","quantity":1,"unitPrice":333.33}]', 0.05);
select pg_temp.check((select supplier is null and supply_date is null from public.invoices where number = 'INV-9001'), 'a draft has no snapshot yet');
update public.invoices set status = 'sent' where number = 'INV-9001';
select pg_temp.check((select supplier->>'trn' = '100123456700003' and customer->>'trn' = '100999888777666'
    and supply_date = '2026-10-01' from public.invoices where number = 'INV-9001'),
  'sending a draft fills the supplier, customer and (without lessons) the issue date as the date of supply');
update public.settings set legal_name = 'Renamed LLC', trn = '100000000000001', registered_address = 'Elsewhere' where id = 1;
update public.family_billing set trn = '100000000000002', billing_address = 'New villa' where family_id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.check((select supplier->>'name' = 'Elite Education FZ LLC' and supplier->>'trn' = '100123456700003'
    and customer->>'address' = 'Villa 2, Dubai' from public.invoices where number = 'INV-9001'),
  'changing the settings or the family''s details afterwards does not change an issued invoice');
update public.settings set legal_name = 'Elite Education FZ LLC', trn = '100123456700003', registered_address = 'Office 1, Dubai, UAE' where id = 1;
-- A company that pays: its name, not the parent's, is the customer named beside its TRN.
insert into public.family_billing (family_id, billing_name, trn, billing_address) values
  ('c0000000-0000-0000-0000-000000000002', '  Other Trading LLC ', '100000000000004', 'PO Box 1, Dubai');
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000010', 'INV-9010', 'c0000000-0000-0000-0000-000000000002', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":100}]', 0.05);
select pg_temp.check((select customer = '{"name":"Other Trading LLC","address":"PO Box 1, Dubai","trn":"100000000000004","email":"other@x"}'::jsonb
    from public.invoices where number = 'INV-9010'),
  'a company-paid tax invoice names the company (billing name) as the customer with its TRN');
update public.family_billing set billing_name = '   ' where family_id = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.check(public._tax_customer('c0000000-0000-0000-0000-000000000002')->>'name' = 'Otto Other'
    and public._tax_customer('c0000000-0000-0000-0000-000000000001')->>'name' = 'Mona Ahmed',
  'without a billing name the parent''s name is used');
select pg_temp.check((select customer->>'name' from public.invoices where number = 'INV-9010') = 'Other Trading LLC',
  'clearing the billing name afterwards does not change the issued invoice');

-- VAT maths: three lines of 333.33 at 5% -------------------------------------------
select pg_temp.check((select public.invoice_total(i) = 1049.99 from public.invoices i where number = 'INV-9001'), 'the invoice total is AED 1,049.99');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into made select 'cn1', (public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Lesson A was not delivered',
  '[{"invoiceLine":0,"net":333.33}]')).id;
select pg_temp.check((select number = 'CN-0001' and subtotal = 333.33 and vat = 16.67 and total = 350.00 and not rebilled
    and supplier->>'trn' = '100123456700003' and customer->>'trn' = '100999888777666'
    from public.credit_notes where id = (select id from made where key = 'cn1')),
  'crediting line 1 (AED 333.33) gives VAT 16.67 and a total of AED 350.00, numbered CN-0001');
select pg_temp.check((select public.invoice_balance(i) = 699.99 and public.invoice_credited(i) = 350 and status = 'sent'
    from public.invoices i where number = 'INV-9001'), 'the balance after the credit note is AED 699.99');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Again', '[{"invoiceLine":0,"net":0.01}]')$$,
  'Line 1 has only AED 0.00 left to credit.', 'a line cannot be credited beyond its amount');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Too much', '[{"invoiceLine":null,"net":700}]')$$,
  'Only AED 666.66 is left to credit on this invoice.', 'an invoice cannot be credited beyond its total');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Zero', '[{"invoiceLine":1,"net":0}]')$$,
  'Enter an amount to credit.', 'a credit of zero is refused');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Negative', '[{"invoiceLine":1,"net":-5}]')$$,
  'Enter an amount to credit.', 'a negative credit is refused');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Nothing', '[]')$$,
  'Enter an amount to credit.', 'a credit note with no lines is refused');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', '  ', '[{"invoiceLine":1,"net":5}]')$$,
  'Please give a reason for the credit note.', 'a credit note needs a reason');
insert into made select 'cn2', (public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Lessons B and C cancelled',
  '[{"invoiceLine":1,"net":333.33},{"invoiceLine":2,"net":333.33}]')).id;
select pg_temp.check((select number = 'CN-0002' and subtotal = 666.66 and vat = 33.33 and total = 699.99
    and (lines->0->>'vat')::numeric = 16.66 and (lines->1->>'vat')::numeric = 16.67
    from public.credit_notes where id = (select id from made where key = 'cn2')),
  'crediting the rest gives VAT 33.33 (line VATs 16.66 and 16.67) and a total of AED 699.99');
select pg_temp.check((select sum(total) from public.credit_notes where invoice_id = '10000000-0000-0000-0000-000000000001') = 1049.99,
  'the two credit notes add up to the invoice total exactly');
select pg_temp.check((select status from public.invoices where number = 'INV-9001') = 'void', 'a fully credited invoice is cancelled');
select pg_temp.check((select count(*) from public.credit_notes where invoice_id = '10000000-0000-0000-0000-000000000001') = 2,
  'cancelling by full credit does not add a closing credit note');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'More', '[{"invoiceLine":0,"net":1}]')$$,
  'This invoice has already been cancelled.', 'a cancelled invoice takes no more credit notes');

-- Credit notes on the lesson invoice INV-1001 (two lessons at 450): release, keep, and who may issue them.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.raises(format($$select public.issue_credit_note(%L, 'Mine', '[{"invoiceLine":0,"net":10}]')$$, (select id from made where key = 'unbilled')),
  'Admins only', 'a parent cannot issue a credit note', '42501');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.raises(format($$select public.issue_credit_note(%L, 'Mine', '[{"invoiceLine":0,"net":10}]')$$, (select id from made where key = 'unbilled')),
  'Admins only', 'a tutor cannot issue a credit note', '42501');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.raises(format($$select public.issue_credit_note(%L, 'Mine', '[{"invoiceLine":0,"net":10}]')$$, (select id from made where key = 'unbilled')),
  'Admins only', 'the accountant cannot issue a credit note', '42501');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.issue_credit_note((select id from made where key = 'unbilled'), 'Wrong date: to be invoiced again',
  '[{"invoiceLine":0,"net":450}]', true);
select pg_temp.check((select status = 'unbilled' and invoice_id is null from public.charges where id = 'c1000000-0000-0000-0000-000000000001')
  and (select status = 'invoiced' from public.charges where id = 'c1000000-0000-0000-0000-000000000002')
  and (select rebilled and total = 472.50 from public.credit_notes where number = 'CN-0003'),
  'a credit note that releases charges puts the fully credited lesson back to be invoiced');
select public.issue_credit_note((select id from made where key = 'unbilled'), 'Goodwill', '[{"invoiceLine":1,"net":450}]');
select pg_temp.check((select status from public.invoices where number = 'INV-1001') = 'void'
  and (select status = 'invoiced' and invoice_id = (select id from made where key = 'unbilled') from public.charges
       where id = 'c1000000-0000-0000-0000-000000000002'),
  'a full credit without release cancels the invoice and keeps its lessons billed');
reset role;
select pg_temp.raises($$update public.credit_notes set total = 1 where number = 'CN-0001'$$,
  'Credit notes are permanent tax records and cannot be changed or deleted.', 'a credit note cannot be changed');
select pg_temp.raises($$delete from public.credit_notes where number = 'CN-0001'$$,
  'Credit notes are permanent tax records and cannot be changed or deleted.', 'a credit note cannot be deleted');
select pg_temp.raises($$update public.settings set next_credit_note_number = 50 where id = 1$$,
  'Credit note numbers run in sequence and cannot be changed once credit notes have been issued.',
  'the next credit note number cannot be changed once credit notes exist');

-- Cancelling a sent invoice directly issues a closing credit note.
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000002', 'INV-9002', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":200,"chargeId":"c1000000-0000-0000-0000-000000000001"}]', 0.05),
  ('10000000-0000-0000-0000-000000000003', 'INV-9003', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'draft',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":1000}]', 0.05);
update public.charges set status = 'invoiced', invoice_id = '10000000-0000-0000-0000-000000000002' where id = 'c1000000-0000-0000-0000-000000000001';
insert into public.payments (invoice_id, amount, method, reference) values ('10000000-0000-0000-0000-000000000002', 50, 'bank-transfer', 'TT 1');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000003', 'Draft', '[{"invoiceLine":0,"net":1}]')$$,
  'Draft invoices can be edited; only issued invoices take credit notes.', 'a draft invoice takes no credit notes');
update public.invoices set status = 'void' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) = 1 and min(reason) = 'Invoice cancelled' and min(total) = 210 and bool_and(rebilled)
    from public.credit_notes where invoice_id = '10000000-0000-0000-0000-000000000002')
  and (select status = 'unbilled' from public.charges where id = 'c1000000-0000-0000-0000-000000000001'),
  'cancelling a sent invoice issues an ''Invoice cancelled'' credit note and releases its lessons as before');
select pg_temp.check((select public.invoice_balance(i) = -50 from public.invoices i where id = '10000000-0000-0000-0000-000000000002'),
  'the cancelled invoice shows the AED 50 the family paid as owed back to them');
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'Invoice INV-9002 has been cancelled'
  and profile_id = 'a0000000-0000-0000-0000-00000000000c'), 'a family who had paid is told the invoice was cancelled');
select pg_temp.raises($$update public.invoices set status = 'sent' where id = '10000000-0000-0000-0000-000000000002'$$,
  'A cancelled invoice cannot be reopened.', 'a cancelled invoice cannot be reopened');

-- A partial credit that covers what is left to pay marks the invoice paid.
update public.invoices set status = 'sent' where id = '10000000-0000-0000-0000-000000000003';
insert into public.payments (invoice_id, amount, method, reference) values ('10000000-0000-0000-0000-000000000003', 1000, 'bank-transfer', 'TT 2');
select pg_temp.check((select status = 'sent' and public.invoice_balance(i) = 50 from public.invoices i where id = '10000000-0000-0000-0000-000000000003'),
  'a part-paid invoice stays sent with AED 50 to pay');
set role authenticated;
select public.issue_credit_note('10000000-0000-0000-0000-000000000003', 'Agreed discount', '[{"invoiceLine":0,"net":47.62}]');
reset role;
select pg_temp.check((select status = 'paid' and public.invoice_balance(i) = 0 from public.invoices i where id = '10000000-0000-0000-0000-000000000003'),
  'a credit note covering the rest of the balance marks the invoice paid');
select pg_temp.check((select array_agg(number order by created_at, number) from public.credit_notes)
  = array['CN-0001', 'CN-0002', 'CN-0003', 'CN-0004', 'CN-0005', 'CN-0006'], 'credit notes are numbered CN-0001 onwards in order');

-- 'An amount': a credit for a gross amount totals exactly that amount (sending only the net was a fils out).
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000011', 'INV-9011', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":1000}]', 0.05);
set role authenticated;
insert into made select 'g1', (public.issue_credit_note('10000000-0000-0000-0000-000000000011', 'Goodwill', '[]', true, 10.18)).id;
insert into made select 'g2', (public.issue_credit_note('10000000-0000-0000-0000-000000000011', 'Shorter lesson', null, false, 105.10)).id;
select pg_temp.check((select subtotal = 9.70 and vat = 0.48 and total = 10.18 and not rebilled
    and lines = '[{"description":"Credit: Goodwill","invoiceLine":null,"net":9.70,"vat":0.48}]'::jsonb
    and issue_date = (now() at time zone 'Asia/Dubai')::date
    from public.credit_notes where id = (select id from made where key = 'g1'))
  and (select subtotal = 100.10 and vat = 5.00 and total = 105.10 from public.credit_notes where id = (select id from made where key = 'g2')),
  'credits of AED 10.18 and 105.10 including VAT total exactly that, are never rebilled and are dated in Dubai');
select pg_temp.raises($$select public.issue_credit_note('10000000-0000-0000-0000-000000000011', 'Too much', '[]', false, 1000)$$,
  'Only AED 934.72 is left to credit on this invoice.', 'a gross credit cannot exceed what is left');

-- 'Invoice these lessons again' with a partial line credit releases nothing, so the note is not rebilled.
reset role;
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000012', 'INV-9012', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450,"chargeId":"c1000000-0000-0000-0000-000000000001"},{"description":"Notes","quantity":1,"unitPrice":50}]', 0.05);
update public.charges set status = 'invoiced', invoice_id = '10000000-0000-0000-0000-000000000012' where id = 'c1000000-0000-0000-0000-000000000001';
set role authenticated;
insert into made select 'p1', (public.issue_credit_note('10000000-0000-0000-0000-000000000012', 'Lesson cut short',
  '[{"invoiceLine":0,"net":100},{"invoiceLine":1,"net":50}]', true)).id;
select pg_temp.check((select not rebilled and total = 157.50 from public.credit_notes where id = (select id from made where key = 'p1'))
  and (select status = 'invoiced' and invoice_id = '10000000-0000-0000-0000-000000000012' from public.charges
       where id = 'c1000000-0000-0000-0000-000000000001'),
  'a partial credit of a lesson line with release on releases nothing and is not marked rebilled');
insert into made select 'p2', (public.issue_credit_note('10000000-0000-0000-0000-000000000012', 'Re-invoice the lesson',
  '[{"invoiceLine":0,"net":350}]', true)).id;
select pg_temp.check((select rebilled from public.credit_notes where id = (select id from made where key = 'p2'))
  and (select status = 'unbilled' and invoice_id is null from public.charges where id = 'c1000000-0000-0000-0000-000000000001')
  and (select status from public.invoices where number = 'INV-9012') = 'void',
  'crediting the rest of the line releases its lesson and only then marks the note rebilled');
reset role;

-- Refunds -----------------------------------------------------------------------
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000004', 'INV-9004', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":1000}]', 0.05),
  ('10000000-0000-0000-0000-000000000005', 'INV-9005', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":500}]', 0);
insert into public.payments (id, invoice_id, amount, method, reference, stripe_payment_intent) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 1050, 'card', 'pi_p', 'pi_p'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 600, 'bank-transfer', 'TT 3', null);
select pg_temp.check((select count(*) from public.invoices where number in ('INV-9004', 'INV-9005') and status = 'paid') = 2,
  'card and bank payments mark the invoices paid');
create temp table outbox_mark as select id from public.notification_outbox;
set role authenticated;
select pg_temp.raises($$select public.begin_card_refund('20000000-0000-0000-0000-000000000001', 100, 'Goodwill', false, 'k0')$$,
  'Issue a credit note with this refund, or refund no more than the AED 0.00 the family has overpaid.',
  'a paid invoice cannot be refunded without a credit note beyond any overpayment');
select pg_temp.raises($$select public.begin_card_refund('20000000-0000-0000-0000-000000000002', 10, 'Goodwill', false, 'k0')$$,
  'This payment was not taken by card through Stripe; record the refund manually.', 'only Stripe card payments are refunded by card');
select pg_temp.raises($$select public.begin_card_refund('20000000-0000-0000-0000-000000000001', 1100, 'Too much', true, 'k0')$$,
  'Only AED 1,050.00 of this payment can still be refunded.', 'a refund cannot exceed the payment');
insert into made select 'r1', (public.begin_card_refund('20000000-0000-0000-0000-000000000001', 100, 'Lesson cancelled late', true, 'k1')).id;
insert into made select 'r1again', (public.begin_card_refund('20000000-0000-0000-0000-000000000001', 100, 'Lesson cancelled late', true, 'k1')).id;
select pg_temp.check((select count(distinct id) from made where key in ('r1', 'r1again')) = 1
  and (select count(*) from public.refunds where request_key = 'k1') = 1
  and (select count(*) from public.credit_notes where invoice_id = '10000000-0000-0000-0000-000000000004') = 1,
  'starting the same refund twice returns the same refund and makes one credit note');
select pg_temp.check((select status = 'pending' and method = 'card' and credit_note_id is not null from public.refunds where request_key = 'k1')
  and (select subtotal = 95.24 and vat = 4.76 and total = 100 and lines->0->>'invoiceLine' is null from public.credit_notes
       where id = (select credit_note_id from public.refunds where request_key = 'k1')),
  'a card refund with a credit note starts pending and links a credit note for AED 95.24 plus 4.76 VAT');
select pg_temp.raises($$select public.begin_card_refund('20000000-0000-0000-0000-000000000001', 90, 'Lesson cancelled late', true, 'k1')$$,
  'This refund request was already used for a different amount.', 'a request key cannot be reused for another amount');
select pg_temp.raises($$select public.begin_card_refund('20000000-0000-0000-0000-000000000001', 1000, 'Everything', true, 'k9')$$,
  'Only AED 950.00 of this payment can still be refunded.', 'a pending refund counts against what can still be refunded');
select pg_temp.check((select public.invoice_balance(i) = 0 and status = 'paid' from public.invoices i where number = 'INV-9004'),
  'a refund with its credit note leaves the invoice paid with nothing owed');
select pg_temp.raises(format($$select public.settle_card_refund(%L, 're_1', 'succeeded')$$, (select id from made where key = 'r1')),
  null, 'the app cannot settle a refund', '42501');
select pg_temp.raises($$select public.record_external_stripe_refund('pi_p', 're_x', 10, 'succeeded')$$,
  null, 'the app cannot record a Stripe refund', '42501');
reset role;
select public.settle_card_refund((select id from made where key = 'r1'), 're_1', 'succeeded');
select public.settle_card_refund((select id from made where key = 'r1'), 're_1', 'succeeded');
select pg_temp.check((select status = 'succeeded' and stripe_refund_id = 're_1' and settled_at is not null from public.refunds where request_key = 'k1')
  and (select count(*) from public.notification_outbox where subject = 'Your refund for invoice INV-9004'
       and profile_id = 'a0000000-0000-0000-0000-00000000000c') = 1,
  'settling a refund as succeeded twice tells the family once');
-- A refund that fails no longer counts, and its amount can be refunded again.
set role authenticated;
insert into made select 'r2', (public.begin_card_refund('20000000-0000-0000-0000-000000000001', 50, 'Second lesson', true, 'k2')).id;
reset role;
select public.settle_card_refund((select id from made where key = 'r2'), 're_2', 'canceled', 'The card was closed.');
select pg_temp.check((select status = 'failed' and failure_reason = 'The card was closed.' from public.refunds where request_key = 'k2')
  and (select public.invoice_refunded(i) = 100 and public.invoice_balance(i) = -50 from public.invoices i where number = 'INV-9004')
  and exists (select 1 from public.notification_outbox where subject = 'Refund failed: INV-9004 (Ahmed)'),
  'a failed refund is left out of the balance and the office is told');
select public.settle_card_refund((select id from made where key = 'r2'), 're_2', 'succeeded');
select pg_temp.check((select status from public.refunds where request_key = 'k2') = 'failed', 'a failed refund stays failed');
set role authenticated;
select public.begin_card_refund('20000000-0000-0000-0000-000000000001', 50, 'Second lesson, again', false, 'k3');
select pg_temp.check((select count(*) from public.refunds where request_key = 'k3' and status = 'pending') = 1,
  'the failed amount can be refunded again (its credit note stays, so no second credit note is needed)');

-- Manual refunds
insert into made select 'm1', (public.record_manual_refund('20000000-0000-0000-0000-000000000002', 100, 'Overpayment', 'TT 99', false, 'm1')).id;
insert into made select 'm1again', (public.record_manual_refund('20000000-0000-0000-0000-000000000002', 100, 'Overpayment', 'TT 99', false, 'm1')).id;
select pg_temp.check((select count(distinct id) from made where key in ('m1', 'm1again')) = 1
  and (select status = 'succeeded' and method = 'bank-transfer' and reference = 'TT 99' and settled_at is not null
       from public.refunds where request_key = 'm1'),
  'a manual refund is recorded once per request key, with the payment''s method');
select pg_temp.raises($$select public.record_manual_refund('20000000-0000-0000-0000-000000000002', 1, 'More', null, false, 'm2')$$,
  'Issue a credit note with this refund, or refund no more than the AED 0.00 the family has overpaid.',
  'a manual refund beyond the overpayment needs a credit note');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Refund for invoice INV-9005') = 1,
  'the family is told about a manual refund once');
set role authenticated;
select public.record_manual_refund('20000000-0000-0000-0000-000000000002', 10, 'Paid back in cash', 'ignored', true, 'm3', 'cash');
select pg_temp.check((select method = 'cash' and amount = 10 and credit_note_id is not null from public.refunds where request_key = 'm3'),
  'a cash refund of a bank-transfer payment is recorded as cash');
select pg_temp.raises($$select public.record_manual_refund('20000000-0000-0000-0000-000000000002', 1, 'x', null, true, 'm4', 'card')$$,
  'Choose bank transfer or cash for a refund recorded by hand.', 'a manual refund is by bank transfer or cash');
reset role;

-- Refunds made in the Stripe Dashboard
select public.record_external_stripe_refund('pi_p', 're_ext', 20, 'succeeded');
select public.record_external_stripe_refund('pi_p', 're_ext', 20, 'succeeded');
select public.record_external_stripe_refund('pi_unknown', 're_none', 20, 'succeeded');
select pg_temp.check((select count(*) from public.refunds where stripe_refund_id = 're_ext' and request_key = 'stripe:re_ext'
    and status = 'succeeded' and amount = 20) = 1
  and (select count(*) from public.notification_outbox where subject = 'Refund made in Stripe: INV-9004 (Ahmed)' and email = 'office@x') = 1
  and not exists (select 1 from public.refunds where stripe_refund_id = 're_none'),
  'a refund made in Stripe is recorded once and the office is asked about a credit note; unknown payments are ignored');
select public.record_external_stripe_refund('pi_p', 're_1', 100, 'failed');
select pg_temp.check((select status from public.refunds where request_key = 'k1') = 'failed',
  'Stripe can still fail a refund that had succeeded');
select pg_temp.check(not exists (select 1 from public.notification_outbox where body like '%IBAN%' or push_body like '%IBAN%'),
  'no notification carries bank details');

-- Who sees credit notes and refunds
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.credit_notes) = (select count(*) from public.credit_notes where family_id = 'c0000000-0000-0000-0000-000000000001')
  and (select count(*) from public.credit_notes) > 0 and (select count(*) from public.refunds) > 0,
  'a parent sees their own family''s credit notes and refunds');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.credit_notes) = 0 and (select count(*) from public.refunds) = 0,
  'another parent sees none of them');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.credit_notes) = 0 and (select count(*) from public.refunds) = 0,
  'a tutor sees no credit notes or refunds');
select pg_temp.raises($$insert into public.credit_notes (number, invoice_id, family_id, reason, vat_rate, lines, subtotal, vat, total)
  values ('CN-9999', '10000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'x', 0, '[]', 1, 0, 1)$$,
  null, 'nobody writes credit notes directly', '42501');
reset role;

-- The accountant ------------------------------------------------------------------
insert into public.student_notes (student_id, notes) values ('d0000000-0000-0000-0000-000000000001', 'Private');
insert into public.lesson_notes (lesson_id, summary) values ('f0000000-0000-0000-0000-000000000001', 'Vectors');
insert into public.lesson_private_notes (lesson_id, private_note) values ('f0000000-0000-0000-0000-000000000001', 'Tired');
insert into public.homework (student_id, title, due_date) values ('d0000000-0000-0000-0000-000000000001', 'Exercise 3', '2026-10-10');
insert into public.messages (family_id, sender_id, sender_name, sender_role, body)
  values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000c', 'Mona', 'parent', 'Hello');
insert into public.enquiries (parent_name, email) values ('New Parent', 'new@x');
insert into public.tutor_payment_details (tutor_id, account_name, bank_name, iban)
  values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'Bank', 'AE070331234567890123456');
insert into public.expenses (date, category, amount, vat_amount) values ('2026-10-01', 'Rent', 1000, 50);
insert into public.tutor_invoices (tutor_id, number, period_start, period_end, status)
  values ('b0000000-0000-0000-0000-000000000001', 'TI-0001', '2026-09-01', '2026-09-30', 'submitted');
create temp table totals as select
  (select count(*) from public.invoices) invoices, (select count(*) from public.payments) payments,
  (select count(*) from public.charges) charges, (select count(*) from public.packages) packages,
  (select count(*) from public.credit_notes) credit_notes, (select count(*) from public.refunds) refunds,
  (select count(*) from public.families) families;
grant select on totals to authenticated;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.invoices) = (select invoices from totals)
  and (select count(*) from public.payments) = (select payments from totals)
  and (select count(*) from public.charges) = (select charges from totals)
  and (select count(*) from public.packages) = (select packages from totals) and (select packages from totals) > 0
  and (select count(*) from public.credit_notes) = (select credit_notes from totals)
  and (select count(*) from public.refunds) = (select refunds from totals)
  and (select count(*) from public.families) = (select families from totals)
  and (select count(*) from public.expenses) = 1 and (select count(*) from public.tutor_invoices) = 1,
  'the accountant reads every invoice, payment, charge, package, credit note, refund, expense, tutor invoice and family');
select pg_temp.check((select count(*) from public.students) = 0 and (select count(*) from public.lessons) = 0
  and (select count(*) from public.lesson_notes) = 0 and (select count(*) from public.lesson_private_notes) = 0
  and (select count(*) from public.homework) = 0 and (select count(*) from public.messages) = 0
  and (select count(*) from public.enquiries) = 0 and (select count(*) from public.family_billing) = 0
  and (select count(*) from public.tutor_payment_details) = 0 and (select count(*) from public.student_notes) = 0,
  'the accountant sees no pupils, lessons, notes, homework, messages, enquiries, billing details or bank details');
select pg_temp.raises($$insert into public.expenses (date, category, amount) values ('2026-10-02', 'Coffee', 10)$$,
  null, 'the accountant cannot add an expense', '42501');
update public.expenses set amount = 1 where category = 'Rent';
delete from public.expenses where category = 'Rent';
update public.invoices set notes = 'Checked' where number = 'INV-9004';
select pg_temp.raises($$delete from public.invoices where number = 'INV-9004'$$, null, 'the accountant cannot delete an invoice', '42501');
select pg_temp.check(public.is_accountant() and public.is_finance_reader() and public.my_role() = 'accountant',
  'is_accountant and is_finance_reader recognise the accountant');
reset role;
select pg_temp.check((select amount from public.expenses where category = 'Rent') = 1000
  and (select notes is null from public.invoices where number = 'INV-9004'),
  'the accountant cannot change or delete expenses or invoices');

-- Inviting the accountant ---------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.raises($$select public.invite_accountant('acc@firm.ae')$$, 'Admins only', 'a parent cannot invite an accountant', '42501');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.invite_accountant('  Acc@Firm.ae ', 'Fay Accountant') = 'invited', 'inviting a new email returns invited');
select pg_temp.check((select full_name = 'Fay Accountant' and accepted_at is null from public.accountant_invites where email = 'acc@firm.ae'),
  'the invitation is kept under the lower-case email');
select pg_temp.raises($$select public.invite_accountant('mum@x')$$,
  'This email address already signs in as a parent. Please use a different address for the accountant.',
  'an email that signs in as a parent cannot be invited');
reset role;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000011', 'Acc@firm.ae', now(), '{"signup":"parent","full_name":"Someone Else"}');
select pg_temp.check((select role = 'accountant' and full_name = 'Fay Accountant' from public.profiles where id = 'a0000000-0000-0000-0000-000000000011')
  and not exists (select 1 from public.families where lower(email) = 'acc@firm.ae')
  and (select accepted_at is not null from public.accountant_invites where email = 'acc@firm.ae'),
  'an invited accountant who confirms their email becomes an accountant, with no prospect family');
insert into auth.users (id, email, email_confirmed_at) values ('a0000000-0000-0000-0000-000000000012', 'late@firm.ae', now());
set role authenticated;
select pg_temp.check(public.invite_accountant('acc@firm.ae') = 'linked', 'inviting an existing accountant again returns linked');
select public.invite_accountant('late@firm.ae') as late_result \gset
select pg_temp.check(:'late_result' = 'linked'
  and (select role = 'accountant' and full_name = 'Late' from public.profiles where id = 'a0000000-0000-0000-0000-000000000012'),
  'inviting someone already signed in links them at once');
select public.remove_accountant('acc@firm.ae');
select pg_temp.check(not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000011')
  and not exists (select 1 from public.accountant_invites where email = 'acc@firm.ae'),
  'removing the accountant deletes their access and the invitation');
reset role;

-- Rebilled lines: only lines whose lessons are released are rebilled ----------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into made select 'pkg_void', (public.sell_package('c0000000-0000-0000-0000-000000000001', 'Ten lessons', null, 10, 4000)).id;
update public.invoices set status = 'void' where id = (select id from made where key = 'pkg_void');
select pg_temp.check((select count(*) = 1 and bool_and(not rebilled and rebilled_net = 0 and subtotal = 4000
      and not (lines->0 ? 'rebilled'))
    from public.credit_notes where invoice_id = (select id from made where key = 'pkg_void')),
  'cancelling a package sale gives a closing credit note that is not rebilled (nothing is released)');
reset role;
insert into public.charges (id, lesson_id, student_id, family_id, description, amount, status, date) values
  ('c1000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'IB 1:1 — Sami Ahmed, 2026-09-20', 450, 'invoiced', '2026-09-20 16:00+04'),
  ('c1000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'IB 1:1 — Sami Ahmed, 2026-09-27', 450, 'invoiced', '2026-09-27 23:30+04'),
  ('c1000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'IB 1:1 — Sami Ahmed, 2026-09-20', 450, 'invoiced', '2026-09-20 16:00+04');
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000020', 'INV-9020', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450,"chargeId":"c1000000-0000-0000-0000-0000000000a1"},
     {"description":"IB 1:1","quantity":1,"unitPrice":450,"chargeId":"c1000000-0000-0000-0000-0000000000a2"}]', 0.05),
  ('10000000-0000-0000-0000-000000000021', 'INV-9021', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-08', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":450,"chargeId":"c1000000-0000-0000-0000-0000000000a3"},
     {"description":"Registration fee","quantity":1,"unitPrice":200}]', 0.05);
update public.charges set invoice_id = '10000000-0000-0000-0000-000000000020' where id in ('c1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-0000000000a2');
update public.charges set invoice_id = '10000000-0000-0000-0000-000000000021' where id = 'c1000000-0000-0000-0000-0000000000a3';
set role authenticated;
insert into made select 'mixed', (public.issue_credit_note('10000000-0000-0000-0000-000000000020', 'Wrong date and a discount',
  '[{"invoiceLine":0,"net":450},{"invoiceLine":1,"net":100}]', true)).id;
select pg_temp.check((select rebilled and subtotal = 550 and rebilled_net = 450
      and (lines->0->>'rebilled')::boolean and not (lines->1 ? 'rebilled')
    from public.credit_notes where id = (select id from made where key = 'mixed'))
  and (select status = 'unbilled' from public.charges where id = 'c1000000-0000-0000-0000-0000000000a1')
  and (select status = 'invoiced' from public.charges where id = 'c1000000-0000-0000-0000-0000000000a2'),
  'a mixed note marks only the released lesson line rebilled; the AED 100 reduction stays a credit');
update public.invoices set status = 'void' where id = '10000000-0000-0000-0000-000000000021';
select pg_temp.check((select rebilled and subtotal = 650 and rebilled_net = 450
      and (lines->0->>'rebilled')::boolean and not (lines->1 ? 'rebilled')
    from public.credit_notes where invoice_id = '10000000-0000-0000-0000-000000000021')
  and (select status = 'unbilled' from public.charges where id = 'c1000000-0000-0000-0000-0000000000a3'),
  'cancelling a lesson invoice with a fee rebills the lesson line only; the fee is a credit');
reset role;

-- An outstanding accountant invitation never makes a parent or tutor an accountant -------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.invite_accountant('later.parent@x') = 'invited', 'an accountant invitation is outstanding');
reset role;
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000009', 'Later', 'Lena Later', 'Later.Parent@x');
insert into auth.users (id, email, email_confirmed_at) values ('a0000000-0000-0000-0000-000000000019', 'later.parent@x', now());
select pg_temp.check((select role = 'parent' and family_id = 'c0000000-0000-0000-0000-000000000009'
      from public.profiles where id = 'a0000000-0000-0000-0000-000000000019')
  and (select accepted_at is null from public.accountant_invites where email = 'later.parent@x'),
  'a family added with an invited address signs in as the parent, not the accountant, and the invitation stays unaccepted');
