-- Tutor vetting and onboarding: police clearance, enforcement, overrides, expiry alerts, handbook and hiring.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
-- Runs q and expects it to fail with a message matching the LIKE pattern.
create function pg_temp.fails(q text, pattern text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm like pattern then raise notice 'ok - %', label; return; end if;
    raise exception 'FAILED: % (unexpected error: %)', label, sqlerrm;
  end;
  raise exception 'FAILED: % (no error raised)', label;
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Dubai')::date $$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000b1', 't1@x'),
  ('a0000000-0000-0000-0000-0000000000b2', 't2@x'), ('a0000000-0000-0000-0000-0000000000b5', 't5@x'),
  ('a0000000-0000-0000-0000-0000000000b6', 't6@x'), ('a0000000-0000-0000-0000-00000000000c', 'mum@x'),
  ('a0000000-0000-0000-0000-00000000000d', 'kid@x');
insert into public.tutors (id, full_name, email, hourly_pay) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 't1@x', 200),
  ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 't2@x', 250),
  ('b0000000-0000-0000-0000-000000000003', 'Cara Three', 't3@x', 200),
  ('b0000000-0000-0000-0000-000000000004', 'Dan Four', 't4@x', 200),
  ('b0000000-0000-0000-0000-000000000005', 'Eve Five', 't5@x', 200),
  ('b0000000-0000-0000-0000-000000000006', 'Fay Six', 't6@x', 200),
  ('b0000000-0000-0000-0000-000000000007', 'Gus Seven', 't7@x', 200);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB', 'ib-aa-sl');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 't1@x', 'b0000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-0000000000b2', 'tutor', 'Tom Two', 't2@x', 'b0000000-0000-0000-0000-000000000002', null, null),
  ('a0000000-0000-0000-0000-0000000000b5', 'tutor', 'Eve Five', 't5@x', 'b0000000-0000-0000-0000-000000000005', null, null),
  ('a0000000-0000-0000-0000-0000000000b6', 'tutor', 'Fay Six', 't6@x', 'b0000000-0000-0000-0000-000000000006', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000d', 'student', 'Sami Ahmed', 'kid@x', null, null, 'd0000000-0000-0000-0000-000000000001');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
-- Tom is cleared: a verified certificate valid for over a year.
insert into public.tutor_documents (tutor_id, doc_type, file_path, status, issue_date, expiry_date, verified_at)
values ('b0000000-0000-0000-0000-000000000002', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000002/pcc.pdf', 'verified',
        pg_temp.today() - 30, pg_temp.today() + 400, now());
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set role authenticated;

-- 1. Enforcement off ---------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(not (select vetting_enforced from public.settings), 'enforcement is off by default');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000001') = 'missing', 'Tia has no clearance yet');
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 1 hour', 'online'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 1 hour', 'online');
select pg_temp.check((select count(*) from public.lessons) = 2, 'with enforcement off an uncleared tutor can be given a lesson');
insert into public.opportunities (id, title, pay_rate, visibility) values ('f0000000-0000-0000-0000-000000000001', 'Year 12 IB AA HL', 220, 'all');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select public.place_bid('f0000000-0000-0000-0000-000000000001', 'I teach AA HL.', null);

-- 2. Switching enforcement on ------------------------------------------------
select pg_temp.fails($q$select public.set_vetting_enforced(true)$q$, 'Admins only', 'tutors cannot switch enforcement on');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_vetting_enforced(true);
select pg_temp.check((select vetting_enforced from public.settings), 'admin switches enforcement on');

-- 3. What is blocked and what is not -----------------------------------------
select pg_temp.fails($q$insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '5 days', now() + interval '5 days 1 hour', 'online')$q$,
  'Police clearance required: Tia One cannot be assigned new lessons until their police clearance has been verified. An administrator can record an override with a reason.',
  'a new lesson for an uncleared tutor is blocked with the agreed message');
