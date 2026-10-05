-- Audit log: what is recorded, what is hidden, who can read it, and that nobody can change it.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
-- The newest event for a table (read as the owner, so RLS never hides it).
create function pg_temp.last(p_table text) returns public.audit_events language sql as $$
  select * from public.audit_events where table_name = p_table order by at desc, id desc limit 1
$$;
create function pg_temp.n(p_table text) returns bigint language sql as $$
  select count(*) from public.audit_events where table_name = p_table
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x');
insert into public.tutors (id, full_name, email, hourly_pay) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x', 150);
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x'),
  ('c0000000-0000-0000-0000-000000000002', 'Other', 'Otto Other', 'other@x');
insert into public.students (id, family_id, full_name, curriculum, syllabus_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sara Ahmed', 'IB', 'ib-aa-hl'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Omar Other', 'IB', 'ib-aa-hl');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-00000000000b', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);

select pg_temp.check(pg_temp.n('families') = 2 and pg_temp.n('students') = 2 and pg_temp.n('tutors') = 1,
  'seed inserts are recorded');
select pg_temp.check((select actor_role = 'system' and actor_name is null and actor_id is null from pg_temp.last('services')),
  'a write with no signed-in user is recorded as the system');
select pg_temp.check((select family_ids = '{c0000000-0000-0000-0000-000000000001}' and student_ids = '{d0000000-0000-0000-0000-000000000001}'
  from public.audit_events where table_name = 'students' and row_id = 'd0000000-0000-0000-0000-000000000001'),
  'a student insert is filed under the student and their family');
select pg_temp.check(pg_temp.n('profiles') = 0, 'profiles are not audited');

-- Lessons -------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000002}', 'e0000000-0000-0000-0000-000000000001',
   '2026-11-02 10:00+04', '2026-11-02 11:00+04', 'online');
reset role;
select pg_temp.check(pg_temp.n('lessons') = 1, 'one event for a new lesson');
select pg_temp.check((select action = 'insert' and actor_name = 'Boss' and actor_role = 'admin'
    and actor_id = 'a0000000-0000-0000-0000-00000000000a' and row_id = 'f0000000-0000-0000-0000-000000000001'
    and before is null and after->>'location' = 'online'
    and family_ids @> '{c0000000-0000-0000-0000-000000000001,c0000000-0000-0000-0000-000000000002}' and cardinality(family_ids) = 2
    and student_ids = '{d0000000-0000-0000-0000-000000000001,d0000000-0000-0000-0000-000000000002}'
    and tutor_id = 'b0000000-0000-0000-0000-000000000001'
  from pg_temp.last('lessons')), 'the insert names the admin and files the group lesson under both families');
select pg_temp.check((select not (after ? 'reminded_at') and not (after ? 'whatsapp_reminded_at') from pg_temp.last('lessons')),
  'ignored columns are never stored');

set role authenticated;
update public.lessons set start_at = '2026-11-03 10:00+04', end_at = '2026-11-03 11:00+04' where id = 'f0000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.check(pg_temp.n('lessons') = 2, 'a reschedule is one update event');
select pg_temp.check((select action = 'update'
    and (select array_agg(k order by k) from jsonb_object_keys(before) k) = array['end_at', 'start_at']
    and (select array_agg(k order by k) from jsonb_object_keys(after) k) = array['end_at', 'start_at']
    and (before->>'start_at')::timestamptz = '2026-11-02 10:00+04' and (after->>'start_at')::timestamptz = '2026-11-03 10:00+04'
    and (after->>'end_at')::timestamptz = '2026-11-03 11:00+04'
  from pg_temp.last('lessons')), 'the update stores only the changed start and end');

update public.lessons set reminded_at = now(), whatsapp_reminded_at = now() where id = 'f0000000-0000-0000-0000-000000000001';
update public.lessons set start_at = start_at where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.n('lessons') = 2, 'reminder stamps and no-op updates create no event');

-- The tutor records the lesson -------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select public.complete_lesson('f0000000-0000-0000-0000-000000000001', 'completed', '{}', 'Integration by parts', 'Needs confidence',
  '{}', '[]', '[{"studentId":"d0000000-0000-0000-0000-000000000001","title":"Exercise 4B","dueDate":"2026-11-10"}]');
