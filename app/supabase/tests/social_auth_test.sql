-- Sign in with Apple and Google: new parents, known emails, private-relay relinking and set_my_name.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
create function pg_temp.family_of(uid text) returns public.families language sql as $$
  select f.* from public.profiles p join public.families f on f.id = p.family_id where p.id = uid::uuid
$$;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-00000000000a', 'boss@x');
insert into public.profiles (id, role, full_name, email) values ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'known@x', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'Known Two', 'Rania Saleh', 'old@x', 'active');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-sl');

-- New Google and Apple logins ------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000101', 'layla@x', now(), '{"provider":"google","providers":["google"]}', '{"full_name":"Layla Haddad"}'),
  ('a0000000-0000-0000-0000-000000000102', 'noor@x', now(), '{"provider":"google"}', '{"name":"Noor Aziz"}'),
  ('a0000000-0000-0000-0000-000000000103', 'given@x', now(), '{"provider":"google"}', '{"given_name":"Hana","family_name":"Yousef"}'),
  ('a0000000-0000-0000-0000-000000000104', 'x1y2@privaterelay.appleid.com', now(), '{"provider":"apple"}', '{}'),
  ('a0000000-0000-0000-0000-000000000105', 'sara.lee@x', now(), '{"provider":"google"}', null),
  ('a0000000-0000-0000-0000-000000000106', 'fatima@x', now(), '{"provider":"google"}', '{"full_name":"Fatima Al Mansoori"}'),
  ('a0000000-0000-0000-0000-000000000107', 'mbr@x', now(), '{"provider":"google"}', '{"name":"Mohammed bin Rashid Al Maktoum"}'),
  ('a0000000-0000-0000-0000-000000000108', 'later@x', now(), '{"provider":"email","providers":["email","google"]}', '{"full_name":"Huda Karim"}');

select pg_temp.check((select p.role || '/' || p.full_name || '/' || f.status || '/' || f.name || '/' || f.parent_name
  from public.profiles p join public.families f on f.id = p.family_id where p.id = 'a0000000-0000-0000-0000-000000000101')
  = 'parent/Layla Haddad/prospect/Haddad/Layla Haddad', 'a new Google login becomes a parent with a prospect family');
select pg_temp.check(exists (select 1 from public.notification_outbox
  where profile_id = 'a0000000-0000-0000-0000-00000000000a' and subject = 'New parent sign-up (Google): Layla Haddad'
    and body = 'Layla Haddad (layla@x) created an account in the app with Google.'), 'the admin is told about a Google sign-up');