select pg_temp.fails($q$insert into public.enrolments (student_id, subject, tutor_id) values
  ('d0000000-0000-0000-0000-000000000001', 'Physics', 'b0000000-0000-0000-0000-000000000001')$q$,
  'Police clearance required: Tia One cannot be given new students%', 'a new enrolment with an uncleared tutor is blocked');
select pg_temp.fails($q$select public.award_opportunity((select id from public.opportunity_bids where tutor_id = 'b0000000-0000-0000-0000-000000000001'))$q$,
  'Police clearance required: Tia One cannot be awarded roles%', 'awarding a role to an uncleared tutor is blocked');
select pg_temp.check((select status from public.opportunities where id = 'f0000000-0000-0000-0000-000000000001') = 'open', 'the blocked award changed nothing');
select pg_temp.fails($q$select public.reassign_lesson('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001')$q$,
  'Police clearance required%', 'reassigning a lesson to an uncleared tutor is blocked');
update public.lessons set start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.lessons where id = '10000000-0000-0000-0000-000000000001' and start_at > now() + interval '2 days 30 minutes') = 1,
  'an uncleared tutor''s existing lesson can still be rescheduled');
update public.lessons set status = 'completed' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select status from public.lessons where id = '10000000-0000-0000-0000-000000000001') = 'completed', 'and completed');
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000002', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '6 days', now() + interval '6 days 1 hour', 'online');
select pg_temp.check((select count(*) from public.lessons where tutor_id = 'b0000000-0000-0000-0000-000000000002') = 2, 'a cleared tutor can be given new lessons');
insert into public.enrolments (student_id, subject, tutor_id) values ('d0000000-0000-0000-0000-000000000001', 'Chemistry', 'b0000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from public.enrolments where subject = 'Chemistry' and tutor_id = 'b0000000-0000-0000-0000-000000000002') = 1, 'a cleared tutor can be given new students');

-- 4. Tutors upload; only admins verify ---------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
insert into ids select 'tia', public.submit_tutor_document('b0000000-0000-0000-0000-000000000001', 'police_clearance',
  'tutors/b0000000-0000-0000-0000-000000000001/pcc.pdf', 'pcc.pdf', 'Dubai Police certificate', pg_temp.today() - 10);
select pg_temp.check((select status from public.tutor_documents where id = (select id from ids where name = 'tia')) = 'pending', 'a tutor''s upload starts as pending');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000001') = 'pending', 'Tia is now pending');
select pg_temp.fails($q$select public.submit_tutor_document('b0000000-0000-0000-0000-000000000002', 'police_clearance',
  'tutors/b0000000-0000-0000-0000-000000000002/x.pdf')$q$, 'You can only upload your own documents', 'tutors cannot upload for another tutor');
select pg_temp.fails($q$select public.submit_tutor_document('b0000000-0000-0000-0000-000000000001', 'police_clearance',
  'tutors/b0000000-0000-0000-0000-000000000002/x.pdf')$q$, 'The file was not uploaded to the right place%', 'the file must be in the tutor''s own folder');
select pg_temp.fails($q$select public.submit_tutor_document('b0000000-0000-0000-0000-000000000001', 'tax_return',
  'tutors/b0000000-0000-0000-0000-000000000001/x.pdf')$q$, 'Please choose the type of document', 'unknown document types are refused');
select pg_temp.fails($q$select public.submit_tutor_document('b0000000-0000-0000-0000-000000000001', 'police_clearance',
  'tutors/b0000000-0000-0000-0000-000000000001/x.pdf', null, null, current_date + 30)$q$, 'The issue date cannot be in the future', 'issue dates cannot be in the future');
select pg_temp.fails($q$update public.tutor_documents set status = 'verified' where tutor_id = 'b0000000-0000-0000-0000-000000000001'$q$,
  'permission denied%', 'tutors cannot mark their own document verified');
select pg_temp.fails($q$insert into public.tutor_documents (tutor_id, doc_type, file_path, status, expiry_date)
  values ('b0000000-0000-0000-0000-000000000001', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000001/y.pdf', 'verified', current_date + 300)$q$,
  'permission denied%', 'tutors cannot insert documents directly');
select pg_temp.fails($q$select public.review_tutor_document((select id from ids where name = 'tia'), true, null, current_date + 300)$q$,
  'Admins only', 'tutors cannot verify documents');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Document to review: Tia One'
  and profile_id = 'a0000000-0000-0000-0000-00000000000a' and url = '/manage/vetting/b0000000-0000-0000-0000-000000000001') = 1,
  'the office is told there is a document to review');