reset role;
select pg_temp.check((select action = 'insert' and actor_role = 'tutor' and actor_name = 'Tia Tutor'
    and row_id = 'f0000000-0000-0000-0000-000000000001' and related_ids = '{f0000000-0000-0000-0000-000000000001}'
    and tutor_id = 'b0000000-0000-0000-0000-000000000001' and cardinality(family_ids) = 2
    and after->>'summary' = 'Integration by parts'
  from pg_temp.last('lesson_notes')), 'lesson notes are filed under the lesson, by the tutor');
select pg_temp.check((select context->>'subject' = 'IB 1:1' and (context->>'lesson_start')::timestamptz = '2026-11-03 10:00+04'
  from pg_temp.last('lesson_notes')), 'lesson notes carry the lesson subject and start as context');
select pg_temp.check((select after->>'status' = 'completed' and actor_role = 'tutor' from pg_temp.last('lessons')),
  'the status change made inside complete_lesson is attributed to the tutor');
select pg_temp.check((select count(*) from public.audit_events where before::text like '%Needs confidence%' or after::text like '%Needs confidence%') = 0,
  'private tutor notes are never recorded');
select pg_temp.check((select related_ids = '{f0000000-0000-0000-0000-000000000001}' and student_ids = '{d0000000-0000-0000-0000-000000000001}'
    and family_ids = '{c0000000-0000-0000-0000-000000000001}' and tutor_id = 'b0000000-0000-0000-0000-000000000001'
  from pg_temp.last('homework')), 'homework is filed under its student, family, tutor and lesson');
select pg_temp.check(pg_temp.n('charges') = 2
  and (select bool_and(related_ids = '{f0000000-0000-0000-0000-000000000001}' and cardinality(family_ids) = 1)
       from public.audit_events where table_name = 'charges'), 'each charge is filed under its family and lesson');

-- Invoicing and payment --------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.invoice_unbilled('c0000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.check(pg_temp.n('settings') = 0, 'taking the next invoice number creates no settings event');
select pg_temp.check((select family_ids = '{c0000000-0000-0000-0000-000000000001}' and action = 'insert' from pg_temp.last('invoices')),
  'a new invoice is filed under its family');
select pg_temp.check((select related_ids @> array[(select id from public.invoices limit 1)] and cardinality(related_ids) = 2
  from pg_temp.last('charges')), 'an invoiced charge is related to its lesson and invoice');
set role authenticated;
insert into public.payments (invoice_id, amount, method, reference, stripe_session_id)
  select id, 450, 'bank-transfer', 'TRF-1', 'cs_test_secret' from public.invoices;
reset role;
select pg_temp.check((select action = 'insert' and actor_role = 'admin' and family_ids = '{c0000000-0000-0000-0000-000000000001}'
    and related_ids = array[(select id from public.invoices limit 1)] and after->>'reference' = 'TRF-1'
    and after->>'stripe_session_id' = '[redacted]'
  from pg_temp.last('payments')), 'a payment is filed under its invoice and family, with the provider id redacted');
select pg_temp.check((select before = '{"status":"sent"}' and after = '{"status":"paid"}' and actor_role = 'admin'
  from pg_temp.last('invoices')), 'the invoice being marked paid is recorded');
select pg_temp.check((select count(*) from public.audit_events where before::text like '%cs_test_secret%' or after::text like '%cs_test_secret%') = 0,
  'payment provider ids never appear');
-- A card payment from Stripe: the payment intent is also the visible reference, and must never be stored.
insert into public.invoices (id, number, family_id, due_date, status) values
  ('ab000000-0000-0000-0000-000000000001', 'INV-CARD-1', 'c0000000-0000-0000-0000-000000000002', current_date + 7, 'sent');
update public.invoices set autopay_status = 'pending' where id = 'ab000000-0000-0000-0000-000000000001';
update public.invoices set autopay_status = 'processing' where id = 'ab000000-0000-0000-0000-000000000001';
update public.invoices set autopay_error = 'Your card was declined.' where id = 'ab000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.audit_events where table_name = 'invoices'
    and row_id = 'ab000000-0000-0000-0000-000000000001') = 1, 'automatic-payment bookkeeping creates no invoice event');
