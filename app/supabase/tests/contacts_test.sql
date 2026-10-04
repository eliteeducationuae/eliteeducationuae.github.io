-- Family contacts: the main contact mirror, sign-in for any contact, Apple private-relay contacts, per-contact
-- notifications and WhatsApp, row-level security and the contact RPCs. Run after the migrations.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
/** Runs p_sql and expects it to fail with exactly p_message (and p_state, when given). */
create function pg_temp.raises(p_sql text, p_message text, p_label text, p_state text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm <> p_message or (p_state is not null and sqlstate <> p_state) then
      raise exception 'FAILED: % (got % %)', p_label, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - %', p_label;
    return;
  end;
  raise exception 'FAILED: % (no error)', p_label;
end $$;
create function pg_temp.contact(p_email text) returns public.family_contacts language sql as $$
  select * from public.family_contacts where email = p_email order by can_log_in desc limit 1
$$;
create function pg_temp.cid(p_family text, p_name text) returns uuid language sql as $$
  select id from public.family_contacts where family_id = p_family::uuid and name = p_name
$$;
/** Who a notification (by URL) went to, other than WhatsApp: login emails and plain emails, sorted. */
create function pg_temp.recipients(p_url text) returns text language sql as $$
  select coalesce(string_agg(distinct lower(coalesce(p.email, o.email)), ',' order by lower(coalesce(p.email, o.email))), '')
  from public.notification_outbox o left join public.profiles p on p.id = o.profile_id
  where o.url = p_url and not o.whatsapp
$$;
create function pg_temp.admin_save(p_family text, p_contact jsonb) returns uuid language plpgsql as $$
declare r uuid;
begin
  perform pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  r := public.save_family_contact(p_family::uuid, p_contact);
  return r;
end $$;

-- Admin; tutor Tia (teaches Sami Haddad) and tutor Ted (teaches nobody); the Haddad, Other, Sync and Solo families.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor@x'),
  ('a0000000-0000-0000-0000-00000000000d', 'ted@x'),
  ('a0000000-0000-0000-0000-000000000011', 'layla@x'),
  ('a0000000-0000-0000-0000-000000000012', 'omar@x'),
  ('a0000000-0000-0000-0000-000000000021', 'other@x');
insert into public.tutors (id, full_name, email) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x'),
  ('b0000000-0000-0000-0000-000000000002', 'Ted Tutor', 'ted@x');
insert into public.families (id, name, parent_name, email, phone) values
  ('c0000000-0000-0000-0000-000000000001', 'Haddad', 'Layla Haddad', ' Layla@X ', '+971 50 111 1111'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x', null),
  ('c0000000-0000-0000-0000-000000000003', 'Sync', 'Sara Sync', 'sara@x', null),
  ('c0000000-0000-0000-0000-000000000004', 'Solo', 'Pat Solo', 'pat@x', null);
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Haddad', 'Sixth Form and IB Diploma'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other', 'Sixth Form and IB Diploma');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '10 days', now() + interval '10 days 1 hour', 'online');
insert into public.profiles (id, role, full_name, email, tutor_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000d', 'tutor', 'Ted Tutor', 'ted@x', 'b0000000-0000-0000-0000-000000000002');
update public.settings set bank_details = 'Elite Education FZ LLC, IBAN AE07 0331 2345 6789 0123 456' where id = 1;

-- (a) A new family gets its main contact; parent logins are linked --------------------------------------------------
select pg_temp.check((select count(*) from public.family_contacts where family_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select name || '/' || email || '/' || phone || '/' || relationship || '/' || is_primary || '/' || can_log_in
         || '/' || receives_invoices || '/' || receives_reports || '/' || receives_lesson_notes || '/' || receives_whatsapp
       from public.family_contacts where family_id = 'c0000000-0000-0000-0000-000000000001')
     = 'Layla Haddad/layla@x/+971 50 111 1111/parent/true/true/true/true/true/false',
  'a new family gets exactly one main contact mirroring parent_name, email (lower-case) and phone');
select pg_temp.check((select count(*) from public.family_contacts where is_primary) = 4, 'every family has its main contact');

insert into public.profiles (id, role, full_name, email, family_id) values
  ('a0000000-0000-0000-0000-000000000011', 'parent', 'Layla Haddad', 'layla@x', 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', 'parent', 'Omar Haddad', 'omar@x', 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000021', 'parent', 'Otto Other', 'other@x', 'c0000000-0000-0000-0000-000000000002');
select pg_temp.check((pg_temp.contact('layla@x')).profile_id = 'a0000000-0000-0000-0000-000000000011',
  'a parent login with the family email is linked to the main contact');
select pg_temp.check((select profile_id || '/' || is_primary || '/' || can_log_in || '/' || name from public.family_contacts
  where email = 'omar@x') = 'a0000000-0000-0000-0000-000000000012/false/true/Omar Haddad',
  'a parent login with a different email gets a contact of its own');
select pg_temp.check((select count(*) from public.family_contacts where family_id = 'c0000000-0000-0000-0000-000000000001') = 2,
  'the Haddad family now has two contacts');

-- (b) Two-way sync with families.parent_name/email/phone ------------------------------------------------------------
update public.families set email = 'Sara.New@X', phone = '+971 4 000 0000', parent_name = 'Sara Sync-Jones'
  where id = 'c0000000-0000-0000-0000-000000000003';
select pg_temp.check((select name || '/' || email || '/' || phone from public.family_contacts
  where family_id = 'c0000000-0000-0000-0000-000000000003' and is_primary) = 'Sara Sync-Jones/sara.new@x/+971 4 000 0000',
  'writing the family''s parent name, email and phone updates the main contact');
select pg_temp.check((select email from public.families where id = 'c0000000-0000-0000-0000-000000000003') = 'Sara.New@X',
  'the family email keeps the office''s spelling');

select pg_temp.admin_save('c0000000-0000-0000-0000-000000000003',
  '{"name":"Sam Sync","relationship":"father","email":"sam@x.ae","phone":"+971 50 999 0000","can_log_in":false}');
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000003',
  jsonb_build_object('id', pg_temp.cid('c0000000-0000-0000-0000-000000000003', 'Sam Sync'), 'is_primary', true));
