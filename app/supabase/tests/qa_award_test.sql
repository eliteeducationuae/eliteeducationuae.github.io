-- Awarding a role names the subject, and estimated tutor costs for the accountant (20261114000700_qa_award.sql).
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- Boss (admin), tutors Tia, Tom and Cy, the accountant, and Mona (Sami's mother). Sami studies Maths (with Tia) and
-- Chemistry (no tutor yet); Lina studies only English (with Tia).
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b3', 't3@x'),
  ('a0000000-0000-0000-0000-0000000000ac', 'acc@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200), ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250),
  ('b0000000-0000-0000-0000-000000000003', 'Cy Three', 't3@x', 300);
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Lina Ahmed');
insert into public.enrolments (id, student_id, subject, tutor_id) values
  ('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Maths', 'b0000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Chemistry', null),
  ('e1000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'English', 'b0000000-0000-0000-0000-000000000001');
delete from public.profiles;
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null),
  ('a0000000-0000-0000-0000-0000000000b3', 'tutor', 'Cy Three', 't3@x', 'b0000000-0000-0000-0000-000000000003', null),
  ('a0000000-0000-0000-0000-0000000000ac', 'accountant', 'Acc', 'acc@x', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', '1:1', 60, 450);

-- Roles: Sami with no subject (two bids), Sami in Maths, Lina with no subject.
insert into public.opportunities (id, title, pay_rate, student_id, subject) values
  ('f4000000-0000-0000-0000-000000000001', 'Tutor for Sami', 260, 'd0000000-0000-0000-0000-000000000001', null),
  ('f4000000-0000-0000-0000-000000000002', 'Maths for Sami', 240, 'd0000000-0000-0000-0000-000000000001', 'Maths'),
  ('f4000000-0000-0000-0000-000000000003', 'Tutor for Lina', 220, 'd0000000-0000-0000-0000-000000000002', ' ');
insert into public.opportunity_bids (id, opportunity_id, tutor_id, pitch) values
  ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Chemistry is my subject.'),
  ('f5000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'Happy to help.'),
  ('f5000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'Maths specialist.'),
  ('f5000000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'English specialist.');

-- 1. A role with no subject, for a student with several subjects, needs the subject -----------------------------------
select pg_temp.check((select count(*) = 1 from pg_proc where proname = 'award_opportunity' and pronamespace = 'public'::regnamespace
                        and pg_get_function_identity_arguments(oid) = 'p_bid_id uuid, p_subject text'), 'award_opportunity takes the bid and an optional subject');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.err($$select public.award_opportunity('f5000000-0000-0000-0000-000000000001')$$)
                     = '22023: Please choose which subject this role is for: Sami has more than one subject.',
                     'awarding without a subject is refused when the student has more than one subject');
select pg_temp.check(pg_temp.err($$select public.award_opportunity('f5000000-0000-0000-0000-000000000001', 'Physics')$$)
                     = '22023: Please choose one of the student''s current subjects.', 'a subject the student does not study is refused');
reset role;
select pg_temp.check((select status = 'open' and subject is null from public.opportunities where id = 'f4000000-0000-0000-0000-000000000001'),
                     'a refused award leaves the role open and unchanged');
select pg_temp.check(not exists (select 1 from public.handovers), 'a refused award creates no handover');
select pg_temp.check(not exists (select 1 from public.notification_outbox where subject like 'Handover pack:%' or subject like 'You''ve been chosen%'),
                     'and tells nobody that they were chosen or that a pack is ready');

-- 2. Choosing the subject moves that enrolment, and the pack opens ------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.award_opportunity('f5000000-0000-0000-0000-000000000001', ' chemistry ');
reset role;
select pg_temp.check((select status = 'awarded' and subject = 'Chemistry' and awarded_tutor_id = 'b0000000-0000-0000-0000-000000000002'
                        from public.opportunities where id = 'f4000000-0000-0000-0000-000000000001'),
                     'the chosen subject is saved on the role, spelt as the enrolment spells it');
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000002' from public.enrolments where id = 'e1000000-0000-0000-0000-000000000002'),
                     'the Chemistry enrolment moves to the winning tutor');
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000001' from public.enrolments where id = 'e1000000-0000-0000-0000-000000000001'),
                     'the Maths enrolment stays with its tutor');
select pg_temp.check((select hourly_pay = 260 and source = 'opportunity' from public.enrolment_tutor_pay where enrolment_id = 'e1000000-0000-0000-0000-000000000002'),
                     'at the role''s pay');
select pg_temp.check((select count(*) = 1 from public.handovers where reason = 'awarded' and subject = 'Chemistry'
                        and to_tutor_id = 'b0000000-0000-0000-0000-000000000002'), 'the handover names the chosen subject');
select pg_temp.check((select count(*) = 1 from public.notification_outbox where subject = 'Handover pack: Sami Ahmed (Chemistry)'),
                     'the winning tutor is told the Chemistry pack is ready');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select not coalesce((public.handover_pack(id)->>'closed')::boolean, false)
                             and public.handover_pack(id)->'enrolment'->>'id' = 'e1000000-0000-0000-0000-000000000002'
                        from public.handovers where subject = 'Chemistry'), 'and the pack they are told about opens');
reset role;

-- 3. A role that has a subject keeps it ---------------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.err($$select public.award_opportunity('f5000000-0000-0000-0000-000000000003', 'Chemistry')$$)
                     = '22023: This role is already for Maths.', 'a different subject cannot replace the role''s own');