select public.record_stripe_payment('ab000000-0000-0000-0000-000000000001', 300, 'pi_test_123', 'cs_test_456');
select pg_temp.check((select after->>'reference' = '[redacted]' and after->>'stripe_payment_intent' = '[redacted]'
    and after->>'method' = 'card' and (after->>'amount')::numeric = 300 and context->>'invoice_number' = 'INV-CARD-1'
  from pg_temp.last('payments')), 'a card payment is recorded with its reference redacted and its invoice number as context');
select pg_temp.check((select count(*) from public.audit_events
    where coalesce(before::text, '') || coalesce(after::text, '') || coalesce(context::text, '') ~ '(pi_test_123|cs_test_456|declined)') = 0,
  'payment intent ids, session ids and decline messages appear nowhere in the log');
select pg_temp.check(public.audit_redact('x', '{"reference":"ch_3PabcDEF","note":"in person","status":"in-progress","word":"sub_"}')
  = '{"reference":"[redacted]","note":"in person","status":"in-progress","word":"sub_"}',
  'values that look like payment-provider ids are redacted whatever the column; ordinary words are not');
update public.invoices set overdue_whatsapp_at = now(), autopay_claimed_at = now(), autopay_attempts = 3;
select pg_temp.check((select before = '{"status":"sent"}' from pg_temp.last('invoices')), 'invoice reminder stamps create no event');

-- Bank details --------------------------------------------------------------------
set role authenticated;
update public.settings set bank_details = 'IBAN AE07 0331 2345 6789 0123 456';
update public.settings set bank_details = 'IBAN AE07 9999 2345 6789 0123 999', invoice_due_days = 14;
reset role;
select pg_temp.check(pg_temp.n('settings') = 2, 'each change to the bank details is recorded');
select pg_temp.check((select before->>'bank_details' = '[redacted]' and after->>'bank_details' = '[redacted]'
    and before->>'invoice_due_days' = '7' and after->>'invoice_due_days' = '14' and row_id = '1'
  from pg_temp.last('settings')), 'the bank details are redacted on both sides, other changes are shown');
select pg_temp.check((select count(*) from public.audit_events where before::text like '%AE07%' or after::text like '%AE07%') = 0,
  'no IBAN text appears anywhere in the log');
select pg_temp.check(public.audit_redact('tutor_payment_details', '{"iban":"AE07","Swift_Code":"X","account_number":"1","push_token":"t","name":"n","note":null}')
  = '{"iban":"[redacted]","Swift_Code":"[redacted]","account_number":"[redacted]","push_token":"[redacted]","name":"n","note":null}',
  'the redaction rule covers bank, IBAN, SWIFT, account numbers and tokens, case-insensitively');

-- Tutors, services, families, students ---------------------------------------------------
set role authenticated;
update public.tutors set hourly_pay = 175 where id = 'b0000000-0000-0000-0000-000000000001';
insert into public.services (name, duration_min, rate) values ('IGCSE 1:1', 60, 380);
update public.families set phone = '+971500000000' where id = 'c0000000-0000-0000-0000-000000000001';
update public.students set target_grade = '7' where id = 'd0000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.check((select before = '{"hourly_pay":150.00}' and after = '{"hourly_pay":175.00}'
    and tutor_id = 'b0000000-0000-0000-0000-000000000001' from pg_temp.last('tutors')), 'a tutor pay change is recorded');
select pg_temp.check((select action = 'insert' and after->>'name' = 'IGCSE 1:1' and actor_role = 'admin' from pg_temp.last('services')),
  'a new service is recorded');
select pg_temp.check((select before = '{"phone":null}' and after = '{"phone":"+971500000000"}'
    and family_ids = '{c0000000-0000-0000-0000-000000000001}' from pg_temp.last('families')), 'a family update keeps only the changed key');