select pg_temp.check((select parent_name || '/' || email || '/' || phone from public.families where id = 'c0000000-0000-0000-0000-000000000003')
  = 'Sam Sync/sam@x.ae/+971 50 999 0000', 'making another contact the main one updates the family''s name, email and phone');
select pg_temp.check((select string_agg(name || ':' || is_primary, ',' order by name) from public.family_contacts
  where family_id = 'c0000000-0000-0000-0000-000000000003') = 'Sam Sync:true,Sara Sync-Jones:false',
  'the previous main contact steps down');
update public.families set email = 'sara.new@x' where id = 'c0000000-0000-0000-0000-000000000003';
select pg_temp.check((select string_agg(name || ':' || is_primary, ',' order by name) from public.family_contacts
  where family_id = 'c0000000-0000-0000-0000-000000000003') = 'Sam Sync:false,Sara Sync-Jones:true'
  and (select parent_name from public.families where id = 'c0000000-0000-0000-0000-000000000003') = 'Sara Sync-Jones',
  'giving the family another contact''s email makes that contact the main one');

do $$ begin
  update public.family_contacts set is_primary = false where family_id = 'c0000000-0000-0000-0000-000000000003';
  set constraints all immediate;
  raise exception 'a family was left without a main contact';
exception when raise_exception then
  if sqlerrm <> 'Every family needs exactly one main contact.' then raise; end if;
  raise notice 'ok - a family cannot be left without a main contact';
end $$;
do $$ begin
  insert into public.family_contacts (family_id, name, email, is_primary)
  values ('c0000000-0000-0000-0000-000000000003', 'Two', 'two@x', true);
  raise exception 'a family was given two main contacts';
exception when unique_violation then raise notice 'ok - a family cannot have two main contacts';
end $$;