set role authenticated;

-- 5. Admin verifies -----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.fails($q$select public.review_tutor_document((select id from ids where name = 'tia'), true)$q$,
  'Please enter the expiry date before verifying', 'a police clearance needs an expiry date to be verified');
select pg_temp.fails($q$select public.review_tutor_document((select id from ids where name = 'tia'), true, null, current_date - 2)$q$,
  'This certificate has already expired%', 'an expired certificate cannot be verified');
select pg_temp.fails($q$select public.review_tutor_document((select id from ids where name = 'tia'), false, null, null, '  ')$q$,
  'Please give a reason%', 'rejecting needs a reason');
select public.review_tutor_document((select id from ids where name = 'tia'), true, null, pg_temp.today() + 200, 'Checked against the original');
select pg_temp.check((select status = 'verified' and verified_by = 'a0000000-0000-0000-0000-00000000000a' and verified_by_name = 'Boss'
  and verified_at is not null and expiry_date = pg_temp.today() + 200 and issue_date = pg_temp.today() - 10
  from public.tutor_documents where id = (select id from ids where name = 'tia')), 'verifying records who verified it and when');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000001') = 'cleared', 'Tia is cleared');
select pg_temp.check(public.tutor_is_cleared('b0000000-0000-0000-0000-000000000001'), 'tutor_is_cleared agrees');
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '5 days', now() + interval '5 days 1 hour', 'online');
select pg_temp.check((select count(*) from public.lessons where tutor_id = 'b0000000-0000-0000-0000-000000000001') = 2, 'once verified Tia can be given new lessons');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b1'
  and subject = 'Your police clearance has been verified' and url = '/checks' and body like '%Elite Education | eliteeducation.me') = 1,
  'the tutor is told their clearance is verified');
set role authenticated;

-- 6. Status from dates ---------------------------------------------------------
reset role;
insert into public.tutor_documents (tutor_id, doc_type, file_path, status, expiry_date, verified_at) values
  ('b0000000-0000-0000-0000-000000000003', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000003/old.pdf', 'verified', pg_temp.today() + 100, now()),
  ('b0000000-0000-0000-0000-000000000003', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000003/pcc.pdf', 'verified', pg_temp.today() + 300, now()),
  ('b0000000-0000-0000-0000-000000000004', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000004/bad.pdf', 'rejected', null, null),
  ('b0000000-0000-0000-0000-000000000007', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000007/new.pdf', 'pending', null, null);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000003', pg_temp.today() + 300) = 'expiring', 'valid on the expiry date itself');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000003', pg_temp.today() + 301) = 'expired', 'expired the day after');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000003', pg_temp.today() + 240) = 'expiring', 'expiring with exactly 60 days left');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000003', pg_temp.today() + 239) = 'cleared', 'cleared with 61 days left');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000003', pg_temp.today() + 150) = 'cleared', 'the latest certificate counts, not an older one');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000004') = 'missing', 'a rejected certificate counts as missing');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000007') = 'pending', 'a pending certificate alone is pending');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select public.submit_tutor_document('b0000000-0000-0000-0000-000000000002', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000002/renewal.pdf');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000002') = 'cleared', 'a newer pending upload does not downgrade a cleared tutor');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000001') is null, 'tutors cannot see another tutor''s status');

