-- Closing a family contact's own login: a driver, PA or other non-main contact who deletes their account closes only
-- their own sign-in; the main contact (or the family's last sign-in contact) still closes the family; requests the
-- office records keep closing the family. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss is the admin. Mona is the Ahmed main contact (Sami); Otto is the Other main contact (Ollie).
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x', null), ('a0000000-0000-0000-0000-00000000000c', 'mum@x', null),
  ('a0000000-0000-0000-0000-00000000000e', 'other@x', null), ('a0000000-0000-0000-0000-0000000000d1', 'driver@x.com', now()),
  ('a0000000-0000-0000-0000-0000000000d2', 'pa@x.com', now());
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'other@x');
insert into public.students (id, family_id, full_name) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other');
insert into public.profiles (id, role, full_name, email, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto', 'other@x', 'c0000000-0000-0000-0000-000000000002');

-- The probe: Mona adds the family driver as a contact who can sign in, and the driver's login joins the family.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select public.save_family_contact('c0000000-0000-0000-0000-000000000001',
  '{"name":"Raj Driver","relationship":"driver","email":"driver@x.com","can_log_in":true,"receives_invoices":false}'::jsonb);
reset role;
select pg_temp.as_user('');
insert into public.profiles (id, role, full_name, email) values
  ('a0000000-0000-0000-0000-0000000000d1', 'parent', 'Raj', 'driver@x.com') on conflict (id) do nothing;
select public.link_login('a0000000-0000-0000-0000-0000000000d1', 'driver@x.com');
select pg_temp.check((select family_id = 'c0000000-0000-0000-0000-000000000001' and role = 'parent'
                        from public.profiles where id = 'a0000000-0000-0000-0000-0000000000d1'),
  'the driver''s login is a parent login of the Ahmed family');
select pg_temp.check(public.account_closes_own_login_only('a0000000-0000-0000-0000-0000000000d1')
                     and not public.account_closes_own_login_only('a0000000-0000-0000-0000-00000000000c'),
  'the driver closes only their own login; the main contact closes the family');

-- The driver taps "Delete my account" (delete-account Edge Function: begin then perform, as the service role).
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
insert into ids values ('driver', public.begin_account_deletion('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1'));
select pg_temp.check((select family_id is null and label = 'Family contact login (Ahmed family)'
                        from public.deletion_requests where id = (select id from ids where k = 'driver')),
  'the waiting request names the contact''s login, not the family');
create temp table s_driver as
  select public.perform_account_deletion((select id from ids where k = 'driver'), 'a0000000-0000-0000-0000-0000000000d1') as s;
select pg_temp.check((select s->'linkedProfileIds' = '[]'::jsonb and (s->>'loginOnly')::boolean
                             and not (s->>'familyAnonymised')::boolean and s->>'profileId' = 'a0000000-0000-0000-0000-0000000000d1'
                        from s_driver), 'only the driver''s login is deleted');
select pg_temp.check((select name = 'Ahmed' and parent_name = 'Mona Ahmed' and email = 'mum@x' and deleted_at is null
                        from public.families where id = 'c0000000-0000-0000-0000-000000000001'),
  'the family stays open with its main contact');
select pg_temp.check((select full_name = 'Sami Ahmed' from public.students where id = 'd0000000-0000-0000-0000-000000000001'),
  'the children are untouched');
select pg_temp.check((select family_id = 'c0000000-0000-0000-0000-000000000001' and email = 'mum@x'
                        from public.profiles where id = 'a0000000-0000-0000-0000-00000000000c'),
  'the main contact''s login is untouched');
select pg_temp.check(not exists (select 1 from public.family_contacts where email = 'driver@x.com')
                     and exists (select 1 from public.family_contacts
                                  where family_id = 'c0000000-0000-0000-0000-000000000001' and is_primary and email = 'mum@x'),
  'the driver''s contact is removed and the main contact stays');
select pg_temp.check((select family_id is null from public.profiles where id = 'a0000000-0000-0000-0000-0000000000d1'),
  'the driver''s login has left the family');