-- (c) Any contact who can sign in ----------------------------------------------------------------------------------
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  '{"name":"Rana Haddad","relationship":"mother","email":" Rana@x.ae ","can_log_in":true}');
select pg_temp.check((select count(*) from public.notification_outbox where email = 'rana@x.ae' and profile_id is null
  and subject = 'Your access to Elite Education' and url = '/sign-in'
  and body = E'Dear Rana,\n\nYou have been given access to the Haddad family''s account with Elite Education. Please download the '
    || 'Elite Education app, or open it on the web, and sign in or create an account with this email address (rana@x.ae). '
    || E'You will then see lessons, progress and messages for the family.\n\nElite Education | eliteeducation.me') = 1,
  'a new sign-in contact without a login is invited by email');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000013', 'Rana@x.ae', now(), '{"provider":"email"}', '{"full_name":"Someone Else"}');
select pg_temp.check((select role || '/' || family_id || '/' || full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000013')
  = 'parent/c0000000-0000-0000-0000-000000000001/Rana Haddad', 'a second contact signs in to the family under the contact''s name');
select pg_temp.check((pg_temp.contact('rana@x.ae')).profile_id = 'a0000000-0000-0000-0000-000000000013', 'the contact is linked to the login');

select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  '{"name":"Sam Driver","relationship":"driver","email":"driver@x.ae","can_log_in":false,"receives_invoices":false,
    "receives_reports":false,"receives_lesson_notes":false}');
select pg_temp.check(not exists (select 1 from public.notification_outbox where email = 'driver@x.ae'),
  'a contact who cannot sign in is not invited');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000015', 'driver@x.ae', now(), '{"provider":"email"}', '{}');
select pg_temp.check(not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000015'),
  'a contact who cannot sign in does not get a login');

-- (d) Apple private relay: add the relay address as a sign-in contact ---------------------------------------------
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000014', 'zz@privaterelay.appleid.com', now(), '{"provider":"apple"}', '{}');
select family_id as relay_old from public.profiles where id = 'a0000000-0000-0000-0000-000000000014' \gset
select pg_temp.check((select status from public.families where id = :'relay_old') = 'prospect',
  'an unknown Apple relay login first gets its own prospect family');
select count(*) as outbox_before from public.notification_outbox \gset
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  '{"name":"Karim Haddad","relationship":"father","email":"zz@privaterelay.appleid.com","can_log_in":true}');
select pg_temp.check((select family_id || '/' || full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000014')
  = 'c0000000-0000-0000-0000-000000000001/Karim Haddad', 'the relay login moves to the family that added it as a contact');
select pg_temp.check((select status from public.families where id = :'relay_old') = 'archived',
  'the empty prospect family is archived, not deleted');
select pg_temp.check((pg_temp.contact('zz@privaterelay.appleid.com')).profile_id = 'a0000000-0000-0000-0000-000000000014'
  and not (select can_log_in from public.family_contacts where family_id = :'relay_old'),
  'the relay contact is linked and the archived family''s contact no longer signs in');
select pg_temp.check(not exists (select 1 from public.notification_outbox where email = 'zz@privaterelay.appleid.com'
  and subject = 'Your access to Elite Education'), 'a contact who already has a login is not invited');

-- (e) A sign-in email belongs to one family -------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000002',
  '{"name":"Rana Again","email":"rana@x.ae","can_log_in":true}')$$,
  'That email address already signs in to another family. Please use a different address.',
  'a sign-in email already used by another family is refused');
select pg_temp.check(pg_temp.admin_save('c0000000-0000-0000-0000-000000000002',
  '{"name":"Rana Haddad","relationship":"other","email":"rana@x.ae","can_log_in":false,"receives_invoices":false,
    "receives_reports":false,"receives_lesson_notes":false}') is not null,
  'the same email may be a contact without sign-in in another family');
do $$ begin
  insert into public.family_contacts (family_id, name, email, can_log_in)
  values ('c0000000-0000-0000-0000-000000000004', 'Omar Copy', 'omar@x', true);
  raise exception 'a sign-in email was given to two families';
exception when unique_violation then raise notice 'ok - the database refuses a sign-in email in two families';
end $$;