select pg_temp.check((select before = '{"target_grade":null}' and after = '{"target_grade":"7"}'
    and student_ids = '{d0000000-0000-0000-0000-000000000001}' and family_ids = '{c0000000-0000-0000-0000-000000000001}'
  from pg_temp.last('students')), 'a student update keeps only the changed key');

-- Reports: status changes only -----------------------------------------------------------
insert into public.report_cycles (id, name, starts_on, due_date) values
  ('ac000000-0000-0000-0000-000000000001', 'Autumn', '2026-09-01', '2026-12-01');
insert into public.student_reports (id, cycle_id, student_id, tutor_id) values
  ('ad000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
update public.student_reports set comment = 'Lovely term', updated_at = now();
select pg_temp.check(pg_temp.n('student_reports') = 0, 'creating a report and editing its comment create no event');
set role authenticated;
select public.set_report_status('ad000000-0000-0000-0000-000000000001', 'approved');
reset role;
select pg_temp.check((select before = '{"status":"draft"}' and after = '{"status":"approved"}' and actor_role = 'admin'
    and related_ids = '{ac000000-0000-0000-0000-000000000001}' and tutor_id = 'b0000000-0000-0000-0000-000000000001'
    and family_ids = '{c0000000-0000-0000-0000-000000000001}' and student_ids = '{d0000000-0000-0000-0000-000000000001}'
  from pg_temp.last('student_reports')), 'a report status change stores only the status');
set role authenticated;
select public.set_report_status('ad000000-0000-0000-0000-000000000001', 'published');
reset role;
select pg_temp.check((select before = '{"status":"approved"}' and after->>'status' = 'published' and after ? 'published_at'
    and not (after ? 'comment') from pg_temp.last('student_reports')), 'publishing also stores when it was published');

-- Opportunities: award only ------------------------------------------------------------
insert into public.opportunities (id, title, pay_rate, student_id) values
  ('ae000000-0000-0000-0000-000000000001', 'IB Maths HL tutor', 200, 'd0000000-0000-0000-0000-000000000002');
insert into public.opportunity_bids (id, opportunity_id, tutor_id, pitch) values
  ('af000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Happy to help');
update public.opportunities set description = 'Weekly, online';
select pg_temp.check(pg_temp.n('opportunities') = 0, 'posting and editing an opportunity create no event');
set role authenticated;
select public.award_opportunity('af000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.check((select before->>'title' = 'IB Maths HL tutor' and after->>'title' = 'IB Maths HL tutor'
    and before->>'status' = 'open' and after->>'status' = 'awarded'
    and after->>'awarded_tutor_id' = 'b0000000-0000-0000-0000-000000000001' and after ? 'awarded_at' and not (after ? 'description')
    and tutor_id = 'b0000000-0000-0000-0000-000000000001' and family_ids = '{c0000000-0000-0000-0000-000000000002}'
  from pg_temp.last('opportunities')), 'an award stores the title, status and awarded tutor');

-- The system ----------------------------------------------------------------------
select pg_temp.as_user('');
update public.services set rate = 460 where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.check((select actor_role = 'system' and actor_name is null and actor_id is null from pg_temp.last('services')),
  'a write with no auth.uid() is recorded as the system');
select set_config('elite.acting_as', 'a0000000-0000-0000-0000-00000000000c', false);
update public.services set rate = 470 where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.check((select acting_as = 'a0000000-0000-0000-0000-00000000000c' from pg_temp.last('services')), 'acting_as is recorded when set');
select set_config('elite.acting_as', 'not-a-uuid', false);
update public.services set rate = 480 where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.check((select acting_as is null from pg_temp.last('services')), 'a malformed acting_as never blocks a write');
select set_config('elite.acting_as', '', false);

-- Who can read it -------------------------------------------------------------------
create temp table total as select count(*) n from public.audit_events;
grant select on total to authenticated;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.audit_events) = 0, 'a tutor sees no audit events');
do $$ begin
  perform public.list_audit_events();
  raise exception 'tutor listed audit events';
