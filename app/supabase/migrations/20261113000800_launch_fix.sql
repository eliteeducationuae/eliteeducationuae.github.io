-- Elite Education — launch readiness after the round 5 merge: account deletion and "Download my data" reach every
-- round 5 table.
--
--  1. Deletion summary: closing a family also counts the credit notes and refunds that are kept with its invoices and
--     payments, and the administrators' notice lists them ("2 invoices, 1 credit note, 2 payments and 1 refund").
--     Invoices, credit notes, payments and refunds are never deleted (the tax migration's guards refuse it).
--  2. Names written beside actions: an advisory update's author and the person who ticked off an admissions task are
--     replaced with 'Former tutor' (and so on) when that login or tutor is closed, as the merge already does for
--     admissions documents and vetting reviews.
--  3. The spam submission log drops the address of a closed tutor or login, as it already does for a closed family.
--  4. "Download my data" adds what the round 5 tables hold about the person: the admissions shortlist with key dates,
--     tasks and the family's timeline; agreed hourly prices; shared lesson plans; and, for tutors, their pay rates,
--     handover packs, lesson plans and vetting overrides; for an accountant, their invitation.
--     Not exported, because they hold nothing personal or only the office's own records: view_as_sessions and
--     view_as_audit (administrators' support log), audit_events (the office's change log, erased on deletion),
--     captcha_passes, submission_log (hashed, kept for a day), tutor_document_alerts and handbook_versions.
--  5. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. Deletion summary: credit notes and refunds are kept and counted
-- ---------------------------------------------------------------------------

/** "2 invoices, 1 credit note, 2 payments and 1 refund"; credit notes and refunds only when there are any. */
create function public.deletion_kept_records(p_summary jsonb) returns text
language sql immutable as $$
  select case
    when coalesce((p_summary->>'creditNotesRetained')::int, 0) = 0 and coalesce((p_summary->>'refundsRetained')::int, 0) = 0
      then public.deletion_count(p_summary, 'invoicesRetained', 'invoice', 'invoices')
           || ' and ' || public.deletion_count(p_summary, 'paymentsRetained', 'payment', 'payments')
    else array_to_string(array_remove(array[
             public.deletion_count(p_summary, 'invoicesRetained', 'invoice', 'invoices'),
             case when coalesce((p_summary->>'creditNotesRetained')::int, 0) > 0
                  then public.deletion_count(p_summary, 'creditNotesRetained', 'credit note', 'credit notes') end,
             public.deletion_count(p_summary, 'paymentsRetained', 'payment', 'payments')], null), ', ')
         || case when coalesce((p_summary->>'refundsRetained')::int, 0) > 0
                 then ' and ' || public.deletion_count(p_summary, 'refundsRetained', 'refund', 'refunds')
                 else '' end
  end
$$;
revoke all on function public.deletion_kept_records(jsonb) from public, anon, authenticated;

-- The function keeps its body and grants; only the kept-records sentence changes.
do $$
declare def text := pg_get_functiondef('public.perform_account_deletion(uuid, uuid)'::regprocedure);
        old text := 'public.deletion_count(v_summary, ''invoicesRetained'', ''invoice'', ''invoices'')
      || '' and '' || public.deletion_count(v_summary, ''paymentsRetained'', ''payment'', ''payments'')';
begin
  if position(old in def) = 0 then raise exception 'Expected the kept-records sentence in perform_account_deletion'; end if;
  execute replace(def, old, 'public.deletion_kept_records(v_summary)');
end $$;

/** A family's round 5 records: plans for its children's lessons, other contacts, spam log entries and the audit log. */
create or replace function public.anonymise_family(p_family_id uuid) returns jsonb
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
  -- Kept for tax records with the invoices and payments.
  return part || jsonb_build_object(
    'creditNotesRetained', (select count(*) from public.credit_notes where family_id = p_family_id),
    'refundsRetained', (select count(*) from public.refunds where family_id = p_family_id));
end $$;

-- ---------------------------------------------------------------------------
-- 2 and 3. Names beside actions, and the spam log
-- ---------------------------------------------------------------------------

/** A tutor's round 5 records: vetting documents (with their files), override reasons, tasks, spam log and audit log. */
create or replace function public.anonymise_tutor(p_tutor_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare part jsonb; paths jsonb; t public.tutors;
begin
  select * into t from public.tutors where id = p_tutor_id;
  -- Police clearance certificates, passports and qualifications are removed with their files.
  select coalesce(jsonb_agg('vetting/' || d.file_path), '[]') into paths
    from public.tutor_documents d where d.tutor_id = p_tutor_id and d.file_path is not null;
  delete from public.tutor_documents where tutor_id = p_tutor_id;
  update public.tutor_vetting_overrides set reason = 'Removed: account closed' where tutor_id = p_tutor_id;
  -- Tasks the adviser ticked off keep only that they were done.
  update public.admissions_tasks k set done_by_name = 'Former tutor'
    from public.admissions_cases c
   where c.id = k.case_id and c.adviser_tutor_id = p_tutor_id and k.done_by_name = t.full_name;
  -- Their application address in the spam log.
  delete from public.submission_log where email is not null and lower(email) = lower(t.email);

  part := public.anonymise_tutor_records(p_tutor_id);
  perform public.audit_erase('{}', '{}', array[p_tutor_id], '{}');
  return part || jsonb_build_object('storagePaths', coalesce(part->'storagePaths', '[]') || paths);
end $$;

/** A login's round 5 records: an accountant's invitation, names written beside their actions, their audit name. */
create or replace function public.anonymise_profile_data(p_profile_id uuid) returns void
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
  update public.admissions_updates set author_name = former where author_id = p_profile_id;
  -- Tasks keep no id of who ticked them off, so the name is matched within the cases this login could act on.
  update public.admissions_tasks k set done_by_name = former
    from public.admissions_cases c
   where c.id = k.case_id and k.done_by_name = p.full_name
     and (p.role = 'admin'
          or (p.tutor_id is not null and c.adviser_tutor_id = p.tutor_id)
          or (p.family_id is not null and c.family_id = p.family_id)
          or (p.student_id is not null and c.student_id = p.student_id));
  update public.tutor_documents set verified_by_name = former where verified_by = p_profile_id;
  update public.tutor_vetting_overrides set created_by_name = former where created_by = p_profile_id;
  update public.tutor_vetting_overrides set revoked_by_name = former where revoked_by = p_profile_id;
  delete from public.submission_log where email is not null and lower(email) = lower(btrim(p.email));

  perform public.anonymise_profile_records(p_profile_id);
  perform public.audit_erase('{}', '{}', '{}', array[p_profile_id]);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Download my data: the rest of the round 5 records
-- ---------------------------------------------------------------------------

alter function public.export_my_data() rename to export_my_data_round5;
revoke all on function public.export_my_data_round5() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  base jsonb := public.export_my_data_round5();
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
    -- Admissions advisory, as the family sees it: shortlist, key dates, tasks, published updates, shared documents
    -- (names only) and the family's timeline.
    'admissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'studentId', c.student_id, 'kind', c.kind, 'title', c.title, 'entryYear', c.entry_year, 'status', c.status,
        'summary', c.summary,
        'shortlist', (select coalesce(jsonb_agg(jsonb_build_object('institution', t.institution, 'country', t.country,
                        'programme', t.programme, 'entryYear', t.entry_year, 'status', t.status,
                        'decisionDate', t.decision_date) order by t.sort, t.institution), '[]')
                      from public.admissions_targets t where t.case_id = c.id),
        'keyDates', (select coalesce(jsonb_agg(jsonb_build_object('title', d.title, 'kind', d.kind, 'dueOn', d.due_on,
                        'time', d.time_of_day, 'done', d.done) order by d.due_on, d.title), '[]')
                      from public.admissions_dates d where d.case_id = c.id),
        'tasks', (select coalesce(jsonb_agg(jsonb_build_object('title', k.title, 'details', k.details, 'dueOn', k.due_on,
                        'owner', k.owner, 'doneAt', k.done_at) order by k.due_on nulls last, k.created_at), '[]')
                      from public.admissions_tasks k where k.case_id = c.id),
        'updates', (select coalesce(jsonb_agg(jsonb_build_object('title', u.title, 'period', u.period, 'body', u.body,
                        'publishedAt', u.published_at) order by u.published_at), '[]')
                      from public.admissions_updates u where u.case_id = c.id and u.status = 'published'),
        'documents', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'category', d.category,
                        'addedAt', d.created_at) order by d.created_at), '[]')
                      from public.admissions_documents d
                      where d.case_id = c.id and (d.family_visible or d.uploaded_by = p.id)),
        'timeline', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'title', e.title, 'detail', e.detail)
                        order by e.at), '[]')
                      from public.admissions_events e where e.case_id = c.id and e.family_visible))
        order by c.created_at), '[]')
      from public.admissions_cases c where c.student_id = any (sids)),
    -- The hourly price agreed for each of the children's subjects.
    'agreedPrices', case when fam_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
        'studentId', e.student_id, 'subject', e.subject, 'hourlyPrice', fp.hourly_price, 'updatedAt', fp.updated_at)
        order by e.created_at), '[]')
      from public.enrolment_family_price fp join public.enrolments e on e.id = fp.enrolment_id
      where e.student_id = any (sids)) end,
    -- Lesson plans: a family gets the plans shared with it (with homework planned for everyone or for its own
    -- children); a tutor gets the plans for their lessons.
    'lessonPlans', case
      when cardinality(sids) > 0 then (select coalesce(jsonb_agg(jsonb_build_object(
          'lessonId', lp.lesson_id, 'lessonStart', l.start_at, 'objectives', lp.objectives,
          'homework', (select coalesce(jsonb_agg(jsonb_build_object('title', h->>'title', 'details', h->>'details',
                         'studentId', h->>'studentId')), '[]')
                       from jsonb_array_elements(lp.homework) h
                       where h->>'studentId' is null or (h->>'studentId')::uuid = any (sids)),
          'updatedAt', lp.updated_at) order by l.start_at), '[]')
        from public.lesson_plans lp join public.lessons l on l.id = lp.lesson_id
        where lp.shared_with_family and l.student_ids && sids)
      when tid is not null then (select coalesce(jsonb_agg(jsonb_build_object(
          'lessonId', lp.lesson_id, 'lessonStart', l.start_at, 'objectives', lp.objectives, 'homework', lp.homework,
          'sharedWithFamily', lp.shared_with_family, 'updatedAt', lp.updated_at) order by l.start_at), '[]')
        from public.lesson_plans lp join public.lessons l on l.id = lp.lesson_id where l.tutor_id = tid)
      else '[]'::jsonb end,
    -- A tutor's hourly pay for each of their subjects.
    'tutorPay', (select coalesce(jsonb_agg(jsonb_build_object(
        'subject', e.subject, 'studentId', e.student_id, 'hourlyPay', tp.hourly_pay, 'updatedAt', tp.updated_at)
        order by e.created_at), '[]')
      from public.enrolment_tutor_pay tp join public.enrolments e on e.id = tp.enrolment_id where e.tutor_id = tid),
    -- Handover packs the tutor received or wrote.
    'handovers', (select coalesce(jsonb_agg(jsonb_build_object(
        'createdAt', h.created_at, 'reason', h.reason, 'studentName', h.student_name, 'subject', h.subject,
        'direction', case when h.to_tutor_id = tid then 'received' else 'written' end, 'note', h.note)
        order by h.created_at), '[]')
      from public.handovers h where h.to_tutor_id = tid or h.from_tutor_id = tid),
    -- Time-limited permissions to work before vetting was complete.
    'vettingOverrides', (select coalesce(jsonb_agg(jsonb_build_object(
        'reason', o.reason, 'createdAt', o.created_at, 'expiresAt', o.expires_at, 'revokedAt', o.revoked_at)
        order by o.created_at), '[]')
      from public.tutor_vetting_overrides o where o.tutor_id = tid),
    'accountantInvitation', case when p.role = 'accountant' then (select jsonb_build_object(
        'fullName', i.full_name, 'email', i.email, 'invitedAt', i.invited_at, 'acceptedAt', i.accepted_at)
      from public.accountant_invites i where i.email = lower(btrim(p.email))) end
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113000800', 'launch_fix');
