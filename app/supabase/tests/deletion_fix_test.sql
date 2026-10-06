-- Account deletion follow-ups (20261113001600_deletion_fix.sql). Run after the migrations on an empty database
-- (run.sh passes migration_count).
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss and Bea are admins. Mona is the Ahmed parent; Khalid is a second Ahmed contact without a login. Nadia is the
-- Bakr parent (another family, whose messages must stay). Books is the accountant.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000aa', 'bea@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mona@x'), ('a0000000-0000-0000-0000-00000000000d', 'nadia@x'),
  ('a0000000-0000-0000-0000-0000000000ac', 'books@x');
insert into public.families (id, name, parent_name, email, phone) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mona@x', '+971501112233'),
  ('c0000000-0000-0000-0000-000000000002', 'Bakr', 'Nadia Bakr', 'nadia@x', '+971504445566');
insert into public.students (id, family_id, full_name, curriculum) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Rami Bakr', 'IB');
insert into public.profiles (id, role, full_name, email, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null),
  ('a0000000-0000-0000-0000-0000000000aa', 'admin', 'Bea Adviser', 'bea@x', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mona@x', 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-00000000000d', 'parent', 'Nadia Bakr', 'nadia@x', 'c0000000-0000-0000-0000-000000000002');
insert into public.family_contacts (id, family_id, name, relationship, email, phone, receives_whatsapp) values
  ('cc000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Khalid Ahmed', 'father', 'khalid@x',
   '+971 50 999 8877', true);

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Closing a family: nothing queued for its other contacts is sent
-- ---------------------------------------------------------------------------------------------------------------
insert into public.notification_outbox (id, profile_id, contact_id, email, subject, body, send_email) values
  -- An email queued against Khalid as a contact.
  ('0b000000-0000-0000-0000-000000000001', null, 'cc000000-0000-0000-0000-000000000001', 'khalid@x',
   'Lesson notes for Sami', 'Sami worked on vectors.', true),
  -- An email to Khalid's address with no contact recorded.
  ('0b000000-0000-0000-0000-000000000002', null, null, 'khalid@x', 'Invoice INV-1001', 'Sami''s invoice.', true),
  -- The other family's and the office's messages stay.
  ('0b000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000d', null, 'nadia@x', 'Lesson notes for Rami',
   'Rami worked on vectors.', true),
  ('0b000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', null, 'boss@x', 'New enquiry',
   'A new enquiry.', true);
insert into public.notification_outbox (id, profile_id, contact_id, email, subject, body, send_email, whatsapp,
                                        whatsapp_to, whatsapp_template, whatsapp_status) values
  -- A WhatsApp reminder queued against Khalid, and one to his number with no contact recorded.
  ('0b000000-0000-0000-0000-000000000003', null, 'cc000000-0000-0000-0000-000000000001', null, 'Lesson tomorrow',
   'Sami has a lesson tomorrow.', false, true, '+971509998877', 'lesson_reminder', 'pending'),
  ('0b000000-0000-0000-0000-000000000006', null, null, null, 'Lesson tomorrow', 'Sami has a lesson tomorrow.', false, true,
   '+971509998877', 'lesson_reminder', 'pending');

set role service_role;
select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-00000000000c',
                                                                    'a0000000-0000-0000-0000-00000000000c'), null);
reset role;
select pg_temp.check(not exists (select 1 from public.notification_outbox where id in ('0b000000-0000-0000-0000-000000000001',
    '0b000000-0000-0000-0000-000000000002')),
  'closing a family removes emails still queued for its other contacts');
select pg_temp.check(not exists (select 1 from public.notification_outbox where id in ('0b000000-0000-0000-0000-000000000003',
    '0b000000-0000-0000-0000-000000000006')),
  'closing a family removes WhatsApp messages still queued for its other contacts');
select pg_temp.check(not exists (select 1 from public.notification_outbox
                                  where (sent_at is null or (whatsapp and whatsapp_status = 'pending'))
                                    and (coalesce(email, '') in ('khalid@x', 'mona@x')
                                         or coalesce(whatsapp_to, '') in ('+971509998877', '+971501112233'))),
  'nothing addressed to the closed family is left to send');