exception when insufficient_privilege then raise notice 'ok - a tutor cannot call list_audit_events';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.audit_events) = 0, 'a parent sees no audit events');
do $$ begin
  perform public.audit_actors();
  raise exception 'parent listed actors';
exception when insufficient_privilege then raise notice 'ok - a parent cannot call audit_actors';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.audit_events) = (select n from total), 'an admin sees every event');

-- Nobody can change it ------------------------------------------------------------------
do $$ begin
  insert into public.audit_events (action, table_name) values ('insert', 'lessons');
  raise exception 'admin forged an event';
exception when insufficient_privilege then raise notice 'ok - an admin cannot add events';
end $$;
do $$ begin
  update public.audit_events set actor_name = 'Someone else';
  raise exception 'admin changed history';
exception when insufficient_privilege then raise notice 'ok - an admin cannot change events';
end $$;
do $$ begin
  delete from public.audit_events;
  raise exception 'admin deleted history';
exception when insufficient_privilege then raise notice 'ok - an admin cannot delete events';
end $$;
set role service_role;
do $$ begin
  delete from public.audit_events;
  raise exception 'service role deleted history';
exception when insufficient_privilege then raise notice 'ok - the service role cannot delete events';
end $$;
reset role;
do $$ begin
  update public.audit_events set actor_name = 'Someone else';
  raise exception 'owner changed history';
exception when insufficient_privilege then
  if sqlerrm <> 'The audit log cannot be changed or deleted' then raise; end if;
  raise notice 'ok - even the table owner cannot change events';
end $$;
do $$ begin
  delete from public.audit_events;
  raise exception 'owner deleted history';
exception when insufficient_privilege then
  if sqlerrm <> 'The audit log cannot be changed or deleted' then raise; end if;
  raise notice 'ok - even the table owner cannot delete events';
end $$;
do $$ begin
  truncate public.audit_events;
  raise exception 'owner truncated history';
exception when insufficient_privilege then
  if sqlerrm <> 'The audit log cannot be changed or deleted' then raise; end if;
  raise notice 'ok - even the table owner cannot truncate the log';
end $$;
do $$ begin
  insert into public.audit_events (action, table_name) values ('insert', 'lessons');
  raise exception 'owner forged an event';
exception when insufficient_privilege then raise notice 'ok - events can only come from the audit trigger';
end $$;
select pg_temp.check((select count(*) from public.audit_events) = (select n from total), 'the log is unchanged');

-- Reading the log ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select array_agg(distinct table_name order by table_name) from public.list_audit_events(
    p_entity_id => 'f0000000-0000-0000-0000-000000000001', p_limit => 200)) @> array['charges', 'homework', 'lesson_notes', 'lessons']
  and (select bool_and(row_id = 'f0000000-0000-0000-0000-000000000001' or related_ids @> '{f0000000-0000-0000-0000-000000000001}')
       from public.list_audit_events(p_entity_id => 'f0000000-0000-0000-0000-000000000001', p_limit => 200)),
  'filtering by a lesson returns the lesson and everything filed under it');
select pg_temp.check((select array_agg(distinct table_name) from public.list_audit_events(p_entity_id => '1')) = array['settings'],
  'filtering by a non-uuid id matches the row id only');
select pg_temp.check((select count(*) from public.list_audit_events(p_family_id => 'c0000000-0000-0000-0000-000000000002', p_limit => 200))
    = (select count(*) from public.audit_events where family_ids @> '{c0000000-0000-0000-0000-000000000002}')
  and (select bool_and(table_name in ('families', 'students', 'enrolments', 'lessons', 'lesson_notes', 'opportunities', 'charges', 'invoices', 'payments'))
       from public.list_audit_events(p_family_id => 'c0000000-0000-0000-0000-000000000002', p_limit => 200)),
  'filtering by family');
select pg_temp.check((select count(*) from public.list_audit_events(p_student_id => 'd0000000-0000-0000-0000-000000000002', p_limit => 200))
    = (select count(*) from public.audit_events where student_ids @> '{d0000000-0000-0000-0000-000000000002}'), 'filtering by student');
