-- Per-student tutor pay and family prices: overrides, visibility, charges, tutor invoices and awarded roles.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b3', 't3@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x'), ('a0000000-0000-0000-0000-00000000000e', 'other@x'),
  ('a0000000-0000-0000-0000-00000000000f', 'sami@x');
-- Tia (usual 200), Tom (usual 250) and Cara the cover tutor (usual 150).
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b1000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200),
  ('b2000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250),
  ('b3000000-0000-0000-0000-000000000003', 'Cara Cover', 't3@x', 150);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'), ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto', 'other@x');
insert into public.students (id, family_id, full_name) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Lina Ahmed'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'Ollie Other'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'Noor Ahmed');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b1000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b2000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Cara Cover', 't3@x', 'b3000000-0000-0000-0000-000000000003', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000e', 'parent', 'Otto', 'other@x', null, 'c0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-00000000000f', 'student', 'Sami Ahmed', 'sami@x', null, null, 'd0000000-0000-0000-0000-000000000001');
insert into public.services (id, name, duration_min, rate) values
  ('e0000000-0000-0000-0000-000000000001', 'IGCSE 1:1', 60, 450), ('e0000000-0000-0000-0000-000000000002', 'Small group', 60, 300);
-- Sami: Maths with Tia, Chemistry with Tom. Ollie: Maths with Tia. Lina: Physics only, no tutor yet.
-- Noor: Maths and Biology, no tutor yet.
insert into public.enrolments (id, student_id, subject, curriculum, tutor_id) values
  ('70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'IGCSE', 'b1000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Chemistry', 'IGCSE', 'b2000000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'Maths', 'IGCSE', 'b1000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'Physics', 'IGCSE', null),
  ('70000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', 'Maths', 'IGCSE', null),
  ('70000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000004', 'Biology', 'IGCSE', null);
-- A role Ollie's Maths was filled through, already awarded.
insert into public.opportunities (id, title, pay_rate, status, student_id, subject)
values ('f0000000-0000-0000-0000-000000000009', 'Ollie IGCSE Maths', 220, 'awarded', 'd0000000-0000-0000-0000-000000000003', 'Maths');
insert into public.enrolment_tutor_pay (enrolment_id, hourly_pay, source, opportunity_id)
values ('70000000-0000-0000-0000-000000000003', 220, 'opportunity', 'f0000000-0000-0000-0000-000000000009');

-- Lessons last month (scheduled, recorded below).
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, subject)
select id, tutor, students, svc, s, s + dur, 'online', subj from (values
  -- L1: Tia, Sami, Maths, 90 minutes.
  ('50000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid, '{d0000000-0000-0000-0000-000000000001}'::uuid[],
   'e0000000-0000-0000-0000-000000000001'::uuid, date_trunc('month', now()) - interval '20 days', interval '90 minutes', 'Maths'),
  -- L2: Tom, Sami, Chemistry.
  ('50000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', date_trunc('month', now()) - interval '19 days', interval '60 minutes', 'Chemistry'),
  -- L3: Tia, group of Sami and Ollie, Maths.
  ('50000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000003}',
   'e0000000-0000-0000-0000-000000000002', date_trunc('month', now()) - interval '18 days', interval '60 minutes', 'maths '),
  -- L5: Tia, Ollie alone, Maths (Ollie's family has a package by then).
  ('50000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000003}',
   'e0000000-0000-0000-0000-000000000001', date_trunc('month', now()) - interval '17 days', interval '60 minutes', 'Maths'),
  -- L6: Cara covers Sami's Maths.
  ('50000000-0000-0000-0000-000000000006', 'b3000000-0000-0000-0000-000000000003', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', date_trunc('month', now()) - interval '16 days', interval '60 minutes', 'Maths'),
  -- L7: Tia, group of Ollie and Lina, Maths (Lina has no Maths enrolment).
  ('50000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000003,d0000000-0000-0000-0000-000000000002}',
   'e0000000-0000-0000-0000-000000000002', date_trunc('month', now()) - interval '15 days', interval '60 minutes', 'Maths'),
  -- L8: Tia, Lina, no subject. L9: Tia, Noor, no subject.
  ('50000000-0000-0000-0000-000000000008', 'b1000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000002}',
   'e0000000-0000-0000-0000-000000000001', date_trunc('month', now()) - interval '14 days', interval '60 minutes', null),
  ('50000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000004}',
   'e0000000-0000-0000-0000-000000000001', date_trunc('month', now()) - interval '14 days', interval '60 minutes', null),
  -- L4: Tia, Sami, Maths, in two hours (to be late-cancelled).
  ('50000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '2 hours', interval '60 minutes', 'Maths')
) v(id, tutor, students, svc, s, dur, subj);
update public.settings set late_cancel_fee = 0.5;

set role authenticated;

-- (a) set_enrolment_rates ------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', 300, 600);
select pg_temp.check((select hourly_pay || '/' || source || '/' || coalesce(opportunity_id::text, 'none') from public.enrolment_tutor_pay
  where enrolment_id = '70000000-0000-0000-0000-000000000001') = '300.00/custom/none', 'an admin sets custom tutor pay');
select pg_temp.check((select hourly_price from public.enrolment_family_price where enrolment_id = '70000000-0000-0000-0000-000000000001') = 600,
  'an admin sets a custom family price');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', null, null);
select pg_temp.check(not exists (select 1 from public.enrolment_tutor_pay where enrolment_id = '70000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.enrolment_family_price where enrolment_id = '70000000-0000-0000-0000-000000000001'),
  'null clears both overrides');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000003', 220, null);
select pg_temp.check((select source || '/' || opportunity_id from public.enrolment_tutor_pay where enrolment_id = '70000000-0000-0000-0000-000000000003')
  = 'opportunity/f0000000-0000-0000-0000-000000000009', 'saving the same pay keeps the role it came from');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000003', 240, null);
select pg_temp.check((select hourly_pay || '/' || source || '/' || coalesce(opportunity_id::text, 'none') from public.enrolment_tutor_pay
  where enrolment_id = '70000000-0000-0000-0000-000000000003') = '240.00/custom/none', 'changing the pay makes it custom');
do $$ begin
  perform public.set_enrolment_rates('70000000-0000-0000-0000-000000000004', 100, null);
  raise exception 'pay without tutor';
exception when raise_exception then
  if sqlerrm <> 'Please choose a tutor for this subject before setting their pay.' then raise; end if;
  raise notice 'ok - tutor pay needs a tutor on the subject';
end $$;
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000004', null, 400);
select pg_temp.check((select hourly_price from public.enrolment_family_price where enrolment_id = '70000000-0000-0000-0000-000000000004') = 400,
  'a family price needs no tutor');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000004', null, null);
do $$ begin
  perform public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', -1, null);
  raise exception 'negative pay';
exception when raise_exception then
  if sqlerrm <> 'Please enter a rate of zero or more.' then raise; end if;
  raise notice 'ok - negative pay is refused';
end $$;
do $$ begin
  perform public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', null, -5);
  raise exception 'negative price';
exception when raise_exception then
  if sqlerrm <> 'Please enter a rate of zero or more.' then raise; end if;
  raise notice 'ok - a negative price is refused';
end $$;
do $$ begin
  perform public.set_enrolment_rates('70000000-0000-0000-0000-0000000000ff', 1, 1);
  raise exception 'missing enrolment';
exception when raise_exception then
  if sqlerrm <> 'Subject not found' then raise; end if;
  raise notice 'ok - an unknown subject is reported';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', 999, null);
  raise exception 'tutor set rates';
exception when insufficient_privilege then raise notice 'ok - tutors cannot set rates';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', null, 1);
  raise exception 'parent set rates';
exception when insufficient_privilege then raise notice 'ok - parents cannot set rates';
end $$;

-- The rates used from here on.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', 300, 600);
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000002', 280, null);
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000003', 180, 500);

-- (b) Who can see what --------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select string_agg(enrolment_id::text, ',' order by enrolment_id) from public.enrolment_tutor_pay)
  = '70000000-0000-0000-0000-000000000001,70000000-0000-0000-0000-000000000003', 'a tutor sees the pay for subjects they teach, not another tutor''s');
select pg_temp.check((select count(*) from public.enrolment_family_price) = 0, 'a tutor sees no family prices');
select pg_temp.check((select count(*) from public.enrolments e, lateral (select 1 from public.enrolment_family_price f where f.enrolment_id = e.id) x) = 0,
  'a tutor cannot reach family prices through enrolments');
update public.enrolment_tutor_pay set hourly_pay = 999 where enrolment_id = '70000000-0000-0000-0000-000000000001';
delete from public.enrolment_tutor_pay where enrolment_id = '70000000-0000-0000-0000-000000000001';
select pg_temp.check((select hourly_pay from public.enrolment_tutor_pay where enrolment_id = '70000000-0000-0000-0000-000000000001') = 300,
  'a tutor cannot change or delete their own pay');
do $$ begin
  insert into public.enrolment_tutor_pay (enrolment_id, hourly_pay) values ('70000000-0000-0000-0000-000000000005', 999);
  raise exception 'tutor inserted pay';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot add pay';
end $$;
do $$ begin
  perform * from public.lesson_tutor_rate('50000000-0000-0000-0000-000000000001');
  raise exception 'tutor called lesson_tutor_rate';
exception when insufficient_privilege then raise notice 'ok - tutors cannot call lesson_tutor_rate';
end $$;
do $$ begin
  perform * from public.lesson_family_price('50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
  raise exception 'tutor called lesson_family_price';
exception when insufficient_privilege then raise notice 'ok - tutors cannot call lesson_family_price';
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select string_agg(enrolment_id::text, ',') from public.enrolment_tutor_pay) = '70000000-0000-0000-0000-000000000002',
  'another tutor sees only their own subject''s pay');

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select string_agg(enrolment_id::text, ',') from public.enrolment_family_price) = '70000000-0000-0000-0000-000000000001',
  'a parent sees their own family''s prices, not another family''s');