select pg_temp.check((select full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000102') = 'Noor Aziz',
  'a Google login with only a name uses it');
select pg_temp.check((select full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000103') = 'Hana Yousef'
  and (pg_temp.family_of('a0000000-0000-0000-0000-000000000103')).name = 'Yousef', 'given and family names are joined');
select pg_temp.check((select p.full_name || '/' || f.name || '/' || f.status
  from public.profiles p join public.families f on f.id = p.family_id where p.id = 'a0000000-0000-0000-0000-000000000104')
  = 'New parent/New family/prospect', 'an Apple relay login with no name becomes New parent in New family');
select pg_temp.check(exists (select 1 from public.notification_outbox
  where subject = 'New parent sign-up (Apple): New parent' and body like '%with Apple.'), 'the admin is told about an Apple sign-up');
select pg_temp.check((select full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000105') = 'Sara Lee'
  and (pg_temp.family_of('a0000000-0000-0000-0000-000000000105')).name = 'Lee', 'a nameless login is named from the email');
select pg_temp.check((pg_temp.family_of('a0000000-0000-0000-0000-000000000106')).name = 'Al Mansoori',
  'an Arabic surname keeps its particle: Fatima Al Mansoori is the Al Mansoori family');
select pg_temp.check((pg_temp.family_of('a0000000-0000-0000-0000-000000000107')).name = 'Al Maktoum',
  'Mohammed bin Rashid Al Maktoum is the Al Maktoum family');
select pg_temp.check((select p.full_name || '/' || f.status from public.profiles p join public.families f on f.id = p.family_id
  where p.id = 'a0000000-0000-0000-0000-000000000108') = 'Huda Karim/prospect'
  and exists (select 1 from public.notification_outbox where subject = 'New parent sign-up (Google): Huda Karim'),
  'an email sign-up later continued with Google is treated as a Google login');
select pg_temp.check(public.surname_of('Layla Haddad') = 'Haddad' and public.surname_of('Al Hashimi') = 'Al Hashimi'
  and public.surname_of('Noor bint Saeed') = 'bint Saeed' and public.surname_of('Cher') = 'Cher', 'surname_of handles common shapes');
select pg_temp.check(not exists (select 1 from public.notification_outbox where body ilike '%bank%'), 'sign-up notifications never mention bank details');

-- Known emails still link as before -----------------------------------------
select count(*) as fams from public.families \gset
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000201', 'TUTOR@X', now(), '{"provider":"google"}', '{"full_name":"Someone Else"}'),
  ('a0000000-0000-0000-0000-000000000202', 'Known@X', now(), '{"provider":"apple"}', '{}');
select pg_temp.check((select role || '/' || tutor_id || '/' || full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000201')
  = 'tutor/b0000000-0000-0000-0000-000000000001/Tia Tutor', 'a Google login with a tutor email links to the tutor');
select pg_temp.check((select role || '/' || family_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000202')
  = 'parent/c0000000-0000-0000-0000-000000000001', 'an Apple login with a family email links to that family');
select pg_temp.check((select count(*) from public.families) = :fams, 'known emails create no new family');

-- Email logins are unchanged, and the provider cannot be spoofed ----------------
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000301', 'plain@x', now(), '{"provider":"email"}', '{}'),
  ('a0000000-0000-0000-0000-000000000302', 'spoof@x', now(), '{"provider":"email"}', '{"auth_provider":"google","full_name":"Spoof Er"}'),
  ('a0000000-0000-0000-0000-000000000303', 'nadia@x', now(), '{"provider":"email"}', '{"signup":"parent","full_name":"Nadia Khan","phone":"050"}');
select pg_temp.check(not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000301'), 'an email login without sign-up details gets no profile');
select pg_temp.check(not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000302'), 'a user-supplied auth_provider is ignored');
select pg_temp.check((select f.status || '/' || f.name || '/' || p.phone from public.profiles p join public.families f on f.id = p.family_id
  where p.id = 'a0000000-0000-0000-0000-000000000303') = 'prospect/Khan/050', 'the signup=parent flow still works');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'New parent sign-up: Nadia Khan'
  and body = 'Nadia Khan (nadia@x) created an account in the app.'), 'signup=parent keeps its notification wording');

select count(*) as fams from public.families \gset
select count(*) as profs from public.profiles \gset
update auth.users set email_confirmed_at = now() where id in ('a0000000-0000-0000-0000-000000000101', 'a0000000-0000-0000-0000-000000000303');
select pg_temp.check((select count(*) from public.families) = :fams and (select count(*) from public.profiles) = :profs,
  'confirming again creates no duplicate profiles or families');

-- set_my_name ---------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000104');
select public.set_my_name('  Omar   Al Hashimi ');
reset role;
select pg_temp.check((select p.full_name || '/' || f.parent_name || '/' || f.name
  from public.profiles p join public.families f on f.id = p.family_id where p.id = 'a0000000-0000-0000-0000-000000000104')
  = 'Omar Al Hashimi/Omar Al Hashimi/Al Hashimi', 'set_my_name renames the parent and their prospect family');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000201');
select public.set_my_name('Not A Tutor Name');
reset role;
select pg_temp.check((select full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000201') = 'Tia Tutor',
  'set_my_name does nothing for tutors');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000104');
do $$ begin
  perform public.set_my_name('   ');
  raise exception 'accepted a blank name';
exception when raise_exception then
  if sqlerrm = 'accepted a blank name' then raise; end if;
  raise notice 'ok - set_my_name rejects a blank name';
end $$;
do $$ begin
  perform public.set_my_name(repeat('a', 121));
  raise exception 'accepted a long name';
exception when raise_exception then
  if sqlerrm = 'accepted a long name' then raise; end if;
  raise notice 'ok - set_my_name rejects a name over 120 characters';
end $$;
select pg_temp.as_user('');
do $$ begin
  perform public.set_my_name('Nobody');
  raise exception 'renamed without a login';
exception when insufficient_privilege then raise notice 'ok - set_my_name needs a login';
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-000000000202');
select public.set_my_name('Someone Else');
reset role;
select pg_temp.check((select full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000202') = 'Mona Ahmed'
  and (select parent_name || '/' || name from public.families where id = 'c0000000-0000-0000-0000-000000000001') = 'Mona Ahmed/Ahmed',
  'set_my_name never overwrites the name the office recorded for an active family');
set role anon;
do $$ begin
  perform public.set_my_name('Anon');
  raise exception 'anon called set_my_name';
exception when insufficient_privilege then raise notice 'ok - the public cannot call set_my_name';
end $$;
reset role;

-- Relinking an Apple private-relay login ------------------------------------
select family_id as relay_old from public.profiles where id = 'a0000000-0000-0000-0000-000000000104' \gset
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
update public.families set email = 'x1y2@privaterelay.appleid.com' where id = 'c0000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.check((select family_id || '/' || full_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000104')
  = 'c0000000-0000-0000-0000-000000000002/Rania Saleh', 'a relay login moves to the family given its email');
select pg_temp.check((select status from public.families where id = :'relay_old') = 'archived', 'the empty prospect family is archived, not deleted');

-- A prospect family that already has a child keeps its login.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000401', 'abcd@privaterelay.appleid.com', now(), '{"provider":"apple"}', '{"full_name":"Lina Faris"}');
select family_id as busy_fam from public.profiles where id = 'a0000000-0000-0000-0000-000000000401' \gset
insert into public.students (family_id, full_name, curriculum, syllabus_id) values (:'busy_fam', 'Lulu Faris', 'IB', 'ib-aa-sl');
insert into public.families (id, name, parent_name, email, status) values
  ('c0000000-0000-0000-0000-000000000003', 'Faris', 'Lina Faris', 'lina@x', 'active');
update public.families set email = 'abcd@privaterelay.appleid.com' where id = 'c0000000-0000-0000-0000-000000000003';
select pg_temp.check((select family_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000401') = :'busy_fam'
  and (select status from public.families where id = :'busy_fam') = 'prospect', 'a prospect family with a child keeps its login');
\echo 'All social sign-in tests passed'
