-- Round 5 merge: the behaviour that depends on several round 5 features together. Run after the migrations on an
-- empty database (run.sh passes migration_count).
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;

-- Boss is the admin. Tia tutors Sami. Mona is the Ahmed parent; Khalid is a second Ahmed contact without a login.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'), ('a0000000-0000-0000-0000-0000000000aa', 'bea@x'),
  ('a0000000-0000-0000-0000-0000000000b1', 'tia@x'), ('a0000000-0000-0000-0000-00000000000c', 'mona@x'),
  ('a0000000-0000-0000-0000-0000000000ac', 'books@x');
insert into public.tutors (id, full_name, email, subjects) values
  ('b0000000-0000-0000-0000-000000000001', 'Tia One', 'tia@x', '{Maths}'),
  ('b0000000-0000-0000-0000-000000000002', 'Tom Two', 'tom@x', '{Maths}');
insert into public.families (id, name, parent_name, email, phone) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mona@x', '+971501112233');
insert into public.students (id, family_id, full_name, curriculum) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'IB');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-0000000000aa', 'admin', 'Bea', 'bea@x', null, null),
  ('a0000000-0000-0000-0000-0000000000b1', 'tutor', 'Tia One', 'tia@x', 'b0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mona@x', null, 'c0000000-0000-0000-0000-000000000001');
insert into public.family_contacts (family_id, name, relationship, email, phone) values
  ('c0000000-0000-0000-0000-000000000001', 'Khalid Ahmed', 'father', 'khalid@x', '+971509998877');
insert into public.services (id, name, duration_min, rate) values ('e0000000-0000-0000-0000-000000000001', 'IB 1:1', 60, 450);
insert into public.lessons (id, tutor_id, student_ids, service_id, start_at, end_at, location, status, subject) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() - interval '7 days', now() - interval '7 days' + interval '1 hour', 'online', 'completed', 'Maths'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '{d0000000-0000-0000-0000-000000000001}',
   'e0000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'online', 'scheduled', 'Maths');
insert into public.invoices (id, number, family_id, issue_date, due_date, status, items, vat_rate) values
  ('90000000-0000-0000-0000-000000000001', 'INV-1001', 'c0000000-0000-0000-0000-000000000001', current_date - 7, current_date,
   'sent', '[{"description":"IB 1:1 — Sami Ahmed","quantity":1,"unitPrice":450}]', 0.05);
insert into public.payments (id, invoice_id, amount, method, reference) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 200, 'bank-transfer', 'TT-1');
insert into public.enquiries (parent_name, email, student_name, family_id, notes) values
  ('Mona Ahmed', 'mona@x', 'Sami', 'c0000000-0000-0000-0000-000000000001', 'Staff only: prefers evenings');

-- 1. Round 4 follow-up wording ---------------------------------------------------------------
select pg_temp.check(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
    and (prosrc like '%''/admin/enquiries''%' or prosrc like '%''/admin/requests''%' or prosrc like '%''/manage/tutor-invoice/''%')),
  'no function links to /admin/enquiries, /admin/requests or /manage/tutor-invoice/ after round 5');
select pg_temp.check(position('''FMDD Mon YYYY''' in pg_get_functiondef('public.apply_charges(uuid, jsonb)'::regprocedure)) > 0
  and position('''YYYY-MM-DD''' in pg_get_functiondef('public.apply_charges(uuid, jsonb)'::regprocedure)) = 0,
  'charges, including agreed-price ones, read ''17 Aug 2026''');
select pg_temp.check(position('''/manage/enquiries''' in pg_get_functiondef('public.link_login(uuid, text, jsonb)'::regprocedure)) > 0,
  'the contacts version of link_login keeps the /manage/enquiries link');

-- 2. Roles -----------------------------------------------------------------------------------
select pg_temp.check((select pg_get_constraintdef(oid) like '%accountant%' and pg_get_constraintdef(oid) like '%student%'
                        from pg_constraint where conname = 'profiles_role_check'), 'every round 5 role is allowed');