select public.award_opportunity('f5000000-0000-0000-0000-000000000003', 'maths');
-- 4. One subject: no choice is needed (the one-argument call still works) --------------------------------------------
select public.award_opportunity('f5000000-0000-0000-0000-000000000004');
reset role;
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000003' from public.enrolments where id = 'e1000000-0000-0000-0000-000000000001'),
                     'the same subject, in any case, is accepted');
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000002' from public.enrolments where id = 'e1000000-0000-0000-0000-000000000003'),
                     'a student with one subject needs no choice: that enrolment moves');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select not coalesce((public.handover_pack(id)->>'closed')::boolean, false)
                        from public.handovers where student_id = 'd0000000-0000-0000-0000-000000000002' and reason = 'awarded'),
                     'and that pack opens too');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(pg_temp.err($$select public.award_opportunity('f5000000-0000-0000-0000-000000000002', 'Chemistry')$$) like '42501:%',
                     'only admins award roles');
reset role;

-- 5. Estimated tutor costs: monthly totals for admins and the accountant ------------------------------------------------
-- August: Tia 2 x 1h (200), Tom 1.5h (250), and a cancelled lesson. September: Tia 1h, and a late cancellation.
-- Tom has submitted his August invoice; Tia's September invoice is still a draft.
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-08-03 10:00+04', '2026-08-03 11:00+04', 'online', 'completed', 'Maths'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-08-31 23:00+04', '2026-09-01 00:00+04', 'online', 'no-show', 'Maths'),
  ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   '2026-08-05 10:00+04', '2026-08-05 11:30+04', 'online', 'completed', 'Physics'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-08-07 10:00+04', '2026-08-07 11:00+04', 'online', 'cancelled', 'Maths'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-09-02 10:00+04', '2026-09-02 11:00+04', 'online', 'completed', 'Maths'),
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-09-09 10:00+04', '2026-09-09 11:00+04', 'online', 'late-cancel', 'Maths');
-- Lina's English enrolment now belongs to Tom, so Tia's lessons for her are paid at Tia's usual 200.
insert into public.tutor_invoices (tutor_id, number, period_start, period_end, status) values
  ('b0000000-0000-0000-0000-000000000002', 'TI-202608-TOM', '2026-08-01', '2026-08-31', 'submitted'),
  ('b0000000-0000-0000-0000-000000000001', 'TI-202609-TIA', '2026-09-01', '2026-09-30', 'draft');
update public.settings set pay_tutor_for_late_cancel = false where id = 1;

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000ac');
select pg_temp.check((select array_agg(to_char(month, 'YYYY-MM') || '=' || amount::text order by month)
                        from public.tutor_cost_estimates('2026-07-15', '2026-10-01'))
                     = '{2026-07=0,2026-08=400.00,2026-09=200.00,2026-10=0}',
                     'the accountant reads monthly estimates: uninvoiced paid lessons only, a submitted invoice''s month left out');
select pg_temp.check((select pg_get_function_result(oid) = 'TABLE(month date, amount numeric)' from pg_proc where proname = 'tutor_cost_estimates'),
                     'it returns the month and a total only: no lesson, student or tutor detail');
reset role;
update public.settings set pay_tutor_for_late_cancel = true where id = 1;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select amount = 400 from public.tutor_cost_estimates('2026-09-01', '2026-09-30')),
                     'an admin reads them too, and paid late cancellations count when the setting says so');
select pg_temp.check(pg_temp.err($$select * from public.tutor_cost_estimates('2026-09-01', '2026-07-01')$$) = '22023: Please choose a valid range of months.',
                     'a backwards range is refused');
select pg_temp.check(pg_temp.err($$select * from public.tutor_cost_estimates('2023-01-01', '2026-01-01')$$) = '22023: Please choose at most 36 months.',
                     'at most 36 months');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check(pg_temp.err($$select * from public.tutor_cost_estimates('2026-08-01', '2026-09-30')$$) like '42501:%', 'tutors cannot read them');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.err($$select * from public.tutor_cost_estimates('2026-08-01', '2026-09-30')$$) like '42501:%', 'parents cannot read them');
reset role;
set role anon;
select pg_temp.check(pg_temp.err($$select * from public.tutor_cost_estimates('2026-08-01', '2026-09-30')$$) like '42501:%', 'anonymous visitors cannot call it');
reset role;
select pg_temp.check('tutor_cost_estimates' = any (public.view_as_read_rpcs()) and 'handover_pack' = any (public.view_as_read_rpcs())
                     and not ('award_opportunity' = any (public.view_as_read_rpcs())),
                     'View as may call the estimates (a read), keeps the round 5 reads, and may not award roles');

-- 6. Ledger ------------------------------------------------------------------------------------------------------------
select pg_temp.check(exists (select 1 from public.db_migrations where version = '20261114000700' and name = 'qa_award'),
                     'the migrations ledger records this file');
\echo 'All QA award tests passed'