-- (f) Notifications go to each contact who receives that kind --------------------------------------------------------
-- Karim (login) takes no invoices; Rana (login) no reports; Omar (login) no lesson notes. Priya the PA has no login and
-- takes invoices only. Grandma and Grandpa have no email or login and take invoices by WhatsApp on the same number.
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('zz@privaterelay.appleid.com')).id, 'receives_invoices', false));
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('rana@x.ae')).id, 'receives_reports', false));
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('omar@x')).id, 'receives_lesson_notes', false));
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  '{"name":"Priya Shah","relationship":"pa","email":"pa@x.ae","can_log_in":false,"receives_invoices":true,
    "receives_reports":false,"receives_lesson_notes":false}');
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  '{"name":"Mrs Huda Haddad","relationship":"guardian","phone":"+971 (50) 222-3333","can_log_in":false,"receives_whatsapp":true,
    "receives_invoices":true,"receives_reports":false,"receives_lesson_notes":false}');
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  '{"name":"Ali Haddad","relationship":"other","phone":"+971502223333","can_log_in":false,"receives_whatsapp":true,
    "receives_invoices":true,"receives_reports":false,"receives_lesson_notes":false}');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000011');
select public.set_whatsapp(true, '+971501111111');
reset role;
select pg_temp.check((pg_temp.contact('layla@x')).receives_whatsapp, 'a linked contact mirrors the login''s WhatsApp opt-in');
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('layla@x')).id, 'receives_whatsapp', false));
select pg_temp.check((pg_temp.contact('layla@x')).receives_whatsapp, 'the office cannot change a login''s own WhatsApp consent');

insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000001', 'INV-9001', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15', 'draft',
   '[{"description":"Lessons","quantity":2,"unitPrice":450}]');
update public.invoices set status = 'sent' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.recipients('/invoice/10000000-0000-0000-0000-000000000001') = 'layla@x,omar@x,pa@x.ae,rana@x.ae',
  'an invoice reaches the contacts who receive invoices: the PA by email, not the father who opted out');
select pg_temp.check((select bool_and(push_title is null and profile_id is null) from public.notification_outbox
  where email = 'pa@x.ae' and url = '/invoice/10000000-0000-0000-0000-000000000001'), 'a contact without a login gets email only');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and profile_id = 'a0000000-0000-0000-0000-000000000011'
  and whatsapp_template = 'invoice_sent' and url = '/invoice/10000000-0000-0000-0000-000000000001') = 1,
  'a linked contact gets WhatsApp through their own opt-in');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and profile_id is null
  and contact_id = pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Mrs Huda Haddad') and whatsapp_to = '+971502223333'
  and whatsapp_template = 'invoice_sent' and whatsapp_status = 'pending' and whatsapp_vars->>'1' = 'Huda' and email is null
  and not send_email and body like 'Dear Huda, invoice INV-9001 for AED 900.00%') = 1,
  'a contact without a login who agreed to WhatsApp gets the invoice by WhatsApp, greeted by first name');
select pg_temp.check((select count(*) from public.notification_outbox where whatsapp and whatsapp_to = '+971502223333'
  and url = '/invoice/10000000-0000-0000-0000-000000000001') = 1, 'the same number is never messaged twice');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp
  and profile_id = 'a0000000-0000-0000-0000-000000000012'), 'a linked contact who has not opted in gets no WhatsApp');

select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Mrs Huda Haddad'), 'receives_whatsapp', false));
select pg_temp.check((select whatsapp_status from public.notification_outbox where whatsapp
  and contact_id = pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Mrs Huda Haddad')) = 'skipped',
  'withdrawing a contact''s WhatsApp consent skips what is still waiting');
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items) values
  ('10000000-0000-0000-0000-000000000002', 'INV-9002', 'c0000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15', 'sent',
   '[{"description":"Lessons","quantity":1,"unitPrice":450}]');
select pg_temp.check(not exists (select 1 from public.notification_outbox where whatsapp
  and contact_id = pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Mrs Huda Haddad')
  and url = '/invoice/10000000-0000-0000-0000-000000000002'), 'a contact who withdrew consent is not messaged again');
select pg_temp.check((select whatsapp_status from public.notification_outbox where whatsapp
  and contact_id = pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Ali Haddad')
  and url = '/invoice/10000000-0000-0000-0000-000000000002') = 'pending', 'another contact on that number still is');
update public.invoices set status = 'paid' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select whatsapp_status from public.notification_outbox where whatsapp
  and contact_id = pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Ali Haddad')
  and url = '/invoice/10000000-0000-0000-0000-000000000002') = 'skipped', 'paying the invoice skips a contact''s held WhatsApp');