select pg_temp.check((select count(*) from public.enrolment_tutor_pay) = 0, 'a parent sees no tutor pay');
update public.enrolment_family_price set hourly_price = 1 where enrolment_id = '70000000-0000-0000-0000-000000000001';
delete from public.enrolment_family_price where enrolment_id = '70000000-0000-0000-0000-000000000001';
select pg_temp.check((select hourly_price from public.enrolment_family_price where enrolment_id = '70000000-0000-0000-0000-000000000001') = 600,
  'a parent cannot change or delete their price');
do $$ begin
  insert into public.enrolment_family_price (enrolment_id, hourly_price) values ('70000000-0000-0000-0000-000000000005', 1);
  raise exception 'parent inserted price';
exception when insufficient_privilege then raise notice 'ok - a parent cannot add a price';
end $$;
do $$ begin
  perform * from public.lesson_family_price('50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
  raise exception 'parent called lesson_family_price';
exception when insufficient_privilege then raise notice 'ok - parents cannot call lesson_family_price';
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000e');
select pg_temp.check((select string_agg(enrolment_id::text, ',') from public.enrolment_family_price) = '70000000-0000-0000-0000-000000000003',
  'the other parent sees only their own family''s price');

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000f');
select pg_temp.check((select count(*) from public.enrolment_tutor_pay) = 0 and (select count(*) from public.enrolment_family_price) = 0,
  'a student sees neither pay nor prices');

reset role;
select pg_temp.check(not has_function_privilege('authenticated', 'public.lesson_tutor_rate(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.lesson_family_price(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.lesson_enrolment(public.lessons, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_enrolment_rates(uuid, numeric, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.set_enrolment_rates(uuid, numeric, numeric)', 'execute'),
  'the rate helpers are private; set_enrolment_rates is for signed-in users (admins only inside)');

-- (c) Which enrolment a lesson counts towards ---------------------------------
select pg_temp.check((select (public.lesson_enrolment(l, 'd0000000-0000-0000-0000-000000000001')).id from public.lessons l
  where l.id = '50000000-0000-0000-0000-000000000003') = '70000000-0000-0000-0000-000000000001', 'a lesson matches the enrolment in its subject, ignoring case and spaces');
select pg_temp.check((select (public.lesson_enrolment(l, 'd0000000-0000-0000-0000-000000000001')).id from public.lessons l
  where l.id = '50000000-0000-0000-0000-000000000002') = '70000000-0000-0000-0000-000000000002', 'a Chemistry lesson matches the Chemistry enrolment');
select pg_temp.check((select (public.lesson_enrolment(l, 'd0000000-0000-0000-0000-000000000002')).id from public.lessons l
  where l.id = '50000000-0000-0000-0000-000000000008') = '70000000-0000-0000-0000-000000000004', 'a lesson without a subject uses the student''s only enrolment');
select pg_temp.check((select (public.lesson_enrolment(l, 'd0000000-0000-0000-0000-000000000004')).id from public.lessons l
  where l.id = '50000000-0000-0000-0000-000000000009') is null, 'a lesson without a subject and two enrolments matches none');
select pg_temp.check((select (public.lesson_enrolment(l, 'd0000000-0000-0000-0000-000000000002')).id from public.lessons l
  where l.id = '50000000-0000-0000-0000-000000000007') is null, 'a subject the student does not study matches none');

-- (d) Charges ------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.complete_lesson('50000000-0000-0000-0000-000000000001', 'completed', '{}', 'Quadratics', null, '{}', '[]', '[]');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select amount || '/' || price_source || '/' || hourly_price || '/' || status from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000001') = '900.00/custom/600.00/unbilled', 'a custom price is charged per hour (90 minutes at 600 is 900)');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.complete_lesson('50000000-0000-0000-0000-000000000002', 'completed', '{}', 'Moles', null, '{}', '[]', '[]');
select pg_temp.check((select amount || '/' || price_source || '/' || coalesce(hourly_price::text, 'none') from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000002') = '450.00/service/none', 'without a custom price the service price is charged');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.complete_lesson('50000000-0000-0000-0000-000000000003', 'completed', '{}', 'Group', null, '{}', '[]', '[]');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select string_agg(amount || '/' || price_source, ',' order by student_id) from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000003') = '600.00/custom,500.00/custom', 'each student in a group is charged their own price');
select pg_temp.check((select description from public.charges where lesson_id = '50000000-0000-0000-0000-000000000001')
  ~ '^IGCSE 1:1 \(Maths\) — Sami Ahmed, \d{4}-\d{2}-\d{2} · 1\.5 hours at the agreed price of AED 600 per hour$',
  'a custom-priced charge names the subject, the hours and the agreed price');
select pg_temp.check((select description from public.charges where lesson_id = '50000000-0000-0000-0000-000000000003'
  and student_id = 'd0000000-0000-0000-0000-000000000001')
  ~ '^Small group \(maths\) — Sami Ahmed, \d{4}-\d{2}-\d{2} · agreed price AED 600 per hour$',
  'a 60-minute custom-priced charge names the agreed price (subject trimmed)');
select pg_temp.check((select description from public.charges where lesson_id = '50000000-0000-0000-0000-000000000002')
  ~ '^IGCSE 1:1 — Sami Ahmed, \d{4}-\d{2}-\d{2}$', 'a service-priced charge keeps its usual description');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.complete_lesson('50000000-0000-0000-0000-000000000007', 'completed', '{}', 'Group', null, '{}', '[]', '[]');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select string_agg(amount || '/' || price_source, ',' order by student_id) from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000007') = '300.00/service,500.00/custom', 'a group mixes service and custom prices');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((public.cancel_lesson('50000000-0000-0000-0000-000000000004', 'Unwell') ->> 'status') = 'late-cancel', 'a late cancellation is chargeable');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select amount || '/' || price_source || '/' || hourly_price from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000004') = '300.00/custom/600.00', 'a late cancellation charges the fee share of the custom price');
