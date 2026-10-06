-- Elite Education — account deletion follow-ups to the round 5 merge.
--
--  1. Closing a family also removes what is still queued for its other contacts. The launch migration removed only
--     emails addressed to the family's main address; emails and WhatsApp messages queued against another contact
--     (notification_outbox.contact_id is "on delete set null", so deleting the contact left them queued and
--     anonymous) were still sent after the account was closed. Every outbox row addressed to one of the family's
--     contacts (by contact, email address or WhatsApp number) is now removed before the contacts go.
--  2. Closing an accountant's login also erases their name and address from the audit trail of their invitation
--     (audit_erase blanked only their name as the person who made changes).
--  3. Names written beside work survive no longer: admissions updates (author), admissions tasks (completed by) and
--     handbook versions (published by) read 'Former …' / 'Elite Education' once the login is closed. Tasks now record
--     who completed them (admissions_tasks.done_by); tasks completed before this migration are matched by name.
--  4. The migrations ledger records this file.
--
-- anonymise_family and anonymise_profile_data were also redefined by 20261113000800_launch_fix; the versions here keep
-- every launch_fix change (credit notes and refunds counted, tasks matched by name only within the login's cases, the
-- spam log address removed) as well as this file's.

-- ---------------------------------------------------------------------------
-- 3a. Admissions tasks record who completed them
-- ---------------------------------------------------------------------------

alter table public.admissions_tasks add column if not exists done_by uuid references public.profiles(id) on delete set null;

create or replace function pg_temp.swap_literal(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare def text := pg_get_functiondef(p_fn);
begin
  if position(p_from in def) = 0 then
    raise exception 'Expected % in %', p_from, p_fn;
  end if;
  execute replace(def, p_from, p_to);
end $$;

select pg_temp.swap_literal('public.set_admissions_task_done(uuid, boolean)',
  'set done_at = now(), done_by_name = me.full_name', 'set done_at = now(), done_by = me.id, done_by_name = me.full_name');
select pg_temp.swap_literal('public.set_admissions_task_done(uuid, boolean)',
  'set done_at = null, done_by_name = null', 'set done_at = null, done_by = null, done_by_name = null');

-- ---------------------------------------------------------------------------
-- 1. Closing a family: nothing queued for any of its contacts is sent
-- ---------------------------------------------------------------------------

/** A family's round 5 records: plans for its children's lessons, other contacts, spam log entries and the audit log. */
create or replace function public.anonymise_family(p_family_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare part jsonb; sids uuid[]; v_email text; c_ids uuid[]; c_emails text[]; c_numbers text[]; member_ids uuid[];
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

  -- Everything queued for (or already sent to) any of the family's contacts goes, before the records below replace
  -- the main contact's details and the other contacts are deleted (which would leave their messages queued with no
  -- contact). Messages for another person's login are left alone, even if an address or number happens to match.
  select coalesce(array_agg(c.id), '{}'),
         coalesce(array_agg(lower(c.email)) filter (where c.email is not null), '{}'),
         coalesce(array_agg(public.contact_whatsapp_number(c.phone))
                    filter (where public.contact_whatsapp_number(c.phone) is not null), '{}')
    into c_ids, c_emails, c_numbers
    from public.family_contacts c where c.family_id = p_family_id;
  if v_email is not null then c_emails := c_emails || v_email; end if;
  select c_numbers || coalesce(array_agg(n) filter (where n is not null), '{}') into c_numbers
    from (select public.contact_whatsapp_number(phone) as n from public.families where id = p_family_id) f;
  member_ids := array(select id from public.profiles
                       where family_id = p_family_id
                          or (role = 'student' and student_id = any (sids))
                          or id in (select profile_id from public.family_contacts
                                     where family_id = p_family_id and profile_id is not null));
  delete from public.notification_outbox o
   where o.contact_id = any (c_ids)
      or ((o.profile_id is null or o.profile_id = any (member_ids))
          and ((o.email is not null and lower(o.email) = any (c_emails))
               or (o.whatsapp_to is not null and o.whatsapp_to = any (c_numbers))));

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
  -- Kept for tax records with the invoices and payments (as 20261113000800_launch_fix).
  return part || jsonb_build_object(
    'creditNotesRetained', (select count(*) from public.credit_notes where family_id = p_family_id),
    'refundsRetained', (select count(*) from public.refunds where family_id = p_family_id));
end $$;
revoke all on function public.anonymise_family(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 and 3. Closing a login: the accountant's invitation history and names beside their work
-- ---------------------------------------------------------------------------

/** A login's round 5 records: an accountant's invitation, names written beside their actions, their audit name. */
create or replace function public.anonymise_profile_data(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles; former text; v_email text;
begin
  select * into p from public.profiles where id = p_profile_id;
  if p.id is null then return; end if;
  former := case p.role when 'tutor' then 'Former tutor' when 'student' then 'Former student'
                        when 'admin' then 'Elite Education' when 'accountant' then 'Former accountant'
                        else 'Former parent' end;
  v_email := lower(btrim(p.email));
  if p.role = 'accountant' then
    delete from public.accountant_invites where email = v_email;
  end if;
  update public.admissions_documents set uploaded_by_name = former where uploaded_by = p_profile_id;
  update public.tutor_documents set verified_by_name = former where verified_by = p_profile_id;
  update public.tutor_vetting_overrides set created_by_name = former where created_by = p_profile_id;
  update public.tutor_vetting_overrides set revoked_by_name = former where revoked_by = p_profile_id;
  update public.admissions_updates set author_name = former where author_id = p_profile_id;
  update public.handbook_versions set published_by_name = former where published_by = p_profile_id;
  -- Tasks completed before done_by was recorded carry only the name, matched within the cases this login could act on
  -- (as 20261113000800_launch_fix).
  update public.admissions_tasks set done_by_name = former where done_by = p_profile_id;
  update public.admissions_tasks k set done_by_name = former
    from public.admissions_cases c
   where c.id = k.case_id and k.done_by is null and p.full_name is not null and k.done_by_name = p.full_name
     and (p.role = 'admin'
          or (p.tutor_id is not null and c.adviser_tutor_id = p.tutor_id)
          or (p.family_id is not null and c.family_id = p.family_id)
          or (p.student_id is not null and c.student_id = p.student_id));
  -- Their address in the spam log (as 20261113000800_launch_fix).
  delete from public.submission_log where email is not null and lower(email) = v_email;

  perform public.anonymise_profile_records(p_profile_id);
  perform public.audit_erase('{}', '{}', '{}', array[p_profile_id]);
  -- The audit trail of an accountant's invitation (including its withdrawal just above) names them and their address.
  if p.role = 'accountant' and v_email is not null then
    perform set_config('elite.audit_erasing', 'on', true);
    update public.audit_events e
       set before = public.audit_scrub(e.before), after = public.audit_scrub(e.after)
     where e.table_name = 'accountant_invites'
       and (lower(e.before->>'email') = v_email or lower(e.after->>'email') = v_email);
    perform set_config('elite.audit_erasing', 'off', true);
  end if;
end $$;
revoke all on function public.anonymise_profile_data(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001600', 'deletion_fix');