-- A report (published reports link to /parent/progress)
select public.notify_family('c0000000-0000-0000-0000-000000000001', 'Autumn report for Sami', 'Sami''s Autumn report is ready.',
  'New report', 'Sami — Autumn', '/parent/progress', true);
select pg_temp.check(pg_temp.recipients('/parent/progress') = 'layla@x,omar@x,zz@privaterelay.appleid.com',
  'a report reaches only the contacts who receive reports');

-- Homework set outside a lesson (lesson notes, homework and resources)
insert into public.homework (id, student_id, title, due_date) values
  ('20000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Vectors', current_date + 3);
select pg_temp.check(pg_temp.recipients('/homework/20000000-0000-0000-0000-000000000001')
  = 'layla@x,rana@x.ae,zz@privaterelay.appleid.com', 'homework reaches only the contacts who receive lesson notes');

-- Lesson notes once a lesson is recorded
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select public.complete_lesson('f0000000-0000-0000-0000-000000000001', 'completed',
  '{}', 'Worked through vectors.', null, '{}', '[]', '[]');
select pg_temp.check(pg_temp.recipients('/lesson/f0000000-0000-0000-0000-000000000001')
  = 'layla@x,rana@x.ae,zz@privaterelay.appleid.com', 'lesson notes reach only the contacts who receive them');

-- A general notice (a lesson request decision) reaches the contacts who sign in and the main contact
insert into public.lesson_requests (id, family_id, student_id, kind, tutor_id, service_id, start_at, end_at) values
  ('30000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'new-lesson', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '20 days', now() + interval '20 days 1 hour');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.decide_request('30000000-0000-0000-0000-000000000001', false, 'Please choose another time.');
select pg_temp.check(pg_temp.recipients('/') = 'layla@x,omar@x,rana@x.ae,zz@privaterelay.appleid.com',
  'a general notice reaches login and main contacts only');
select pg_temp.check(public.family_notice_kind('/invoice/x') = 'invoices' and public.family_notice_kind('/parent/billing') = 'invoices'
  and public.family_notice_kind('/parent/progress') = 'reports' and public.family_notice_kind('/reports/1') = 'reports'
  and public.family_notice_kind('/lesson/1') = 'lesson_notes' and public.family_notice_kind('/homework/1') = 'lesson_notes'
  and public.family_notice_kind('/parent/progress?tab=homework') = 'lesson_notes'
  and public.family_notice_kind('/messages/1') = 'general' and public.family_notice_kind(null) = 'general',
  'notice kinds follow the link they open');
select pg_temp.check(public.whatsapp_template_kind('invoice_overdue') = 'invoices'
  and public.whatsapp_template_kind('homework_due') = 'lesson_notes' and public.whatsapp_template_kind('lesson_reminder') = 'general',
  'WhatsApp templates map to the same kinds');
select pg_temp.check(not exists (select 1 from public.notification_outbox o, public.settings s
  where s.id = 1 and (position(s.bank_details in o.body) > 0 or o.body ilike '%IBAN%')),
  'no notification, email or WhatsApp carries bank details');

-- (g) Row-level security and list_family_contacts ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000013');
select pg_temp.check((select count(*) from public.family_contacts) = 8
  and (select count(*) from public.family_contacts where email is not null) = 6,
  'a second login sees all of its family''s contacts with their emails');
select pg_temp.check((select count(*) from public.list_family_contacts('c0000000-0000-0000-0000-000000000001')) = 8
  and (select bool_and(email is not null) from public.list_family_contacts('c0000000-0000-0000-0000-000000000001') where has_login)
  and (select name from public.list_family_contacts('c0000000-0000-0000-0000-000000000001') limit 1) = 'Layla Haddad',
  'list_family_contacts gives the family everything, main contact first');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000021');
select pg_temp.check(not exists (select 1 from public.family_contacts where family_id = 'c0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.list_family_contacts('c0000000-0000-0000-0000-000000000001')),
  'another family''s parent sees none of them');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check(not exists (select 1 from public.family_contacts), 'a tutor reads no contacts directly');
select pg_temp.check((select count(*) from public.list_family_contacts('c0000000-0000-0000-0000-000000000001')) = 8
  and (select bool_and(email is null and phone is null and profile_id is null and not has_login and not can_log_in
         and not receives_invoices and not receives_whatsapp and preferred_channel = 'email')
       from public.list_family_contacts('c0000000-0000-0000-0000-000000000001'))
  and exists (select 1 from public.list_family_contacts('c0000000-0000-0000-0000-000000000001')
              where name = 'Priya Shah' and relationship = 'pa'),
  'the family''s tutor sees names and relationships only');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check(not exists (select 1 from public.list_family_contacts('c0000000-0000-0000-0000-000000000001')),
  'a tutor who does not teach the family sees nothing');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.family_contacts) = 14, 'the office sees every contact');