reset role;
insert into public.packages (family_id, name, lessons_total, price) values ('c0000000-0000-0000-0000-000000000002', 'Five lessons', 5, 2000);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.complete_lesson('50000000-0000-0000-0000-000000000005', 'completed', '{}', 'Solo', null, '{}', '[]', '[]');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select amount || '/' || status || '/' || price_source || '/' || coalesce(hourly_price::text, 'none') from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000005') = '0.00/package/service/none', 'a package credit is still drawn before a custom price');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.complete_lesson('50000000-0000-0000-0000-000000000006', 'completed', '{}', 'Cover', null, '{}', '[]', '[]');
select pg_temp.check((select amount || '/' || price_source from public.charges
  where lesson_id = '50000000-0000-0000-0000-000000000006') = '600.00/custom', 'the family price follows the student, whoever teaches');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.charges) = 0, 'tutors still cannot see charges');

-- (f) Tutor invoices -----------------------------------------------------------
create temp table ti (id uuid);
grant all on ti to authenticated;
insert into ti select public.create_tutor_invoice('b1000000-0000-0000-0000-000000000001', (date_trunc('month', now()) - interval '1 month')::date);
select pg_temp.check((select i->>'unitPrice' || '/' || (i->>'rateSource') || '/' || (i->>'quantity') from public.tutor_invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from ti) and i->>'lessonId' = '50000000-0000-0000-0000-000000000001') = '300.00/custom/1.50', 'a custom pay line uses the custom rate');
select pg_temp.check((select i->>'unitPrice' || '/' || (i->>'rateSource') from public.tutor_invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from ti) and i->>'lessonId' = '50000000-0000-0000-0000-000000000005') = '180.00/custom', 'custom pay may be below the usual rate');
select pg_temp.check((select i->>'unitPrice' || '/' || (i->>'rateSource') from public.tutor_invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from ti) and i->>'lessonId' = '50000000-0000-0000-0000-000000000003') = '300.00/custom', 'a group lesson pays the highest rate (300 over 180)');
select pg_temp.check((select i->>'unitPrice' || '/' || (i->>'rateSource') from public.tutor_invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from ti) and i->>'lessonId' = '50000000-0000-0000-0000-000000000007') = '200.00/usual', 'a group lesson pays the usual rate when it is the highest');
select pg_temp.check((select bool_and(i ? 'rateSource') from public.tutor_invoices v, jsonb_array_elements(v.items) i where v.id = (select id from ti)),
  'every lesson line says where its rate came from');