select pg_temp.check((select bool_and(tutor_id = 'b0000000-0000-0000-0000-000000000001') and count(*) > 3
  from public.list_audit_events(p_tutor_id => 'b0000000-0000-0000-0000-000000000001', p_limit => 200)), 'filtering by tutor');
select pg_temp.check((select bool_and(actor_role = 'tutor') and count(*) > 0
  from public.list_audit_events(p_actor_id => 'a0000000-0000-0000-0000-00000000000b', p_limit => 200)), 'filtering by who made the change');
select pg_temp.check((select array_agg(distinct table_name order by table_name)
  from public.list_audit_events(p_tables => array['payments', 'invoices'])) = array['invoices', 'payments'], 'filtering by table');
select pg_temp.check((select count(*) from public.list_audit_events(p_from => now() + interval '1 day')) = 0
  and (select count(*) from public.list_audit_events(p_to => now() - interval '1 day')) = 0
  and (select count(*) from public.list_audit_events(p_from => now() - interval '1 day', p_to => now() + interval '1 day', p_limit => 200))
      = least((select n from total), 200), 'filtering by date range');
select pg_temp.check((select count(*) from public.list_audit_events(p_limit => 0)) = 1
  and (select count(*) from public.list_audit_events(p_limit => 5000)) = least((select n from total), 200), 'the page size is clamped');
create temp table page1 as select * from public.list_audit_events(p_limit => 2);
create temp table page2 as select * from public.list_audit_events(
  p_before_at => (select min(at) from page1), p_before_id => (select id from page1 order by at, id limit 1), p_limit => 2);
select pg_temp.check((select count(*) from page1) = 2 and (select count(*) from page2) = 2
  and not exists (select 1 from page1 join page2 using (id))
  and (select min(at) from page1) >= (select max(at) from page2)
  and (select array_agg(id order by at desc, id desc) from page1) || (select array_agg(id order by at desc, id desc) from page2)
      = (select array_agg(id) from (select id from public.list_audit_events(p_limit => 4)) x),
  'keyset paging returns the next rows with no overlap');
select pg_temp.check((select array_agg(actor_name order by actor_name) from public.audit_actors()) = array['Boss', 'Tia Tutor']
  and (select actor_role from public.audit_actors() where actor_name = 'Tia Tutor') = 'tutor', 'audit_actors lists who has made changes');
do $$ begin
  perform public.audit_attach('public.services');
  raise exception 'admin attached a trigger';
exception when insufficient_privilege then raise notice 'ok - audit_attach is not callable from the app';
end $$;
reset role;

-- Tables added later ---------------------------------------------------------------------
create table public.audit_probe (id uuid primary key default gen_random_uuid(), family_id uuid, secret_code text);
select public.audit_attach('public.audit_probe');
select public.audit_attach('public.audit_probe');
insert into public.audit_probe (family_id, secret_code) values ('c0000000-0000-0000-0000-000000000002', 'shh');
select pg_temp.check((select count(*) from public.audit_events where table_name = 'audit_probe') = 1, 'audit_attach can be run twice');
select pg_temp.check((select family_ids = '{c0000000-0000-0000-0000-000000000002}' and after->>'secret_code' = '[redacted]'
  from pg_temp.last('audit_probe')), 'a newly attached table is filed by its family_id and redacted');
delete from public.audit_probe;
select pg_temp.check((select action = 'delete' and after is null and before->>'family_id' = 'c0000000-0000-0000-0000-000000000002'
    and family_ids = '{c0000000-0000-0000-0000-000000000002}' from pg_temp.last('audit_probe')), 'deletes keep the old row');

-- The System filter and context on lessons -----------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select bool_and(actor_role = 'system') and count(*) > 0 from public.list_audit_events(p_actor_role => 'system', p_limit => 200)),
  'filtering by the system');
select pg_temp.check((select bool_and(actor_role = 'tutor') and count(*) > 0 from public.list_audit_events(p_actor_role => 'tutor', p_limit => 200)),
  'filtering by role');
reset role;
select pg_temp.check((select context->>'subject' = 'IB 1:1' and context ? 'lesson_start'
  from public.audit_events where table_name = 'lessons' order by at limit 1), 'lesson events carry the subject and start as context');