-- 3. Enquiries: staff-only notes ---------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.enquiries) = 0, 'a family cannot read its enquiries, so never the staff-only notes');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.enquiries where notes like 'Staff only%') = 1, 'the office still reads enquiries and their notes');
reset role;

-- 4. Accountant access and family contacts -----------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.invite_accountant('Khalid@x');
  raise exception 'a family contact was invited as the accountant';
exception when raise_exception then
  if sqlerrm not like 'This email address belongs to a tutor or a family%' then raise; end if;
  raise notice 'ok - a second family contact cannot be invited as the accountant';
end $$;
select pg_temp.check(public.invite_accountant('books@x', 'Amira Books') = 'invited', 'a separate address can be invited');
reset role;
update auth.users set email_confirmed_at = now() where id = 'a0000000-0000-0000-0000-0000000000ac';
select pg_temp.check((select role = 'accountant' from public.profiles where id = 'a0000000-0000-0000-0000-0000000000ac'),
  'the invited accountant signs in as the accountant');
-- A contact address invited before the contact was added never becomes an accountant login.
insert into public.accountant_invites (email) values ('later@x');
insert into public.family_contacts (family_id, name, relationship, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Layla Ahmed', 'guardian', 'later@x');
insert into auth.users (id, email, email_confirmed_at) values ('a0000000-0000-0000-0000-0000000000ad', 'later@x', now());
select pg_temp.check(not exists (select 1 from public.profiles where id = 'a0000000-0000-0000-0000-0000000000ad' and role = 'accountant'),
  'a family contact''s address is never linked as an accountant');
select pg_temp.check(public.login_email_taken('books@x', 'c0000000-0000-0000-0000-000000000001'),
  'an accountant''s address cannot be given family sign-in');

-- 7. View as: round 5 reads are allowed --------------------------------------------------------
select pg_temp.check(public.view_as_read_rpcs() @> array['list_family_contacts', 'tutor_compliance', 'visible_lesson_plans', 'handover_pack']
  and not public.view_as_read_rpcs() && array['save_family_contact', 'save_lesson_plan', 'issue_credit_note', 'export_my_data',
                                             'submit_tutor_document', 'set_enrolment_rates', 'mark_handover_viewed'],
  'View as reads round 5 data and every round 5 change stays refused');

-- 8. Audit log: round 5 records ------------------------------------------------------------------
insert into public.tutor_documents (id, tutor_id, doc_type, file_path, file_name, status) values
  ('60000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'police_clearance',
   'tutors/b0000000-0000-0000-0000-000000000002/police.pdf', 'police.pdf', 'pending');
select pg_temp.check(exists (select 1 from public.audit_events where table_name = 'tutor_documents' and action = 'insert'
                              and tutor_id = 'b0000000-0000-0000-0000-000000000002'), 'a tutor document upload is audited');
select pg_temp.check((select count(*) from pg_trigger where tgname in ('audit_credit_notes', 'audit_refunds', 'audit_accountant_invites',
                       'audit_admissions_cases', 'audit_tutor_documents', 'audit_tutor_vetting_overrides')) = 6,
  'credit notes, refunds, accountant invitations, admissions cases, tutor documents and overrides are audited');
select pg_temp.check(public.audit_scrub('{"customer": {"name": "Mona Ahmed", "email": "mona@x", "trn": null}, "total": 10}')
    = '{"customer": {"name": "[erased]", "email": "[erased]", "trn": null}, "total": 10}', 'erasure reaches nested objects');

-- 6. Download my data ----------------------------------------------------------------------------
insert into public.admissions_cases (id, student_id, family_id, kind, title, status) values
  ('a1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'uk-university', 'UK universities 2027', 'active');
insert into public.handovers (reason, student_id, student_name, subject, from_tutor_id, to_tutor_id, note) values
  ('reassigned', 'd0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Maths', 'b0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'Sami is strong on vectors.');
insert into public.lesson_plans (lesson_id, tutor_id, objectives, homework, shared_with_family) values
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Revise vectors with Sami',
   '[{"studentId":"d0000000-0000-0000-0000-000000000001","title":"Sheet"}]', true);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
create temp table export as select public.export_my_data() as d;
select pg_temp.check((select jsonb_array_length(d->'familyContacts') = 3 and d->'admissions'->0->>'title' = 'UK universities 2027'
                             and d ? 'creditNotes' and d ? 'refunds' and d ? 'tutorDocuments' and d ? 'handbookAcknowledgements'
                             and d->>'format' = 'elite-education-export/1' and d ? 'invoices'
                        from export), 'a parent''s data download includes contacts, admissions, credit notes and refunds');
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select jsonb_array_length(d->'familyContacts') = 0 and jsonb_array_length(d->'admissions') = 0
                        from (select public.export_my_data() as d) x), 'a tutor''s download holds no family''s contacts or admissions');