select pg_temp.check((select status = 'completed' and label = 'Family contact login (closed)'
                        from public.deletion_requests where id = (select id from ids where k = 'driver')),
  'the completed request is labelled without personal details');
select pg_temp.check((select body like '%Account type: Family contact login.%' and body like '%family''s account, children and other contacts are unchanged%'
                             and body not like '%Raj%' and body not like '%Ahmed%'
                        from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-00000000000a'
                         and subject = 'An account has been closed' order by created_at desc limit 1),
  'the office is told a contact''s login was closed, without names');

-- Mona, the main contact, closes her account: the whole family still closes.
insert into ids values ('mona', public.begin_account_deletion('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c'));
create temp table s_mona as
  select public.perform_account_deletion((select id from ids where k = 'mona'), 'a0000000-0000-0000-0000-00000000000c') as s;
select pg_temp.check((select (s->>'familyAnonymised')::boolean and not (s->>'loginOnly')::boolean from s_mona),
  'the main contact closing still closes the family');
select pg_temp.check((select deleted_at is not null from public.families where id = 'c0000000-0000-0000-0000-000000000001'),
  'the Ahmed family is closed');

-- The office records a request for a non-main contact's login: as before, the family closes with it.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select public.save_family_contact('c0000000-0000-0000-0000-000000000002',
  '{"name":"Pat PA","relationship":"pa","email":"pa@x.com","can_log_in":true}'::jsonb);
reset role;
select pg_temp.as_user('');
insert into public.profiles (id, role, full_name, email) values
  ('a0000000-0000-0000-0000-0000000000d2', 'parent', 'Pat', 'pa@x.com') on conflict (id) do nothing;
select public.link_login('a0000000-0000-0000-0000-0000000000d2', 'pa@x.com');
select pg_temp.check((select family_id = 'c0000000-0000-0000-0000-000000000002' from public.profiles where id = 'a0000000-0000-0000-0000-0000000000d2'),
  'the PA''s login is a parent login of the Other family');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into ids values ('pa', public.admin_record_deletion_request('a0000000-0000-0000-0000-0000000000d2', null, null, 'Asked by phone'));
reset role;
select pg_temp.as_user('');
create temp table s_pa as
  select public.perform_account_deletion((select id from ids where k = 'pa'), 'a0000000-0000-0000-0000-00000000000a') as s;
select pg_temp.check((select (s->>'familyAnonymised')::boolean and not (s->>'loginOnly')::boolean
                             and s->'linkedProfileIds' ? 'a0000000-0000-0000-0000-00000000000e' from s_pa),
  'a request the office records keeps closing the family');

-- The family's last sign-in contact closes the family: the main contact here cannot sign in.
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000003', 'Third', 'Tara', 'tara@x');
insert into auth.users (id, email, email_confirmed_at) values ('a0000000-0000-0000-0000-0000000000d3', 'nanny@x.com', now());
update public.family_contacts set can_log_in = false where family_id = 'c0000000-0000-0000-0000-000000000003';
insert into public.family_contacts (family_id, name, relationship, email, can_log_in)
  values ('c0000000-0000-0000-0000-000000000003', 'Nina Nanny', 'other', 'nanny@x.com', true);
insert into public.profiles (id, role, full_name, email) values
  ('a0000000-0000-0000-0000-0000000000d3', 'parent', 'Nina', 'nanny@x.com') on conflict (id) do nothing;
select public.link_login('a0000000-0000-0000-0000-0000000000d3', 'nanny@x.com');
select pg_temp.check((select family_id = 'c0000000-0000-0000-0000-000000000003' from public.profiles where id = 'a0000000-0000-0000-0000-0000000000d3')
                     and not public.account_closes_own_login_only('a0000000-0000-0000-0000-0000000000d3'),
  'the family''s last sign-in contact closes the family');

-- Signed-in users still cannot call the rule directly.
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
do $$ begin
  perform public.account_closes_own_login_only('a0000000-0000-0000-0000-0000000000d3');
  raise exception 'FAILED: a signed-in user called account_closes_own_login_only';
exception when insufficient_privilege then raise notice 'ok - a signed-in user cannot call account_closes_own_login_only';
end $$;
reset role;
