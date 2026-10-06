-- Elite Education — closing a family contact's own login no longer closes the family.
--
-- Since round 5 every family contact who may sign in (a driver, a PA, another parent) has a parent login linked to the
-- family. "Delete my account" treated every parent login as the family: a driver who closed their own sign-in closed
-- the whole family, anonymised the children and deleted the main contact's login.
--
--  1. account_closes_own_login_only: a parent login closes only itself when it is linked to a contact who is not the
--     family's main contact and another contact of the family can still sign in. The main contact, or the family's last
--     sign-in contact, still closes the whole family (as before). Mirrors closesOwnLoginOnly() in src/domain/data-rights.ts.
--  2. begin_account_deletion (self-service only, called by the delete-account Edge Function) records such a request as
--     the contact's own login, without the family.
--  3. perform_account_deletion: a request the person made for themselves (requested_by = profile_id) whose login is a
--     non-main contact removes that contact from the family (as remove_family_contact does) and anonymises only that
--     login. The family, its children, its other contacts and logins are left untouched. Requests recorded by the office
--     (admin_record_deletion_request) keep their behaviour: a parent login closes its family.
--  4. The migrations ledger records this file.
--
-- perform_account_deletion keeps 20261113000800_launch_fix's kept-records sentence (credit notes and refunds,
-- public.deletion_kept_records).

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------

/**
 * True when closing this login should close only the login: it is a parent login linked to a family contact who is not
 * the main contact, and another contact of the family can still sign in. Service role only.
 */
create function public.account_closes_own_login_only(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select not c.is_primary
       and exists (select 1 from public.family_contacts o where o.family_id = c.family_id and o.can_log_in and o.id <> c.id)
      from public.profiles p
      join public.family_contacts c on c.profile_id = p.id and c.family_id = p.family_id
     where p.id = p_profile_id and p.role = 'parent'
     limit 1), false)