select public.submit_tutor_invoice((select id from ti));
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
create temp table ti3 (id uuid);
grant all on ti3 to authenticated;
insert into ti3 select public.create_tutor_invoice('b3000000-0000-0000-0000-000000000003', (date_trunc('month', now()) - interval '1 month')::date);
select pg_temp.check((select i->>'unitPrice' || '/' || (i->>'rateSource') from public.tutor_invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from ti3) and i->>'lessonId' = '50000000-0000-0000-0000-000000000006') = '150.00/usual', 'a cover tutor is paid their own usual rate');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
create temp table ti2 (id uuid);
grant all on ti2 to authenticated;
insert into ti2 select public.create_tutor_invoice('b2000000-0000-0000-0000-000000000002', (date_trunc('month', now()) - interval '1 month')::date);
select pg_temp.check((select i->>'unitPrice' from public.tutor_invoices v, jsonb_array_elements(v.items) i where v.id = (select id from ti2)) = '280.00',
  'Tom''s Chemistry line uses his custom pay');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', 320, 600);
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000002', 260, null);
select pg_temp.check((select i->>'unitPrice' from public.tutor_invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from ti) and i->>'lessonId' = '50000000-0000-0000-0000-000000000001') = '300.00'
  and (select status from public.tutor_invoices where id = (select id from ti)) = 'submitted', 'a submitted invoice keeps its rates');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.create_tutor_invoice('b2000000-0000-0000-0000-000000000002', (date_trunc('month', now()) - interval '1 month')::date);