select pg_temp.check((select count(*) from public.notification_outbox where id in ('0b000000-0000-0000-0000-000000000004',
    '0b000000-0000-0000-0000-000000000005')) = 2,
  'other families'' and the office''s messages are kept');

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Closing an accountant's login erases their invitation's audit trail
-- ---------------------------------------------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.invite_accountant('books@x', 'Amira Books') = 'invited', 'the accountant is invited');
reset role;
update auth.users set email_confirmed_at = now() where id = 'a0000000-0000-0000-0000-0000000000ac';
select pg_temp.check((select role = 'accountant' from public.profiles where id = 'a0000000-0000-0000-0000-0000000000ac'),
  'the invited accountant signs in as the accountant');
select pg_temp.check(exists (select 1 from public.audit_events where table_name = 'accountant_invites'
    and (coalesce(before::text, '') || coalesce(after::text, '')) ~ 'books@x'),
  'the invitation is in the audit log while the accountant has a login');
set role service_role;
select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-0000000000ac',
                                                                    'a0000000-0000-0000-0000-0000000000ac'), null);
reset role;
select pg_temp.check(not exists (select 1 from public.audit_events where table_name = 'accountant_invites'
    and (coalesce(before::text, '') || coalesce(after::text, '') || coalesce(row_id, '')) ~ '(books@x|Amira Books)'),
  'the audit log keeps no name or address of the closed accountant');
select pg_temp.check((select count(*) >= 2 from public.audit_events where table_name = 'accountant_invites'),
  'the invitation''s history is kept, without the personal values');

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Names written beside work: admissions updates and tasks, handbook versions
-- ---------------------------------------------------------------------------------------------------------------
insert into public.admissions_cases (id, student_id, family_id, kind, title, status) values
  ('a1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'uk-university', 'UK universities 2027', 'active');
insert into public.admissions_updates (case_id, kind, title, body, author_id, author_name) values
  ('a1000000-0000-0000-0000-000000000002', 'ad-hoc', 'Personal statement', 'Draft one.', 'a0000000-0000-0000-0000-0000000000aa',
   'Bea Adviser');
insert into public.admissions_tasks (id, case_id, title, owner) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'Shortlist', 'adviser'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Reference letter', 'adviser');
-- A task completed before done_by was recorded carries only the name.
update public.admissions_tasks set done_at = now(), done_by_name = 'Bea Adviser' where id = 'a2000000-0000-0000-0000-000000000002';
insert into public.handbook_versions (version, title, body, published_by, published_by_name)
  values (2, 'Tutor handbook', 'Be on time.', 'a0000000-0000-0000-0000-0000000000aa', 'Bea Adviser');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000aa');
select public.set_admissions_task_done('a2000000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.check((select done_by = 'a0000000-0000-0000-0000-0000000000aa' and done_by_name = 'Bea Adviser'
                        from public.admissions_tasks where id = 'a2000000-0000-0000-0000-000000000001'),
  'a completed task records who completed it');
set role authenticated;
select public.set_admissions_task_done('a2000000-0000-0000-0000-000000000001', false);
reset role;
select pg_temp.check((select done_by is null and done_by_name is null
                        from public.admissions_tasks where id = 'a2000000-0000-0000-0000-000000000001'),
  'reopening a task clears who completed it');
set role authenticated;
select public.set_admissions_task_done('a2000000-0000-0000-0000-000000000001', true);
reset role;

set role service_role;
select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-0000000000aa',
                                                                    'a0000000-0000-0000-0000-0000000000aa'), null);
reset role;
select pg_temp.check((select author_name = 'Elite Education' from public.admissions_updates
                       where case_id = 'a1000000-0000-0000-0000-000000000002'),
  'an advisory update no longer names its closed author');
select pg_temp.check((select bool_and(done_by_name = 'Elite Education') from public.admissions_tasks
                       where case_id = 'a1000000-0000-0000-0000-000000000002'),
  'tasks no longer name the closed login that completed them, including tasks completed before done_by');
select pg_temp.check((select published_by_name = 'Elite Education' from public.handbook_versions where version = 2),
  'a handbook version no longer names its closed publisher');
select pg_temp.check(not exists (select 1 from public.admissions_updates where author_name = 'Bea Adviser')
  and not exists (select 1 from public.admissions_tasks where done_by_name = 'Bea Adviser')
  and not exists (select 1 from public.handbook_versions where published_by_name = 'Bea Adviser'),
  'the closed login''s name is left nowhere beside their work');

-- 4. Migrations ledger ---------------------------------------------------------------------------------------------
select pg_temp.check((select count(*) from public.db_migrations) = :migration_count
  and exists (select 1 from public.db_migrations where version = '20261113001600' and name = 'deletion_fix'),
  'the ledger lists every migration file, including the deletion fix');

\echo 'All deletion fix tests passed'