-- 7. Overrides -----------------------------------------------------------------
select pg_temp.fails($q$select public.grant_vetting_override('b0000000-0000-0000-0000-000000000004', 'Certificate applied for, receipt seen')$q$,
  'Admins only', 'tutors cannot record overrides');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.fails($q$select public.grant_vetting_override('b0000000-0000-0000-0000-000000000004', '')$q$,
  'Please give a reason of at least 10 characters for the override', 'an override needs a reason');
select pg_temp.fails($q$select public.grant_vetting_override('b0000000-0000-0000-0000-000000000004', 'short')$q$,
  'Please give a reason of at least 10 characters for the override', 'a short reason is refused');
select pg_temp.fails($q$select public.grant_vetting_override('b0000000-0000-0000-0000-000000000004', 'Certificate applied for, receipt seen', 120)$q$,
  'An override can last between 1 and 90 days', 'overrides last at most 90 days');
select pg_temp.fails($q$insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000004', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '8 days', now() + interval '8 days 1 hour', 'online')$q$, 'Police clearance required: Dan Four%', 'Dan is blocked');
insert into ids select 'override', public.grant_vetting_override('b0000000-0000-0000-0000-000000000004', 'Certificate applied for, receipt seen', 14);
select pg_temp.check((select created_by = 'a0000000-0000-0000-0000-00000000000a' and created_by_name = 'Boss'
  and reason = 'Certificate applied for, receipt seen' and expires_at > now() + interval '13 days' and expires_at < now() + interval '15 days'
  from public.tutor_vetting_overrides where id = (select id from ids where name = 'override')), 'the override records who, why and until when');
insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000004', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '8 days', now() + interval '8 days 1 hour', 'online');
select pg_temp.check((select count(*) from public.lessons where tutor_id = 'b0000000-0000-0000-0000-000000000004') = 1, 'an override lets the lesson through');
select pg_temp.check((select override_id from public.tutor_compliance() where tutor_id = 'b0000000-0000-0000-0000-000000000004')
  = (select id from ids where name = 'override'), 'the checklist shows the active override');
select public.revoke_vetting_override((select id from ids where name = 'override'));
select pg_temp.check((select revoked_by_name from public.tutor_vetting_overrides where id = (select id from ids where name = 'override')) = 'Boss',
  'revoking records who revoked it');
select pg_temp.fails($q$insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000004', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '9 days', now() + interval '9 days 1 hour', 'online')$q$, 'Police clearance required%', 'after revoking Dan is blocked again');
reset role;
insert into public.tutor_vetting_overrides (tutor_id, reason, created_at, expires_at)
values ('b0000000-0000-0000-0000-000000000004', 'An old override that has ended', now() - interval '20 days', now() - interval '1 day');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Clearance override recorded for Dan Four'
  and body like '%Certificate applied for, receipt seen%' and body like 'Boss recorded%') >= 1, 'the office is told who recorded the override and why');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.fails($q$insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('b0000000-0000-0000-0000-000000000004', '{d0000000-0000-0000-0000-000000000001}', 'e0000000-0000-0000-0000-000000000001',
   now() + interval '9 days', now() + interval '9 days 1 hour', 'online')$q$, 'Police clearance required%', 'an expired override does not count');

-- 8. Who sees what ---------------------------------------------------------------
reset role;
insert into public.tutor_payment_details (tutor_id, account_name, bank_name, iban)
values ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 'Emirates NBD', 'AE070331234567890123456');
insert into public.availability (tutor_id, weekday, start_time, end_time) values ('b0000000-0000-0000-0000-000000000002', 1, '16:00', '19:00');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public.tutor_documents) = 2
  and not exists (select 1 from public.tutor_documents where tutor_id <> 'b0000000-0000-0000-0000-000000000002'), 'tutors see only their own documents');