$$;
revoke all on function public.account_closes_own_login_only(uuid) from public, anon, authenticated;
grant execute on function public.account_closes_own_login_only(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. A person asks to close their own account
-- ---------------------------------------------------------------------------

/** A person asks to close their own account (delete-account Edge Function). Service role only. */
create or replace function public.begin_account_deletion(p_profile_id uuid, p_requested_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.profiles; fam public.families; v_id uuid; v_login_only boolean;
begin
  select * into p from public.profiles where id = p_profile_id;
  if p.id is null then raise exception 'That account could not be found.'; end if;
  perform public.assert_not_last_admin(p.id);
  select id into v_id from public.deletion_requests
   where profile_id = p_profile_id and status in ('pending', 'processing', 'failed') limit 1;
  if v_id is not null then return v_id; end if;
  select * into fam from public.families where id = p.family_id;
  -- A contact who is not the main contact closes their own sign-in only: the request does not name the family.
  v_login_only := p_requested_by is not distinct from p.id and public.account_closes_own_login_only(p.id);
  insert into public.deletion_requests (target_kind, profile_id, family_id, tutor_id, role, label, requested_by)
  values ('profile', p.id, case when v_login_only then null else p.family_id end, p.tutor_id, p.role,
          case
            when v_login_only then 'Family contact login (' || coalesce(fam.name, p.full_name) || ' family)'
            when p.role = 'parent' then 'Parent account (' || coalesce(fam.name, p.full_name) || ' family)'
            when p.role = 'student' then 'Student login (' || p.full_name || ')'
            when p.role = 'tutor' then 'Tutor (' || p.full_name || ')'
            else 'Administrator (' || p.full_name || ')' end,
          p_requested_by)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.begin_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Carrying out the request
-- ---------------------------------------------------------------------------

/**
 * Carries out a deletion request: anonymises the records, tells the remaining administrators (without any names or
 * contact details) and marks the request completed. Returns the summary, including storagePaths/storageFolders to
 * remove and linkedProfileIds (other logins of the same family or tutor) whose auth users the Edge Function deletes
 * together with profileId. A family contact who is not the main contact, closing their own login, closes only that
 * login (loginOnly in the summary). Service role only.
 */
create or replace function public.perform_account_deletion(p_request_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.deletion_requests;
  p public.profiles;
  v_role text;
  v_family uuid;
  v_tutor uuid;
  v_login_only boolean := false;
  part jsonb;
  v_summary jsonb;
  linked uuid[] := '{}';
  lp uuid;
  a record;
  kept text;
  body text;
begin
  select * into r from public.deletion_requests where id = p_request_id for update;
  if r.id is null then raise exception 'Deletion request not found.'; end if;
  if r.status not in ('pending', 'processing', 'failed') then
    raise exception 'This deletion request is already %.', r.status;
  end if;
  update public.deletion_requests set status = 'processing', processed_by = p_actor, error = null where id = r.id;

  if r.target_kind = 'profile' and r.profile_id is not null then
    select * into p from public.profiles where id = r.profile_id;
  end if;
  v_role := coalesce(p.role, r.role);

  -- A contact closing their own login (not the main contact, and not the family's last sign-in) leaves the family as
  -- remove_family_contact would: the contact goes, the login leaves the family, and nothing else of the family changes.
  -- Requests the office records keep closing the family.
  if p.id is not null and r.requested_by is not distinct from p.id and public.account_closes_own_login_only(p.id) then
    v_login_only := true;
    delete from public.family_contacts where profile_id = p.id and family_id = p.family_id;
    update public.profiles set family_id = null where id = p.id and family_id is not null;
    p.family_id := null;
  end if;

  v_family := case when v_login_only then null
                   when r.target_kind = 'family' or v_role = 'parent' then coalesce(p.family_id, r.family_id) end;
  v_tutor := case when r.target_kind = 'tutor' or v_role in ('tutor', 'admin') then coalesce(p.tutor_id, r.tutor_id) end;
  if p.id is not null then perform public.assert_not_last_admin(p.id); end if;

  v_summary := jsonb_build_object(
    'role', v_role, 'familyAnonymised', false, 'studentsAnonymised', 0, 'futureLessonsCancelled', 0,
    'upcomingLessonsNeedingTutor', 0, 'invoicesRetained', 0, 'paymentsRetained', 0, 'storagePaths', '[]'::jsonb,
    'storageFolders', '[]'::jsonb, 'profileId', p.id, 'linkedProfileIds', '[]'::jsonb, 'loginOnly', v_login_only);

  if v_family is not null then
    -- Every other login of the family (another parent, the children's logins) closes with it.
    linked := array(select id from public.profiles
                     where id is distinct from p.id
                       and (family_id = v_family
                            or (role = 'student' and student_id in (select id from public.students where family_id = v_family))));
    part := public.anonymise_family(v_family);
    v_summary := v_summary || (part - 'storagePaths' - 'storageFolders')
      || jsonb_build_object('storagePaths', (v_summary->'storagePaths') || (part->'storagePaths'),
                            'storageFolders', (v_summary->'storageFolders') || (part->'storageFolders'));
  end if;

  if v_tutor is not null then
    -- Tutor logins close with the tutor record; an administrator who also taught keeps their login unless it is the target.
    linked := linked || array(select id from public.profiles
                               where tutor_id = v_tutor and role = 'tutor' and id is distinct from p.id);
    update public.profiles set tutor_id = null where tutor_id = v_tutor and role = 'admin' and id is distinct from p.id;
    part := public.anonymise_tutor(v_tutor);
    v_summary := v_summary || (part - 'storagePaths')
      || jsonb_build_object('storagePaths', (v_summary->'storagePaths') || (part->'storagePaths'));
  end if;

  if p.id is not null then perform public.anonymise_profile_data(p.id); end if;
  foreach lp in array linked loop perform public.anonymise_profile_data(lp); end loop;
  v_summary := v_summary || jsonb_build_object('linkedProfileIds', to_jsonb(linked));

  -- Tell the remaining administrators. No names, contact details or bank details.
  kept := case
    when v_login_only then
      E'\n\nThe personal details held for this login have been removed. The family''s account, children and other contacts are unchanged.'
    when (v_summary->>'familyAnonymised')::boolean then
      E'\n\nWhat was kept, for tax records: ' || public.deletion_kept_records(v_summary)
      || E'. Lesson dates, tutors and statuses are kept for invoicing. Personal details, lesson addresses, lesson notes, messages and homework have been removed.'
      || case when (v_summary->>'futureLessonsCancelled')::int > 0
           then E'\n\n' || public.deletion_count(v_summary, 'futureLessonsCancelled', 'upcoming lesson was', 'upcoming lessons were')
                || ' cancelled.' else '' end
    when v_tutor is not null then
      E'\n\nWhat was kept, for pay and tax records: tutor invoices and past lessons. Contact details, availability and bank details have been removed.'
      || case when (v_summary->>'upcomingLessonsNeedingTutor')::int > 0
           then E'\n\n' || public.deletion_count(v_summary, 'upcomingLessonsNeedingTutor', 'upcoming lesson needs', 'upcoming lessons need')
                || ' another tutor.' else '' end
    else E'\n\nThe personal details held for this login have been removed.' end;
  body := 'An account has been closed on ' || to_char(now() at time zone 'Asia/Dubai', 'FMDD FMMonth YYYY') || E'.\n\n'
    || 'Account type: '
    || case when v_login_only then 'Family contact login'
            else replace(public.deletion_closed_label(r.target_kind, v_role), ' (closed)', '') end
    || '.' || kept
    || E'\n\nThe request is listed under Deletion requests.';
  for a in select pr.id, pr.email from public.profiles pr
            where pr.role = 'admin' and pr.id is distinct from p.id and pr.id <> all (linked) loop
    insert into public.notification_outbox (profile_id, email, subject, body, push_title, push_body, url, send_email)
    values (a.id, a.email, 'An account has been closed', body, 'Account closed',
            'An account has been closed. Open the app for details.', '/manage/deletion-requests', a.email is not null);
  end loop;

  update public.deletion_requests
     set status = 'completed', completed_at = now(), summary = v_summary,
         label = case when v_login_only then 'Family contact login (closed)'
                      else public.deletion_closed_label(r.target_kind, v_role) end,
         processed_by = p_actor
   where id = r.id;
  return v_summary;
end $$;
revoke all on function public.perform_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.perform_account_deletion(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001400', 'contactdel_fix');