do $$ begin
  insert into public.family_contacts (family_id, name) values ('c0000000-0000-0000-0000-000000000001', 'Sneaky');
  raise exception 'wrote a contact directly';
exception when insufficient_privilege then raise notice 'ok - contacts cannot be written directly';
end $$;
reset role;
set role anon;
do $$ begin
  perform public.list_family_contacts('c0000000-0000-0000-0000-000000000001');
  raise exception 'anon listed contacts';
exception when insufficient_privilege then raise notice 'ok - the public cannot list contacts';
end $$;
reset role;

-- (h) The contact RPCs --------------------------------------------------------------------------------------------------
delete from public.notification_outbox;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000013');
select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Nora Nanny","relationship":"other","email":"nora@x.ae","can_log_in":false}');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-00000000000a'
  and subject = 'Family contacts updated: Haddad' and body = 'Rana Haddad added Nora Nanny (other) for the Haddad family.'
  and url = '/manage/family-edit?id=c0000000-0000-0000-0000-000000000001') = 1, 'a parent adding a contact tells the office');
set role authenticated;
select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Nora Nanny'), 'phone', '+971 50 333 4444',
    'emergency_contact', true));
select pg_temp.check((select phone || '/' || emergency_contact || '/' || email from public.family_contacts where name = 'Nora Nanny')
  = '+971 50 333 4444/true/nora@x.ae', 'a parent edits a contact; keys left out keep their values');
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox
  where body = 'Rana Haddad updated Nora Nanny (other) for the Haddad family.'), 'editing tells the office too');
set role authenticated;
select public.remove_family_contact(pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Nora Nanny'));
reset role;
select pg_temp.check(pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Nora Nanny') is null
  and exists (select 1 from public.notification_outbox where body = 'Rana Haddad removed Nora Nanny (other) from the Haddad family.'),
  'a parent removes a contact and the office is told');
set role authenticated;
select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Hana Haddad","relationship":"guardian","email":"hana@x.ae","can_log_in":true}');
reset role;
select pg_temp.check(exists (select 1 from public.notification_outbox where email = 'hana@x.ae'
  and subject = 'Your access to Elite Education' and body like 'Dear Hana,%'), 'a parent''s new sign-in contact is invited');

set role authenticated;
select pg_temp.raises($$select public.remove_family_contact(pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Layla Haddad'))$$,
  'Please choose another main contact before removing this one.', 'the main contact cannot be removed');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Layla Haddad'), 'is_primary', false))$$,
  'Please choose another main contact first.', 'the main contact cannot simply step down');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000002', '{"name":"Intruder","email":"i@x"}')$$,
  'Family not found', 'a parent cannot add a contact to another family', '42501');
select pg_temp.raises($$select public.remove_family_contact('00000000-0000-0000-0000-000000000000')$$,
  'Family not found', 'removing an unknown contact is refused', '42501');
reset role;
select id as otto_contact from public.family_contacts where email = 'other@x' \gset
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000013');
select pg_temp.raises(format($$select public.remove_family_contact(%L)$$, :'otto_contact'),
  'Family not found', 'a parent cannot remove another family''s contact', '42501');
select pg_temp.raises(format($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001', '{"id":"%s","name":"Moved"}')$$,
  :'otto_contact'), 'Family not found', 'a parent cannot edit another family''s contact', '42501');

