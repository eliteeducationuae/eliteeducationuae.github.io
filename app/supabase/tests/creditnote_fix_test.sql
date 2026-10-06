-- Credit notes and cancelled invoices go to the family's billing contacts (20261113001700_creditnote_fix.sql).
-- Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
/** Who a family notice (by subject) went to, other than WhatsApp: login emails and plain emails, sorted. */
create function pg_temp.recipients(p_subject text) returns text language sql as $$
  select coalesce(string_agg(distinct lower(coalesce(p.email, o.email)), ',' order by lower(coalesce(p.email, o.email))), '')
  from public.notification_outbox o left join public.profiles p on p.id = o.profile_id
  where o.subject = p_subject and not o.whatsapp
$$;

-- Admin; the Haddad family: Layla (main contact, signs in), Omar (signs in, has turned invoices off) and Priya, their PA
-- (no sign-in, invoices only).
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x', now()),
  ('a0000000-0000-0000-0000-000000000011', 'layla@x', now()),
  ('a0000000-0000-0000-0000-000000000012', 'omar@x', now());
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Haddad', 'Layla Haddad', 'layla@x');
delete from public.profiles;
insert into public.profiles (id, role, full_name, email, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null),
  ('a0000000-0000-0000-0000-000000000011', 'parent', 'Layla Haddad', 'layla@x', 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', 'parent', 'Omar Haddad', 'omar@x', 'c0000000-0000-0000-0000-000000000001');
update public.settings set vat_rate = 0.05, business_name = 'Elite Education', legal_name = 'Elite Education FZ LLC',
  trn = '100123456700003', registered_address = 'Office 1, Dubai, UAE', notify_email = 'office@x' where id = 1;

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (select id from public.family_contacts where profile_id = 'a0000000-0000-0000-0000-000000000012'),
    'receives_invoices', false));
select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Priya Shah","relationship":"pa","email":"pa@x.ae","can_log_in":false,"receives_invoices":true,
    "receives_reports":false,"receives_lesson_notes":false}');
reset role;
select pg_temp.check((select string_agg(coalesce(p.email, c.email) || ':' || c.can_log_in || '/' || c.receives_invoices, ','
                        order by coalesce(p.email, c.email))
                      from public.family_contacts c left join public.profiles p on p.id = c.profile_id
                      where c.family_id = 'c0000000-0000-0000-0000-000000000001')
                     = 'layla@x:true/true,omar@x:true/false,pa@x.ae:false/true',
  'Layla and Omar sign in, Omar has turned invoices off, and Priya takes invoices only');

select pg_temp.check(public.family_notice_kind('/credit-note/x') = 'invoices' and public.family_notice_kind('/invoice/x') = 'invoices'
  and public.family_notice_kind('/parent/billing') = 'invoices' and public.family_notice_kind('/credit-note') = 'general'
  and public.family_notice_kind('/messages/1') = 'general',
  'a credit note link is an invoices notice');

-- An invoice, sent, then credited.
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('10000000-0000-0000-0000-000000000001', 'INV-9001', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15', 'sent',
   '[{"description":"IB 1:1","quantity":2,"unitPrice":450}]', 0.05),
  ('10000000-0000-0000-0000-000000000002', 'INV-9002', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15', 'sent',
   '[{"description":"IB 1:1","quantity":1,"unitPrice":200}]', 0.05);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table made as select n.* from public.issue_credit_note('10000000-0000-0000-0000-000000000001', 'Lesson cancelled',
  '[{"invoiceLine":0,"net":450}]') as n;
reset role;
select pg_temp.check(pg_temp.recipients('Credit note ' || (select number from made) || ' from Elite Education') = 'layla@x,pa@x.ae',
  'a credit note reaches the billing-only PA and the main contact, not the login who turned invoices off');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-000000000011'
                        and url = '/credit-note/' || (select id from made)) = 1
  and (select count(*) from public.notification_outbox where email = 'pa@x.ae' and profile_id is null and url is null
         and subject = 'Credit note ' || (select number from made) || ' from Elite Education') = 1,
  'Layla gets the app link; Priya, who cannot sign in, gets an email without one');

-- Cancelling a part-paid invoice issues a closing credit note and tells the same contacts.
insert into public.payments (invoice_id, amount, method, reference) values ('10000000-0000-0000-0000-000000000002', 50, 'bank-transfer', 'TT 1');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
update public.invoices set status = 'void' where id = '10000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.check(pg_temp.recipients('Invoice INV-9002 has been cancelled') = 'layla@x,pa@x.ae',
  'a cancelled invoice notice reaches the billing-only PA and the main contact, not the login who turned invoices off');

select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261113001700' and name = 'creditnote_fix'),
  'the migrations ledger records the fix');
