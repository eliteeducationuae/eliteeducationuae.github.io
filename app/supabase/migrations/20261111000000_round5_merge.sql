-- Elite Education — round 5 merge: the changes that only make sense once every round 5 feature is in one database.
--
--  1. Round 4 follow-up wording restored. Round 5 migrations (rates, contacts, spam) redefined functions that the round 4
--     follow-up (20261014000000_round4_qa_fixes.sql) had corrected, bringing back '/admin/enquiries' links and
--     '2026-08-17' dates on charges. The corrections are applied again to whatever the functions now hold.
--     The admissions timeline also names the month of a monthly update when it is sent.
--  2. Roles: profiles_role_check is the union of every branch's roles (round 5 adds only 'accountant').
--  3. Enquiries: families can no longer read their own enquiry rows, which carry the office's staff-only notes
--     (including spam-protection notes). Only administrators read enquiries; the app never showed them to families.
--  4. Accountant access and family contacts: an address used by any family contact (not only a family's main email)
--     can never become an accountant login, and an accountant's login can never be given family sign-in. (An invitation
--     that has not been accepted still gives way to a family, as the tax migration intends.)
--  5. Account deletion covers the round 5 records: family contacts, admissions cases and their files, handover packs,
--     lesson plans, tutor vetting documents and their files, accountant invitations, the spam submission log, and the
--     audit log (personal values erased). Invoices, credit notes, payments and refunds are always kept.
--  6. "Download my data" includes family contacts, credit notes, refunds, admissions advisory, tutor documents and
--     handbook acknowledgements.
--  7. View as: the read-only RPCs added in round 5 are allowed while viewing; every other new RPC is refused by the
--     existing guard, which already makes each viewed request read-only.
--  8. Audit log: credit notes, refunds, accountant invitations, admissions cases, tutor documents and vetting overrides
--     are recorded, and erasure also blanks personal values nested inside objects (an invoice's customer).
--  9. The migrations ledger lists every migration, including this one.

-- ---------------------------------------------------------------------------
-- 1. Round 4 follow-up wording, applied again after round 5 redefined the functions
-- ---------------------------------------------------------------------------

do $$
declare f record; def text;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and (p.prosrc like '%''/admin/enquiries''%' or p.prosrc like '%''/admin/requests''%'
            or p.prosrc like '%''/manage/tutor-invoice/''%')
  loop
    def := pg_get_functiondef(f.sig);
    def := replace(def, '''/admin/enquiries''', '''/manage/enquiries''');
    def := replace(def, '''/admin/requests''', '''/manage/requests''');
    def := replace(def, '''/manage/tutor-invoice/''', '''/tutor-invoices/''');
    -- create or replace keeps the function's owner and grants.
    execute def;
  end loop;
end $$;

update public.notification_outbox set url = case
    when url = '/admin/enquiries' then '/manage/enquiries'
    when url = '/admin/requests' then '/manage/requests'
    else '/tutor-invoices/' || substr(url, length('/manage/tutor-invoice/') + 1)
  end
 where sent_at is null
   and (url in ('/admin/enquiries', '/admin/requests') or url like '/manage/tutor-invoice/%');

-- Each function keeps its body and grants; only the quoted text changes. Stops if the expected text is missing.
create function pg_temp.swap_literal(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare def text := pg_get_functiondef(p_fn);
begin
  if position(p_from in def) = 0 then
    raise exception 'Expected % in %', p_from, p_fn;
  end if;
  execute replace(def, p_from, p_to);
end $$;

-- Charges read '17 Aug 2026', including the agreed-price lines added by the rates migration.
select pg_temp.swap_literal('public.apply_charges(uuid, jsonb)', '''YYYY-MM-DD''', '''FMDD Mon YYYY''');

-- Admissions follow-up: the timeline reads 'Advisory update sent: October 2026' (or the update's title), not
-- 'Advisory update: October 2026 advisory update'. Mirrors advisoryUpdateSentTitle() in src/domain/admissions.ts.
select pg_temp.swap_literal('public.set_advisory_update_status(uuid, text)',
  '''Advisory update: '' || u.title',
  '''Advisory update sent: '' || case when u.kind = ''monthly'' and nullif(trim(u.period), '''') is not null
                                          then trim(u.period) else trim(u.title) end');

-- ---------------------------------------------------------------------------
-- 2. Roles
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check,
  add constraint profiles_role_check check (role in ('admin', 'tutor', 'parent', 'student', 'accountant'));

-- ---------------------------------------------------------------------------
-- 3. Enquiries: staff-only notes stay with the office
-- ---------------------------------------------------------------------------

-- "admin enquiries" (20261004000000_engagement.sql) still lets administrators read and change every enquiry.
drop policy if exists "see enquiries" on public.enquiries;

-- ---------------------------------------------------------------------------
-- 4. Accountant access and family contacts
-- ---------------------------------------------------------------------------

select pg_temp.swap_literal('public.invite_accountant(text, text)',
  'or exists (select 1 from public.families where lower(email) = v_email))',
  'or exists (select 1 from public.families where lower(email) = v_email)
                       or exists (select 1 from public.family_contacts where lower(btrim(email)) = v_email))');

select pg_temp.swap_literal('public.link_accountant_login()',
  'or exists (select 1 from public.families where lower(email) = inv.email) then',
  'or exists (select 1 from public.families where lower(email) = inv.email)
     or exists (select 1 from public.family_contacts where lower(btrim(email)) = inv.email) then');

select pg_temp.swap_literal('public.login_email_taken(text, uuid)',
  'p.role in (''admin'', ''tutor''))',
  'p.role in (''admin'', ''tutor'', ''accountant''))');

-- ---------------------------------------------------------------------------
-- 5. Account deletion: the round 5 records
-- ---------------------------------------------------------------------------
-- The launch functions keep their work under new names and are wrapped, so perform_account_deletion (which calls them
-- by name) now also clears the round 5 records. Invoices, credit notes, payments and refunds are never deleted; the
-- tax migration's guards would refuse it in any case.

alter function public.anonymise_student(uuid) rename to anonymise_student_records;
alter function public.anonymise_family(uuid) rename to anonymise_family_records;
alter function public.anonymise_tutor(uuid) rename to anonymise_tutor_records;
alter function public.anonymise_profile_data(uuid) rename to anonymise_profile_records;

/** A student's round 5 records go first: admissions cases (with their files), handover packs and planned homework. */
create function public.anonymise_student(p_student_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare part jsonb; folders jsonb;
begin
  -- Admissions advisory: shortlists, key dates, tasks, letters, documents and the timeline are all about the child.
  select coalesce(jsonb_agg('admissions/cases/' || c.id::text || '/'), '[]') into folders
    from public.admissions_cases c where c.student_id = p_student_id;
  delete from public.admissions_cases where student_id = p_student_id;
  -- Handover packs carry the student's name, goals and the previous tutor's note about them.
  delete from public.handovers where student_id = p_student_id;
  -- Lesson plans: plans for lessons that were only theirs go; elsewhere only the homework planned for them goes.
  delete from public.lesson_plans lp using public.lessons l
   where l.id = lp.lesson_id and l.student_ids <@ array[p_student_id];
  update public.lesson_plans
     set homework = (select coalesce(jsonb_agg(h), '[]') from jsonb_array_elements(homework) h
                      where h->>'studentId' is distinct from p_student_id::text)
   where homework @> jsonb_build_array(jsonb_build_object('studentId', p_student_id::text));

  part := public.anonymise_student_records(p_student_id);
  return part || jsonb_build_object('storageFolders', coalesce(part->'storageFolders', '[]') || folders);
end $$;
revoke all on function public.anonymise_student(uuid) from public, anon, authenticated;
revoke all on function public.anonymise_student_records(uuid) from public, anon, authenticated;

/** A family's round 5 records: plans for its children's lessons, other contacts, spam log entries and the audit log. */
create function public.anonymise_family(p_family_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare part jsonb; sids uuid[]; v_email text;
begin
  select lower(email) into v_email from public.families where id = p_family_id;
  sids := array(select id from public.students where family_id = p_family_id);
  if cardinality(sids) > 0 then
    delete from public.lesson_plans lp using public.lessons l
     where l.id = lp.lesson_id and l.student_ids <@ sids and cardinality(l.student_ids) > 0;
  end if;
  -- Rate limiting keeps addresses for a day at most, but nothing about a closed family should remain.
  delete from public.submission_log
   where email is not null and (lower(email) = v_email
         or lower(email) in (select lower(c.email) from public.family_contacts c where c.family_id = p_family_id));

  part := public.anonymise_family_records(p_family_id);

  -- Contacts: everyone but the main contact goes. The main contact has just taken the family's anonymised details
  -- (families_sync_contact), and keeps no sign-in, notices or WhatsApp consent.
  delete from public.family_contacts where family_id = p_family_id and not is_primary;
  update public.family_contacts
     set can_log_in = false, receives_invoices = false, receives_reports = false, receives_lesson_notes = false,
         receives_whatsapp = false, emergency_contact = false, phone = null
   where family_id = p_family_id;
  -- Billing details on the family go; the tax invoices and credit notes keep their own copy of the customer.
  update public.family_billing set billing_name = null, billing_address = null, trn = null where family_id = p_family_id;

  -- The audit log keeps that each change happened, without the family's names, contact details or free text.
  perform public.audit_erase(array[p_family_id], sids, '{}', '{}');
  return part;
end $$;
revoke all on function public.anonymise_family(uuid) from public, anon, authenticated;
revoke all on function public.anonymise_family_records(uuid) from public, anon, authenticated;

/** A tutor's round 5 records: vetting documents (with their files), override reasons and the audit log. */
create function public.anonymise_tutor(p_tutor_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare part jsonb; paths jsonb;
begin
  -- Police clearance certificates, passports and qualifications are removed with their files.
  select coalesce(jsonb_agg('vetting/' || d.file_path), '[]') into paths
    from public.tutor_documents d where d.tutor_id = p_tutor_id and d.file_path is not null;
  delete from public.tutor_documents where tutor_id = p_tutor_id;
  update public.tutor_vetting_overrides set reason = 'Removed: account closed' where tutor_id = p_tutor_id;

  part := public.anonymise_tutor_records(p_tutor_id);
  perform public.audit_erase('{}', '{}', array[p_tutor_id], '{}');
  return part || jsonb_build_object('storagePaths', coalesce(part->'storagePaths', '[]') || paths);
end $$;
revoke all on function public.anonymise_tutor(uuid) from public, anon, authenticated;
revoke all on function public.anonymise_tutor_records(uuid) from public, anon, authenticated;

/** A login's round 5 records: an accountant's invitation, names written beside their actions, their audit name. */
create function public.anonymise_profile_data(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles; former text;
begin
  select * into p from public.profiles where id = p_profile_id;
  if p.id is null then return; end if;
  former := case p.role when 'tutor' then 'Former tutor' when 'student' then 'Former student'
                        when 'admin' then 'Elite Education' when 'accountant' then 'Former accountant'
                        else 'Former parent' end;
  if p.role = 'accountant' then
    delete from public.accountant_invites where email = lower(btrim(p.email));
  end if;
  update public.admissions_documents set uploaded_by_name = former where uploaded_by = p_profile_id;
  update public.tutor_documents set verified_by_name = former where verified_by = p_profile_id;
  update public.tutor_vetting_overrides set created_by_name = former where created_by = p_profile_id;
  update public.tutor_vetting_overrides set revoked_by_name = former where revoked_by = p_profile_id;

  perform public.anonymise_profile_records(p_profile_id);
  perform public.audit_erase('{}', '{}', '{}', array[p_profile_id]);
end $$;
revoke all on function public.anonymise_profile_data(uuid) from public, anon, authenticated;
revoke all on function public.anonymise_profile_records(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Download my data: the round 5 records
-- ---------------------------------------------------------------------------

alter function public.export_my_data() rename to export_my_data_base;
revoke all on function public.export_my_data_base() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  base jsonb := public.export_my_data_base();
  p public.profiles;
  fam_id uuid;
  sids uuid[] := '{}';
  tid uuid;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.role = 'parent' then fam_id := p.family_id; end if;
  if fam_id is not null then
    sids := array(select id from public.students where family_id = fam_id);
  elsif p.role = 'student' and p.student_id is not null then
    sids := array[p.student_id];
  end if;
  if p.role in ('tutor', 'admin') then tid := p.tutor_id; end if;

  return base || jsonb_build_object(
    'familyContacts', case when fam_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
        'name', c.name, 'relationship', c.relationship, 'email', c.email, 'phone', c.phone,
        'preferredChannel', c.preferred_channel, 'canLogIn', c.can_log_in, 'receivesInvoices', c.receives_invoices,
        'receivesReports', c.receives_reports, 'receivesLessonNotes', c.receives_lesson_notes,
        'receivesWhatsApp', c.receives_whatsapp, 'emergencyContact', c.emergency_contact, 'isPrimary', c.is_primary)
        order by c.is_primary desc, c.name), '[]')
      from public.family_contacts c where c.family_id = fam_id) end,
    'creditNotes', case when fam_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
        'number', n.number, 'invoiceNumber', i.number, 'issueDate', n.issue_date, 'reason', n.reason,
        'subtotal', n.subtotal, 'vat', n.vat, 'total', n.total) order by n.issue_date, n.number), '[]')
      from public.credit_notes n join public.invoices i on i.id = n.invoice_id where n.family_id = fam_id) end,
    'refunds', case when fam_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
        'invoiceNumber', i.number, 'amount', r.amount, 'method', r.method, 'status', r.status, 'reason', r.reason,
        'createdAt', r.created_at, 'settledAt', r.settled_at) order by r.created_at), '[]')
      from public.refunds r join public.invoices i on i.id = r.invoice_id where r.family_id = fam_id) end,
    -- Admissions advisory: cases, published updates and the documents shared with the family (names only).
    'admissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'studentId', c.student_id, 'kind', c.kind, 'title', c.title, 'entryYear', c.entry_year, 'status', c.status,
        'shortlist', (select coalesce(jsonb_agg(jsonb_build_object('institution', t.institution, 'status', t.status)
                        order by t.sort, t.institution), '[]') from public.admissions_targets t where t.case_id = c.id),
        'updates', (select coalesce(jsonb_agg(jsonb_build_object('title', u.title, 'period', u.period, 'body', u.body,
                        'publishedAt', u.published_at) order by u.published_at), '[]')
                      from public.admissions_updates u where u.case_id = c.id and u.status = 'published'),
        'documents', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'category', d.category,
                        'addedAt', d.created_at) order by d.created_at), '[]')
                      from public.admissions_documents d where d.case_id = c.id and d.family_visible))
        order by c.created_at), '[]')
      from public.admissions_cases c where c.student_id = any (sids)),
    -- Tutor vetting: which documents were provided and their review status (the files themselves are not included).
    'tutorDocuments', (select coalesce(jsonb_agg(jsonb_build_object(
        'type', d.doc_type, 'title', d.title, 'fileName', d.file_name, 'issueDate', d.issue_date,
        'expiryDate', d.expiry_date, 'status', d.status, 'uploadedAt', d.created_at) order by d.created_at), '[]')
      from public.tutor_documents d where d.tutor_id = tid),
    'handbookAcknowledgements', (select coalesce(jsonb_agg(jsonb_build_object(
        'version', a.version, 'acknowledgedAt', a.acknowledged_at) order by a.version), '[]')
      from public.handbook_acknowledgements a where a.tutor_id = tid)
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. View as: round 5 read-only RPCs
-- ---------------------------------------------------------------------------

create or replace function public.view_as_read_rpcs() returns text[]
language sql immutable as $$
  select array['my_threads', 'list_resources', 'login_emails', 'open_slots', 'is_view_as_session', 'current_view_as',
               -- Round 5 reads a parent, student or tutor makes: family contacts, tutor checks, lesson plans and packs.
               'list_family_contacts', 'tutor_compliance', 'visible_lesson_plans', 'handover_pack']
$$;

-- ---------------------------------------------------------------------------
-- 8. Audit log: round 5 records
-- ---------------------------------------------------------------------------

-- Erasure reaches inside nested objects too: the tax migration stores the customer (name, email, address) on each
-- invoice and credit note, so audit_scrub now also blanks personal values within objects.
create or replace function public.audit_scrub(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when p is null then null else (
    select coalesce(jsonb_object_agg(k,
      case when v <> 'null'::jsonb and v <> to_jsonb('[redacted]'::text)
                and k ~* '(name|email|phone|whatsapp|address|summary|notes?$|comment|details|reason|next_steps|title|pitch|description|school|birth|dob|meeting_url)'
           then to_jsonb('[erased]'::text)
           when jsonb_typeof(v) = 'object' then public.audit_scrub(v)
           -- Invoice lines name the student in their description.
           when jsonb_typeof(v) = 'array' then (
             select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' then public.audit_scrub(x) else x end), '[]'::jsonb)
             from jsonb_array_elements(v) x)
           else v end), '{}'::jsonb)
    from jsonb_each(p) as e(k, v)) end
$$;
revoke all on function public.audit_scrub(jsonb) from public, anon, authenticated;

select public.audit_attach('public.credit_notes');
select public.audit_attach('public.refunds');
select public.audit_attach('public.accountant_invites');
select public.audit_attach('public.admissions_cases');
select public.audit_attach('public.tutor_documents');
select public.audit_attach('public.tutor_vetting_overrides');

-- ---------------------------------------------------------------------------
-- 9. Migrations ledger
-- ---------------------------------------------------------------------------

insert into public.db_migrations (version, name) values
  ('20261002000000', 'init'),
  ('20261003000000', 'auto_link_logins'),
  ('20261004000000', 'engagement'),
  ('20261005000000', 'operations'),
  ('20261006000000', 'social_sign_in'),
  ('20261007000000', 'subjects'),
  ('20261008000000', 'homework'),
  ('20261009000000', 'calendar'),
  ('20261010000000', 'payments'),
  ('20261011000000', 'whatsapp'),
  ('20261012000000', 'invoice_notifications'),
  ('20261012010000', 'classwork_security'),
  ('20261013000000', 'review_fixes'),
  ('20261014000000', 'round4_qa_fixes'),
  ('20261101000000', 'viewas'),
  ('20261102000000', 'rates'),
  ('20261103000000', 'contacts'),
  ('20261104000000', 'audit'),
  ('20261105000000', 'tax'),
  ('20261106000000', 'admissions'),
  ('20261107000000', 'vetting'),
  ('20261108000000', 'launch'),
  ('20261109000000', 'spam'),
  ('20261110000000', 'handover')
on conflict (version) do nothing;

select public.record_migration('20261111000000', 'round5_merge');