-- Validation, in the family's own words
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001', '{"name":"  ","can_log_in":false}')$$,
  'Please enter the contact''s name.', 'a contact needs a name');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Bad Email","email":"not-an-email","can_log_in":false}')$$, 'Please enter a valid email address.', 'emails are checked');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001', '{"name":"No Email","can_log_in":true}')$$,
  'A contact who can sign in needs an email address.', 'a sign-in contact needs an email');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', pg_temp.cid('c0000000-0000-0000-0000-000000000001', 'Layla Haddad'), 'email', '', 'can_log_in', false))$$,
  'The main contact needs an email address.', 'the main contact needs an email');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Wa Nophone","can_log_in":false,"receives_whatsapp":true,"phone":"050 123 4567"}')$$,
  'Please enter a mobile number with its country code, for example +971 50 123 4567, to send WhatsApp messages.',
  'WhatsApp needs a number with its country code');
select pg_temp.raises($$select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Copy Cat","email":"RANA@X.AE","can_log_in":false}')$$,
  'Another contact in this family already uses that email address.', 'two contacts in a family cannot share an email');
reset role;

-- The last sign-in: Pat (main contact) cannot sign in; Quinn is the Solo family's only login.
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000004',
  '{"name":"Quinn Solo","relationship":"guardian","email":"quinn@x.ae","can_log_in":true}');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000041', 'quinn@x.ae', now(), '{"provider":"email"}', '{}');
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000004',
  jsonb_build_object('id', pg_temp.cid('c0000000-0000-0000-0000-000000000004', 'Pat Solo'), 'can_log_in', false));
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000041');
select pg_temp.raises($$select public.remove_family_contact(pg_temp.cid('c0000000-0000-0000-0000-000000000004', 'Quinn Solo'))$$,
  'At least one contact must be able to sign in.', 'a parent cannot remove the family''s last sign-in');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000021');
select pg_temp.raises(format($$select public.save_family_contact('c0000000-0000-0000-0000-000000000002', '{"id":"%s","can_log_in":false}')$$,
  :'otto_contact'), 'At least one contact must be able to sign in.', 'a parent cannot switch off the family''s last sign-in');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.remove_family_contact(pg_temp.cid('c0000000-0000-0000-0000-000000000004', 'Quinn Solo'));
reset role;
select pg_temp.check(pg_temp.cid('c0000000-0000-0000-0000-000000000004', 'Quinn Solo') is null
  and (select family_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000041') is null,
  'the office can remove the last sign-in, and the login leaves the family');

-- Withdrawing sign-in unlinks the login; giving it back links it again.
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('omar@x')).id, 'can_log_in', false));
select pg_temp.check((select family_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000012') is null
  and (pg_temp.contact('omar@x')).profile_id is null, 'withdrawing a contact''s sign-in takes their login out of the family');
update auth.users set email_confirmed_at = now() where id = 'a0000000-0000-0000-0000-000000000012';
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('omar@x')).id, 'can_log_in', true));
select pg_temp.check((select family_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000012')
  = 'c0000000-0000-0000-0000-000000000001' and (pg_temp.contact('omar@x')).profile_id = 'a0000000-0000-0000-0000-000000000012',
  'allowing sign-in again brings the login back');

-- Renaming a linked contact renames the login; set_my_name renames the caller's contact.
select pg_temp.admin_save('c0000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', (pg_temp.contact('rana@x.ae')).id, 'name', 'Rana Al Haddad'));
select pg_temp.check((select full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000013') = 'Rana Al Haddad',
  'a linked login carries its contact''s name');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000051', 'new@privaterelay.appleid.com', now(), '{"provider":"apple"}', '{}');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000051');
select public.set_my_name('Mira Saeed');
reset role;
select pg_temp.check((select c.name || '/' || c.is_primary || '/' || f.parent_name from public.family_contacts c
  join public.families f on f.id = c.family_id where c.profile_id = 'a0000000-0000-0000-0000-000000000051')
  = 'Mira Saeed/true/Mira Saeed', 'set_my_name renames the caller''s contact and the family');

-- Privileges
select pg_temp.check(not has_function_privilege('authenticated', 'public.notify_family_kind(uuid, text, text, text, text, text, text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.queue_whatsapp_contact(uuid, text, jsonb, text, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.save_family_contact(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.save_family_contact(uuid, jsonb)', 'execute'),
  'only the contact RPCs are open to signed-in users');
\echo 'All family contacts tests passed'