select pg_temp.check((select i->>'unitPrice' from public.tutor_invoices v, jsonb_array_elements(v.items) i where v.id = (select id from ti2)) = '260.00',
  'rebuilding a draft picks up the new rate');

-- (e) Snapshot of family prices ----------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', 320, 700);
select pg_temp.check((select amount || '/' || hourly_price from public.charges where lesson_id = '50000000-0000-0000-0000-000000000001') = '900.00/600.00',
  'existing charges keep the price they were made with');
create temp table inv (id uuid);
grant all on inv to authenticated;
insert into inv select (public.invoice_unbilled('c0000000-0000-0000-0000-000000000001')).id;
select pg_temp.check((select i->>'unitPrice' from public.invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from inv) and i->>'chargeId' = (select id::text from public.charges where lesson_id = '50000000-0000-0000-0000-000000000001')) = '900.00',
  'the family invoice shows the original amount');
select public.set_enrolment_rates('70000000-0000-0000-0000-000000000001', 320, 800);
select pg_temp.check((select i->>'unitPrice' from public.invoices v, jsonb_array_elements(v.items) i
  where v.id = (select id from inv) and i->>'chargeId' = (select id::text from public.charges where lesson_id = '50000000-0000-0000-0000-000000000001')) = '900.00',
  'changing the price again leaves the invoice unchanged');