-- Deleting a person keeps only who it was -------------------------------------------------
insert into public.families (id, name, parent_name, email, phone) values
  ('c0000000-0000-0000-0000-000000000009', 'Gone', 'Gwen Gone', 'gwen@x', '+971 50 111 2222');
delete from public.families where id = 'c0000000-0000-0000-0000-000000000009';
select pg_temp.check((select action = 'delete' and before = '{"id":"c0000000-0000-0000-0000-000000000009","name":"Gone"}'
  from pg_temp.last('families')), 'a deleted family keeps only its id and name');

-- Erasure ---------------------------------------------------------------------------------
select pg_temp.check((select count(*) from public.audit_events where family_ids @> '{c0000000-0000-0000-0000-000000000001}'
  and (coalesce(before::text, '') || coalesce(after::text, '')) like '%+971500000000%') = 1, 'the family phone is in the log before erasure');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.audit_erase(array['c0000000-0000-0000-0000-000000000001'::uuid]);
  raise exception 'admin erased history';
exception when insufficient_privilege then raise notice 'ok - an admin cannot call audit_erase';
end $$;
do $$ begin
  perform set_config('elite.audit_erasing', 'on', true);
  update public.audit_events set actor_name = 'Someone else';
  raise exception 'admin changed history with the erasing flag';
exception when insufficient_privilege then raise notice 'ok - the erasing flag alone does not unlock the log';
end $$;
reset role;
create temp table before_erase as select count(*) n from public.audit_events;
set role service_role;
select pg_temp.check(public.audit_erase(array['c0000000-0000-0000-0000-000000000001'::uuid], array['d0000000-0000-0000-0000-000000000001'::uuid],
  '{}', array['a0000000-0000-0000-0000-00000000000c'::uuid]) > 0, 'the service role can erase a family');
reset role;
select pg_temp.check((select count(*) from public.audit_events where family_ids @> '{c0000000-0000-0000-0000-000000000001}'
    and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '(\+971500000000|Sara Ahmed|Mona Ahmed|Integration by parts)') = 0,
  'after erasure the family''s phone, names and lesson notes are gone from the log');
select pg_temp.check((select before->>'phone' is null and after->>'phone' = '[erased]' from public.audit_events
    where table_name = 'families' and row_id = 'c0000000-0000-0000-0000-000000000001' and action = 'update'),
  'the change itself is still recorded');
select pg_temp.check((select count(*) from public.audit_events) = (select n from before_erase)
  and (select count(*) from public.audit_events where (after->>'amount')::numeric = 450 and table_name = 'payments') = 1,
  'erasure removes no events and keeps amounts');
do $$ begin
  update public.audit_events set actor_name = 'Someone else';
  raise exception 'owner changed history after erasure';
exception when insufficient_privilege then raise notice 'ok - the log is locked again after erasure';
end $$;

-- Per-subject tables (custom pay and prices, attached by later teams) -------------------------
insert into public.enrolments (id, student_id, subject, tutor_id) values
  ('a1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Chemistry', 'b0000000-0000-0000-0000-000000000001');
create table public.audit_pay_probe (enrolment_id uuid primary key, hourly_pay numeric, updated_at timestamptz default now());
select public.audit_attach('public.audit_pay_probe');
insert into public.audit_pay_probe (enrolment_id, hourly_pay) values ('a1000000-0000-0000-0000-000000000001', 200);
update public.audit_pay_probe set hourly_pay = 220;
select pg_temp.check((select row_id = 'a1000000-0000-0000-0000-000000000001' and related_ids = '{a1000000-0000-0000-0000-000000000001}'
    and student_ids = '{d0000000-0000-0000-0000-000000000002}' and family_ids = '{c0000000-0000-0000-0000-000000000002}'
    and tutor_id = 'b0000000-0000-0000-0000-000000000001' and context->>'subject' = 'Chemistry'
    and before = '{"hourly_pay":200}' and after = '{"hourly_pay":220}'
  from pg_temp.last('audit_pay_probe')), 'a per-subject row is filed under its enrolment''s student, family and tutor');