select pg_temp.check((select count(*) from public.tutor_vetting_overrides) = 0, 'tutors do not see other tutors'' overrides');
select pg_temp.check((select count(*) from public.tutor_compliance()) = 1, 'a tutor''s checklist has only their own row');
select pg_temp.check((select tutor_id = 'b0000000-0000-0000-0000-000000000002' and bank_details and availability_set and not calendar_connected
  and not whatsapp_opt_in and vetting_status = 'cleared' and documents_pending = 1 and enforced and handbook_version = 1
  and handbook_acknowledged_version is null from public.tutor_compliance()), 'the checklist flags are right');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select not bank_details and not availability_set and clearance_expiry = pg_temp.today() + 200 from public.tutor_compliance()),
  'another tutor''s checklist shows what is missing');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.tutor_compliance()) = (select count(*) from public.tutors), 'admin sees every tutor''s checklist');
select pg_temp.check((select count(*) from public.tutor_documents) = 7, 'admin sees every document');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.tutor_documents) + (select count(*) from public.tutor_vetting_overrides)
  + (select count(*) from public.handbook_versions) + (select count(*) from public.handbook_acknowledgements)
  + (select count(*) from public.tutor_compliance()) = 0, 'parents see no vetting data');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000002') is null, 'parents cannot read a tutor''s status');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.tutor_documents) + (select count(*) from public.tutor_vetting_overrides)
  + (select count(*) from public.handbook_versions) + (select count(*) from public.handbook_acknowledgements)
  + (select count(*) from public.tutor_compliance()) = 0, 'students see no vetting data');
select pg_temp.fails($q$select count(*) from public.tutor_document_alerts$q$, 'permission denied%', 'expiry alert records are server-only');
select pg_temp.fails($q$select public.queue_vetting_alerts()$q$, 'permission denied%', 'only the server queues expiry alerts');
reset role;
set role anon;
select pg_temp.fails($q$select count(*) from public.tutor_documents$q$, 'permission denied%', 'the public cannot read documents');
select pg_temp.as_user('');
select pg_temp.fails($q$select public.tutor_vetting_status('b0000000-0000-0000-0000-000000000002')$q$, 'permission denied%',
  'anonymous callers cannot read a tutor''s vetting status');
select pg_temp.fails($q$select public.tutor_is_cleared('b0000000-0000-0000-0000-000000000002')$q$, 'permission denied%',
  'anonymous callers cannot ask whether a tutor is cleared');
reset role;
select pg_temp.check(not has_function_privilege('anon', 'public.tutor_vetting_status(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.tutor_is_cleared(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.publish_handbook(text, text)', 'execute'), 'no vetting function is executable by anon');
-- Even if granted, a request with no signed-in user is not treated as trusted server context.
set role authenticated;
select pg_temp.as_user('');
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000002') is null, 'a request with no user sees no status');
select pg_temp.check(public.tutor_is_cleared('b0000000-0000-0000-0000-000000000002') is null, 'a request with no user sees no clearance');
select set_config('request.jwt.claim.role', 'service_role', false);
select pg_temp.check(public.tutor_vetting_status('b0000000-0000-0000-0000-000000000002') = 'cleared', 'the service role sees the status');
select set_config('request.jwt.claim.role', '', false);
reset role;

-- 9. Expiry alerts -----------------------------------------------------------------
select pg_temp.as_user('');
insert into public.tutor_payment_details (tutor_id, account_name, bank_name, iban)
values ('b0000000-0000-0000-0000-000000000005', 'Eve Five', 'Emirates NBD', 'AE070331234567890123456');
insert into public.tutor_documents (id, tutor_id, doc_type, file_path, status, expiry_date, verified_at) values
  ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000005', 'police_clearance',
   'tutors/b0000000-0000-0000-0000-000000000005/old.pdf', 'verified', pg_temp.today() + 10, now() - interval '1 year'),
  ('20000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000005', 'police_clearance',
   'tutors/b0000000-0000-0000-0000-000000000005/pcc.pdf', 'verified', pg_temp.today() + 25, now());