-- (g) A new tutor starts on their usual rate -----------------------------------
update public.enrolments set level = 'Extended' where id = '70000000-0000-0000-0000-000000000002';
select pg_temp.check(exists (select 1 from public.enrolment_tutor_pay where enrolment_id = '70000000-0000-0000-0000-000000000002'),
  'editing other details keeps the custom pay');
update public.enrolments set tutor_id = 'b3000000-0000-0000-0000-000000000003' where id = '70000000-0000-0000-0000-000000000002';
select pg_temp.check(not exists (select 1 from public.enrolment_tutor_pay where enrolment_id = '70000000-0000-0000-0000-000000000002'),
  'changing the tutor clears the custom pay');

-- (h) Awarding a role sets the enrolment's tutor and pay -------------------------
insert into public.opportunities (id, title, pay_rate, visibility, student_id, subject, curriculum) values
  ('f0000000-0000-0000-0000-000000000001', 'Ollie IGCSE Maths', 230, 'all', 'd0000000-0000-0000-0000-000000000003', 'maths', 'IGCSE'),
  ('f0000000-0000-0000-0000-000000000002', 'Lina IGCSE Chemistry', 190, 'all', 'd0000000-0000-0000-0000-000000000002', 'Chemistry', 'IGCSE');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.place_bid('f0000000-0000-0000-0000-000000000001', 'I would be glad to teach Ollie.', null);
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b3');
select public.place_bid('f0000000-0000-0000-0000-000000000002', 'Chemistry is my subject.', null);
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.award_opportunity(id) from public.opportunity_bids where opportunity_id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.check((select e.tutor_id || '/' || p.hourly_pay || '/' || p.source || '/' || p.opportunity_id
  from public.enrolments e join public.enrolment_tutor_pay p on p.enrolment_id = e.id where e.id = '70000000-0000-0000-0000-000000000003')
  = 'b2000000-0000-0000-0000-000000000002/230.00/opportunity/f0000000-0000-0000-0000-000000000001', 'awarding a role sets the enrolment''s tutor and pay');
select pg_temp.check((select count(*) from public.enrolments where student_id = 'd0000000-0000-0000-0000-000000000003') = 1, 'no duplicate enrolment is made');
select public.award_opportunity(id) from public.opportunity_bids where opportunity_id = 'f0000000-0000-0000-0000-000000000002';
select pg_temp.check((select e.subject || '/' || e.curriculum || '/' || e.tutor_id || '/' || p.hourly_pay || '/' || p.source
  from public.enrolments e join public.enrolment_tutor_pay p on p.enrolment_id = e.id
  where e.student_id = 'd0000000-0000-0000-0000-000000000002' and e.subject = 'Chemistry')
  = 'Chemistry/IGCSE/b3000000-0000-0000-0000-000000000003/190.00/opportunity', 'awarding a role creates the missing enrolment with its pay');
select pg_temp.check((select status from public.opportunities where id = 'f0000000-0000-0000-0000-000000000002') = 'awarded', 'the role is still marked awarded');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject like 'You''ve been chosen: %') = 2, 'the winning tutors are still told');