reset role;

-- 5. Account deletion ---------------------------------------------------------------------------
set role service_role;
create temp table fam_del as
  select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-00000000000c',
                                                                      'a0000000-0000-0000-0000-00000000000c'), null) as s;
reset role;
select pg_temp.check((select count(*) from public.family_contacts where family_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select not can_log_in and not receives_whatsapp and phone is null and email like 'deleted-%' from public.family_contacts
        where family_id = 'c0000000-0000-0000-0000-000000000001'),
  'closing the family removes its other contacts and the main contact keeps only the anonymised details');
select pg_temp.check(not exists (select 1 from public.admissions_cases where student_id = 'd0000000-0000-0000-0000-000000000001')
  and (select s->'storageFolders' @> '["admissions/cases/a1000000-0000-0000-0000-000000000001/"]' from fam_del),
  'admissions cases go, and their files are listed for removal');
select pg_temp.check(not exists (select 1 from public.handovers where student_id = 'd0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.lesson_plans where lesson_id = 'f0000000-0000-0000-0000-000000000002'),
  'handover packs and lesson plans about the child go');
select pg_temp.check((select count(*) from public.invoices where family_id = 'c0000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from public.payments where invoice_id = '90000000-0000-0000-0000-000000000001') = 1,
  'invoices and payments are kept');
select pg_temp.check(not exists (select 1 from public.audit_events where family_ids @> '{c0000000-0000-0000-0000-000000000001}'
    and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '(mona@x|khalid@x|Mona Ahmed|Khalid Ahmed|\+97150)'),
  'the audit log keeps no names or contact details of the closed family');

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table tut_req as select public.admin_record_deletion_request(p_tutor_id => 'b0000000-0000-0000-0000-000000000002') as id;
reset role;
grant select on tut_req to service_role;
set role service_role;
create temp table tut_del as select public.perform_account_deletion((select id from tut_req), 'a0000000-0000-0000-0000-00000000000a') as s;
reset role;
select pg_temp.check(not exists (select 1 from public.tutor_documents where tutor_id = 'b0000000-0000-0000-0000-000000000002')
  and (select s->'storagePaths' @> '["vetting/tutors/b0000000-0000-0000-0000-000000000002/police.pdf"]' from tut_del),
  'closing a tutor removes their vetting documents and lists the files for removal');
select pg_temp.check(not exists (select 1 from public.audit_events where tutor_id = 'b0000000-0000-0000-0000-000000000002'
    and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '(tom@x|Tom Two)'),
  'the audit log keeps no name or address of the closed tutor');

set role service_role;
select public.perform_account_deletion(public.begin_account_deletion('a0000000-0000-0000-0000-0000000000ac',
                                                                    'a0000000-0000-0000-0000-0000000000ac'), null);
reset role;
select pg_temp.check(not exists (select 1 from public.accountant_invites where email = 'books@x'),
  'closing an accountant''s login withdraws their invitation');

-- 9. Migrations ledger ---------------------------------------------------------------------------
select pg_temp.check((select count(*) from public.db_migrations) = :migration_count
  and exists (select 1 from public.db_migrations where version = '20261111000000' and name = 'round5_merge'),
  'the ledger lists every migration file, including the round 5 merge');

\echo 'All round 5 merge tests passed'