select pg_temp.check(public.queue_vetting_alerts(now()) = 1, 'a certificate with 25 days left is alerted');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b5'
  and subject = 'Police clearance expires in 25 days' and url = '/checks'
  and body like '%' || to_char(pg_temp.today() + 25, 'FMDD FMMonth YYYY') || '%' and body like '%upload a renewed certificate%') = 1,
  'the tutor is asked to upload a renewed certificate, with the date in words');
select pg_temp.check(to_char(pg_temp.today() + 25, 'FMDD FMMonth YYYY') ~ '^[0-9]{1,2} [A-Z][a-z]+ [0-9]{4}$', 'dates read like 3 November 2026');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-00000000000a'
  and subject = 'Police clearance expires in 25 days: Eve Five' and url = '/manage/vetting/b0000000-0000-0000-0000-000000000005') = 1,
  'the office is told too');
select pg_temp.check((select array_agg(threshold order by threshold) from public.tutor_document_alerts
  where document_id = '20000000-0000-0000-0000-000000000002') = '{30,60}', 'the 60 and 30 day alerts are recorded');
select pg_temp.check(not exists (select 1 from public.tutor_document_alerts where document_id = '20000000-0000-0000-0000-000000000001'),
  'a superseded certificate gets no alerts');
select pg_temp.check(public.queue_vetting_alerts(now()) = 0, 'running again sends nothing');
select pg_temp.check(public.queue_vetting_alerts(now() + interval '19 days') = 1, 'with 6 days left the 7 day alert goes');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'Police clearance expires in 6 days'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b5'), 'the 7 day alert names the days left');
select pg_temp.check(public.queue_vetting_alerts(now() + interval '19 days') = 0, 'and only once');
select pg_temp.check(public.queue_vetting_alerts(now() + interval '25 days') = 1, 'on the expiry date the final alert goes');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Police clearance expires today'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b5' and body like '%From tomorrow, no new lessons can be assigned to you until a renewed certificate has been verified%') = 1,
  'on the expiry date the message says lessons stop from tomorrow, since the certificate is still valid today');
select pg_temp.check(public.queue_vetting_alerts(now() + interval '30 days') = 0, 'nothing more after expiry');
select pg_temp.check(not exists (select 1 from public.tutor_document_alerts where document_id = '20000000-0000-0000-0000-000000000001'),
  'the superseded certificate still gets nothing');
insert into public.tutor_documents (id, tutor_id, doc_type, file_path, status, expiry_date, verified_at) values
  ('20000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000006', 'police_clearance',
   'tutors/b0000000-0000-0000-0000-000000000006/pcc.pdf', 'verified', pg_temp.today() + 5, now());
select pg_temp.check(public.queue_vetting_alerts(now()) = 1, 'a certificate verified with 5 days left is alerted');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b6' and subject like 'Police clearance%') = 1,
  'with a single message');
select pg_temp.check((select array_agg(threshold order by threshold) from public.tutor_document_alerts
  where document_id = '20000000-0000-0000-0000-000000000003') = '{7,30,60}', 'and the 60, 30 and 7 day alerts are all recorded');
-- Fay uploads her renewal; the expiry-day alert thanks her rather than asking again.
insert into public.tutor_documents (tutor_id, doc_type, file_path, status)
values ('b0000000-0000-0000-0000-000000000006', 'police_clearance', 'tutors/b0000000-0000-0000-0000-000000000006/renewal.pdf', 'pending');
select pg_temp.check(public.queue_vetting_alerts(now() + interval '5 days') = 1, 'the expiry-day alert still goes when a renewal is pending');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-0000000000b6'
  and subject = 'Police clearance expires today' and body like '%Thank you for uploading your renewed certificate; we will review it shortly.%'
  and body not like '%Please upload%') = 1, 'a tutor with a renewal awaiting review is thanked, not asked to upload again');
select pg_temp.check((select count(*) from public.notification_outbox where profile_id = 'a0000000-0000-0000-0000-00000000000a'
  and subject = 'Police clearance expires today: Fay Six' and body like '%A renewal has been uploaded and is awaiting review.%Elite Education | eliteeducation.me') = 1,
  'the office is told a renewal is awaiting review');
delete from public.tutor_documents where file_path = 'tutors/b0000000-0000-0000-0000-000000000006/renewal.pdf';
select pg_temp.check(not exists (select 1 from public.notification_outbox
  where body like '%AE0703312345%' or body ~ '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}' or body like '%tutors/%'
     or push_body like '%tutors/%' or subject like '%tutors/%'),
  'no notification contains bank details or file paths');

-- 10. Handbook ----------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select title from public.handbook_versions where version = 1) = 'Elite Education Tutor Handbook'
  and (select body from public.handbook_versions where version = 1) like '# Elite Education Tutor Handbook%Excellence. Discretion. Results.**',
  'version 1 of the handbook is in place');
select pg_temp.fails($q$select public.publish_handbook('Mine', 'My rules')$q$, 'Admins only', 'tutors cannot publish the handbook');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.fails($q$select public.publish_handbook('  ', 'Body')$q$, 'Please give the handbook a title%', 'the handbook needs a title');
select pg_temp.check(public.publish_handbook('Elite Education Tutor Handbook', '# Handbook' || E'\n\nUpdated safeguarding section.') = 2, 'publishing creates version 2');
select pg_temp.check((select published_by_name from public.handbook_versions where version = 2) = 'Boss', 'the publisher is recorded');
reset role;
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Updated tutor handbook' and url = '/handbook') = 4,
  'every tutor with a login is asked to acknowledge it');
select pg_temp.check((select count(*) from public.notification_outbox where subject = 'Updated tutor handbook'
  and profile_id = 'a0000000-0000-0000-0000-0000000000b1' and body like 'Dear Tia,%version 2%') = 1, 'tutors are addressed by first name');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($q$select public.acknowledge_handbook(1)$q$, 'Please acknowledge the current version of the handbook', 'an old version cannot be acknowledged');
select public.acknowledge_handbook(2);
select public.acknowledge_handbook(2);
select pg_temp.check((select count(*) from public.handbook_acknowledgements) = 1
  and (select profile_id from public.handbook_acknowledgements) = 'a0000000-0000-0000-0000-0000000000b1', 'acknowledging is recorded once');
select pg_temp.check((select handbook_acknowledged_version = 2 and handbook_version = 2 from public.tutor_compliance()), 'the checklist shows the handbook acknowledged');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.fails($q$select public.acknowledge_handbook(2)$q$, 'Only tutors acknowledge the handbook', 'parents cannot acknowledge the handbook');

-- 11. Hiring starts onboarding ----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.tutor_applications (id, full_name, email) values ('30000000-0000-0000-0000-000000000001', 'Dan Four', 't4@x');
select pg_temp.check((select onboarding_started_at from public.tutors where id = 'b0000000-0000-0000-0000-000000000004') is null, 'onboarding has not started');
update public.tutor_applications set status = 'hired', tutor_id = 'b0000000-0000-0000-0000-000000000004' where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check((select onboarding_started_at from public.tutors where id = 'b0000000-0000-0000-0000-000000000004') is not null, 'hiring starts onboarding');

-- Tidying up: tutors remove only unverified documents.
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($q$select public.delete_tutor_document((select id from ids where name = 'tia'))$q$,
  'Verified documents can only be removed by Elite Education', 'tutors cannot remove a verified document');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b2');
select pg_temp.check(public.delete_tutor_document((select id from public.tutor_documents where status = 'pending'))
  = 'tutors/b0000000-0000-0000-0000-000000000002/renewal.pdf', 'tutors remove a pending upload and get its path back');
reset role;
\echo 'All vetting tests passed'
