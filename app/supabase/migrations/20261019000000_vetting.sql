-- Elite Education — tutor vetting and onboarding.
--
-- Every tutor must hold a police clearance certificate that Elite Education has verified before they
-- teach. Tutors (or an administrator on their behalf) upload certificates and other documents to the
-- private 'vetting' bucket; an administrator verifies or rejects each one and records the expiry date.
--
-- * Vetting status is derived from the police clearance documents: cleared, expiring (60 days or fewer
--   left), pending, expired or missing. A certificate is valid on its expiry date and expired the day after.
-- * Once an administrator switches enforcement on (settings.vetting_enforced), database triggers stop an
--   uncleared tutor being assigned new lessons, given new students or awarded roles. Existing lessons can
--   still be rescheduled, completed or cancelled (the app shows a warning). An administrator can record a
--   time-limited override with a reason; every override is recorded and the other administrators are told.
-- * The hourly send-reminders function calls queue_vetting_alerts, which warns the tutor and the office
--   60, 30 and 7 days before a certificate expires and on expiry.
-- * The tutor handbook is versioned; each new version must be acknowledged by every tutor.
-- * tutor_compliance() gives the onboarding checklist (documents, bank details, availability, calendar,
--   WhatsApp, handbook) for the admin dashboard and for each tutor's own checklist.
-- Document rows are written only through the functions below. Bank details and file paths never appear
-- in notifications.

-- ---------------------------------------------------------------------------
-- Settings and tutors
-- ---------------------------------------------------------------------------

alter table public.settings add column vetting_enforced boolean not null default false;
comment on column public.settings.vetting_enforced is
  'Enforcement is switched on by an admin (Manage > Tutor checks) once existing tutors'' certificates are in; '
  'until then everything warns but nothing is blocked.';

alter table public.tutors add column onboarding_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.tutor_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  doc_type text not null check (doc_type in ('police_clearance', 'passport_id', 'qualification', 'other')),
  title text check (length(title) <= 200),
  file_path text not null,
  file_name text check (length(file_name) <= 300),
  issue_date date,
  expiry_date date,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  review_note text check (length(review_note) <= 1000),
  uploaded_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_by_name text,
  verified_at timestamptz,
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
  check (not (status = 'verified' and doc_type = 'police_clearance' and expiry_date is null))
);
create index tutor_documents_tutor_idx on public.tutor_documents (tutor_id, doc_type);

create table public.tutor_vetting_overrides (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 10 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_by_name text
);
create index tutor_vetting_overrides_tutor_idx on public.tutor_vetting_overrides (tutor_id);

create table public.handbook_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 50000),
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null,
  published_by_name text
);

create table public.handbook_acknowledgements (
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  version int not null references public.handbook_versions(version),
  profile_id uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz not null default now(),
  primary key (tutor_id, version)
);

/** Expiry alerts already sent, so each threshold is sent once per document. Server-only. */
create table public.tutor_document_alerts (
  document_id uuid not null references public.tutor_documents(id) on delete cascade,
  threshold int not null,
  sent_at timestamptz not null default now(),
  primary key (document_id, threshold)
);

-- ---------------------------------------------------------------------------
-- Row-level security: reads only; every write goes through the functions below.
-- ---------------------------------------------------------------------------

alter table public.tutor_documents enable row level security;
alter table public.tutor_vetting_overrides enable row level security;
alter table public.handbook_versions enable row level security;
alter table public.handbook_acknowledgements enable row level security;
alter table public.tutor_document_alerts enable row level security;

create policy "see tutor documents" on public.tutor_documents for select to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id());
create policy "see vetting overrides" on public.tutor_vetting_overrides for select to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id());
create policy "see handbook" on public.handbook_versions for select to authenticated
  using (public.my_role() in ('admin', 'tutor'));
create policy "see handbook acknowledgements" on public.handbook_acknowledgements for select to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id());

revoke all on public.tutor_documents, public.tutor_vetting_overrides, public.handbook_versions,
  public.handbook_acknowledgements, public.tutor_document_alerts from anon, authenticated;
grant select on public.tutor_documents, public.tutor_vetting_overrides, public.handbook_versions,
  public.handbook_acknowledgements to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Today in the UAE. */
create function public.vetting_today(p_now timestamptz default now()) returns date
language sql stable security definer set search_path = public as $$
  select (p_now at time zone 'Asia/Dubai')::date
$$;

/** Dates in letters, as in 3 November 2026. */
create function public.vetting_date(p_date date) returns text
language sql stable security definer set search_path = public as $$
  select to_char(p_date, 'FMDD FMMonth YYYY')
$$;

/** Names for each kind of document, for subjects ('Police clearance') and sentences ('police clearance certificate'). */
create function public.vetting_doc_label(p_doc_type text, p_sentence boolean default false) returns text
language sql immutable security definer set search_path = public as $$
  select case p_doc_type
    when 'police_clearance' then case when p_sentence then 'police clearance certificate' else 'Police clearance' end
    when 'passport_id' then case when p_sentence then 'passport or identity document' else 'Passport or ID' end
    when 'qualification' then case when p_sentence then 'qualification certificate' else 'Qualification' end
    else case when p_sentence then 'document' else 'Document' end
  end
$$;

/** Vetting status without an access check (used by triggers and the functions below). */
create function public.vetting_status_of(p_tutor_id uuid, p_on date default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare today date := coalesce(p_on, public.vetting_today()); best date;
begin
  select max(expiry_date) into best from public.tutor_documents
  where tutor_id = p_tutor_id and doc_type = 'police_clearance' and status = 'verified' and expiry_date >= today;
  if best is not null then
    return case when best - today <= 60 then 'expiring' else 'cleared' end;
  end if;
  if exists (select 1 from public.tutor_documents
             where tutor_id = p_tutor_id and doc_type = 'police_clearance' and status = 'pending') then
    return 'pending';
  end if;
  if exists (select 1 from public.tutor_documents
             where tutor_id = p_tutor_id and doc_type = 'police_clearance' and status = 'verified') then
    return 'expired';
  end if;
  return 'missing';
end $$;

/** May the caller see this tutor's vetting? Admins, the tutor themselves, and server-side code. */
create function public.can_see_vetting(p_tutor_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null or public.is_admin() or public.my_tutor_id() = p_tutor_id
$$;

create function public.tutor_vetting_status(p_tutor_id uuid, p_on date default null) returns text
language sql stable security definer set search_path = public as $$
  select case when public.can_see_vetting(p_tutor_id) then public.vetting_status_of(p_tutor_id, p_on) end
$$;

create function public.tutor_is_cleared(p_tutor_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when public.can_see_vetting(p_tutor_id)
    then public.vetting_status_of(p_tutor_id) in ('cleared', 'expiring') end
$$;

create function public.vetting_override_active(p_tutor_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tutor_vetting_overrides
                 where tutor_id = p_tutor_id and revoked_at is null and expires_at > now())
$$;

/** Raise the block message when enforcement is on and the tutor is neither cleared nor overridden. */
create function public.assert_tutor_cleared(p_tutor_id uuid, p_action text) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_name text; phrase text;
begin
  -- System context (service role, migrations, backfills) is never blocked.
  if p_tutor_id is null or auth.uid() is null then return; end if;
  if not coalesce((select vetting_enforced from public.settings where id = 1), false) then return; end if;
  if public.vetting_status_of(p_tutor_id) in ('cleared', 'expiring') then return; end if;
  if public.vetting_override_active(p_tutor_id) then return; end if;
  select full_name into v_name from public.tutors where id = p_tutor_id;
  phrase := case p_action
    when 'lesson' then 'assigned new lessons'
    when 'enrolment' then 'given new students'
    when 'role' then 'awarded roles'
    else 'assigned new work' end;
  raise exception using errcode = 'P0001', message = 'Police clearance required: ' || coalesce(v_name, 'This tutor') || ' cannot be '
    || phrase || ' until their police clearance has been verified. An administrator can record an override with a reason.';
end $$;

revoke all on function public.vetting_today(timestamptz), public.vetting_date(date), public.vetting_doc_label(text, boolean),
  public.vetting_status_of(uuid, date), public.can_see_vetting(uuid), public.vetting_override_active(uuid),
  public.assert_tutor_cleared(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement (covers award_opportunity, reassign_lesson, decide_request and direct writes)
-- ---------------------------------------------------------------------------

create function public.on_lesson_vetting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only new assignments are blocked; rescheduling, completing or cancelling an existing lesson is not.
  if new.status = 'scheduled' and (tg_op = 'INSERT' or new.tutor_id is distinct from old.tutor_id) then
    perform public.assert_tutor_cleared(new.tutor_id, 'lesson');
  end if;
  return new;
end $$;
create trigger lessons_vetting before insert or update of tutor_id on public.lessons
  for each row execute function public.on_lesson_vetting();

create function public.on_enrolment_vetting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and new.tutor_id is not null
     and (tg_op = 'INSERT' or new.tutor_id is distinct from old.tutor_id or not old.active) then
    perform public.assert_tutor_cleared(new.tutor_id, 'enrolment');
  end if;
  return new;
end $$;
create trigger enrolments_vetting before insert or update of tutor_id, active on public.enrolments
  for each row execute function public.on_enrolment_vetting();

create function public.on_opportunity_vetting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.awarded_tutor_id is not null and new.awarded_tutor_id is distinct from old.awarded_tutor_id then
    perform public.assert_tutor_cleared(new.awarded_tutor_id, 'role');
  end if;
  return new;
end $$;
create trigger opportunities_vetting before update of awarded_tutor_id on public.opportunities
  for each row execute function public.on_opportunity_vetting();

-- Hiring an applicant starts their onboarding checklist.
create function public.on_application_hired() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'hired' and new.tutor_id is not null then
    update public.tutors set onboarding_started_at = coalesce(onboarding_started_at, now()) where id = new.tutor_id;
  end if;
  return new;
end $$;
create trigger tutor_applications_hired after update of status, tutor_id on public.tutor_applications
  for each row execute function public.on_application_hired();

revoke all on function public.on_lesson_vetting(), public.on_enrolment_vetting(), public.on_opportunity_vetting(),
  public.on_application_hired() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create function public.submit_tutor_document(
  p_tutor_id uuid, p_doc_type text, p_file_path text, p_file_name text default null, p_title text default null,
  p_issue_date date default null, p_expiry_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare t public.tutors; did uuid; label text;
begin
  if not (public.is_admin() or (p_tutor_id is not null and public.my_tutor_id() = p_tutor_id)) then
    raise exception 'You can only upload your own documents' using errcode = '42501';
  end if;
  select * into t from public.tutors where id = p_tutor_id;
  if t.id is null then raise exception 'Tutor not found'; end if;
  if p_doc_type is null or p_doc_type not in ('police_clearance', 'passport_id', 'qualification', 'other') then
    raise exception 'Please choose the type of document';
  end if;
  if p_file_path is null or left(p_file_path, length('tutors/' || p_tutor_id || '/')) <> 'tutors/' || p_tutor_id || '/'
     or length(p_file_path) <= length('tutors/' || p_tutor_id || '/') or position('..' in p_file_path) > 0 then
    raise exception 'The file was not uploaded to the right place. Please try again.';
  end if;
  if p_issue_date is not null and p_issue_date > public.vetting_today() then
    raise exception 'The issue date cannot be in the future';
  end if;
  if p_issue_date is not null and p_expiry_date is not null and p_expiry_date < p_issue_date then
    raise exception 'The expiry date cannot be before the issue date';
  end if;
  if length(p_title) > 200 then raise exception 'Please keep the title to 200 characters'; end if;
  insert into public.tutor_documents (tutor_id, doc_type, title, file_path, file_name, issue_date, expiry_date, status, uploaded_by)
  values (t.id, p_doc_type, nullif(trim(p_title), ''), p_file_path, nullif(left(trim(p_file_name), 300), ''),
          p_issue_date, p_expiry_date, 'pending', auth.uid())
  returning id into did;
  label := public.vetting_doc_label(p_doc_type, true);
  perform public.notify_admins('Document to review: ' || t.full_name,
    'A new ' || label || ' has been uploaded for ' || t.full_name
      || '. Please review it in Manage > Tutor checks and verify or reject it.' || E'\n\nElite Education | eliteeducation.me',
    'Document to review', t.full_name, '/manage/vetting/' || t.id);
  return did;
end $$;

create function public.review_tutor_document(
  p_id uuid, p_approve boolean, p_issue_date date default null, p_expiry_date date default null, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare d public.tutor_documents; t public.tutors; issue date; expiry date; reviewer text; label text; v_first text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into d from public.tutor_documents where id = p_id for update;
  if d.id is null then raise exception 'Document not found'; end if;
  select * into t from public.tutors where id = d.tutor_id;
  label := public.vetting_doc_label(d.doc_type, true);
  v_first := split_part(t.full_name, ' ', 1);
  if coalesce(p_approve, false) then
    issue := coalesce(p_issue_date, d.issue_date);
    expiry := coalesce(p_expiry_date, d.expiry_date);
    if d.doc_type = 'police_clearance' and expiry is null then
      raise exception 'Please enter the expiry date before verifying';
    end if;
    if d.doc_type = 'police_clearance' and expiry < public.vetting_today() then
      raise exception 'This certificate has already expired. Please ask the tutor for a current one.';
    end if;
    if issue is not null and issue > public.vetting_today() then raise exception 'The issue date cannot be in the future'; end if;
    if issue is not null and expiry is not null and expiry < issue then
      raise exception 'The expiry date cannot be before the issue date';
    end if;
    select full_name into reviewer from public.profiles where id = auth.uid();
    update public.tutor_documents set status = 'verified', issue_date = issue, expiry_date = expiry,
      verified_by = auth.uid(), verified_by_name = reviewer, verified_at = now(), review_note = nullif(trim(p_note), '')
    where id = d.id;
    -- A corrected expiry date starts the expiry alerts afresh.
    if expiry is distinct from d.expiry_date then delete from public.tutor_document_alerts where document_id = d.id; end if;
    perform public.notify_tutor(t.id,
      case when d.doc_type = 'police_clearance' then 'Your police clearance has been verified'
           else 'Your ' || lower(public.vetting_doc_label(d.doc_type)) || ' has been verified' end,
      'Dear ' || v_first || E',\n\nThank you for uploading your ' || label || '. It has now been verified by Elite Education'
        || coalesce(' and is valid until ' || public.vetting_date(expiry), '') || '.'
        || case when d.doc_type = 'police_clearance' and expiry is not null
             then ' We will remind you well before it expires so that you can upload a renewed certificate in good time.' else '' end
        || E'\n\nElite Education | eliteeducation.me',
      'Document verified', public.vetting_doc_label(d.doc_type) || ' verified', '/checks');
  else
    if nullif(trim(p_note), '') is null then raise exception 'Please give a reason so that the tutor knows what to upload'; end if;
    if length(trim(p_note)) > 1000 then raise exception 'Please keep the reason to 1000 characters'; end if;
    update public.tutor_documents set status = 'rejected', review_note = trim(p_note),
      verified_by = null, verified_by_name = null, verified_at = null
    where id = d.id;
    perform public.notify_tutor(t.id,
      'Please upload a new ' || label,
      'Dear ' || v_first || E',\n\nThank you for uploading your ' || label || '. Unfortunately we are unable to accept it, for the following reason:'
        || E'\n\n' || trim(p_note) || E'\n\nPlease upload a replacement in the Elite Education app under Checks.'
        || E'\n\nElite Education | eliteeducation.me',
      'Document not accepted', 'Please upload a new ' || label, '/checks');
  end if;
end $$;

create function public.delete_tutor_document(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d public.tutor_documents;
begin
  select * into d from public.tutor_documents where id = p_id;
  if d.id is null or not (public.is_admin() or d.tutor_id = public.my_tutor_id()) then
    raise exception 'Document not found';
  end if;
  if not public.is_admin() and d.status not in ('pending', 'rejected') then
    raise exception 'Verified documents can only be removed by Elite Education' using errcode = '42501';
  end if;
  delete from public.tutor_documents where id = d.id;
  return d.file_path;
end $$;

-- ---------------------------------------------------------------------------
-- Overrides and enforcement
-- ---------------------------------------------------------------------------

create function public.grant_vetting_override(p_tutor_id uuid, p_reason text, p_days int default 30) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tutors; admin_name text; oid uuid; v_until timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into t from public.tutors where id = p_tutor_id;
  if t.id is null then raise exception 'Tutor not found'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Please give a reason of at least 10 characters for the override';
  end if;
  if length(trim(p_reason)) > 1000 then raise exception 'Please keep the reason to 1000 characters'; end if;
  if p_days is null or p_days not between 1 and 90 then raise exception 'An override can last between 1 and 90 days'; end if;
  select full_name into admin_name from public.profiles where id = auth.uid();
  v_until := now() + make_interval(days => p_days);
  insert into public.tutor_vetting_overrides (tutor_id, reason, created_by, created_by_name, expires_at)
  values (t.id, trim(p_reason), auth.uid(), admin_name, v_until)
  returning id into oid;
  perform public.notify_admins('Clearance override recorded for ' || t.full_name,
    coalesce(admin_name, 'An administrator') || ' recorded a police clearance override for ' || t.full_name
      || ', valid until ' || public.vetting_date((v_until at time zone 'Asia/Dubai')::date) || E'.\n\nReason: ' || trim(p_reason)
      || E'\n\nElite Education | eliteeducation.me',
    'Clearance override', t.full_name, '/manage/vetting/' || t.id);
  return oid;
end $$;

create function public.revoke_vetting_override(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.tutor_vetting_overrides
  set revoked_at = now(), revoked_by = auth.uid(), revoked_by_name = (select full_name from public.profiles where id = auth.uid())
  where id = p_id and revoked_at is null;
  if not found then raise exception 'That override has already ended'; end if;
end $$;

create function public.set_vetting_enforced(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.settings set vetting_enforced = coalesce(p_on, false) where id = 1;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding checklist
-- ---------------------------------------------------------------------------

create function public.tutor_compliance() returns table (
  tutor_id uuid, vetting_status text, clearance_expiry date, documents_pending int, bank_details boolean,
  availability_set boolean, calendar_connected boolean, whatsapp_opt_in boolean, handbook_version int,
  handbook_acknowledged_version int, onboarding_started_at timestamptz, override_id uuid, override_reason text,
  override_until timestamptz, enforced boolean
) language sql stable security definer set search_path = public as $$
  select t.id,
    public.vetting_status_of(t.id),
    (select max(d.expiry_date) from public.tutor_documents d
     where d.tutor_id = t.id and d.doc_type = 'police_clearance' and d.status = 'verified'),
    (select count(*)::int from public.tutor_documents d where d.tutor_id = t.id and d.status = 'pending'),
    exists (select 1 from public.tutor_payment_details b where b.tutor_id = t.id),
    exists (select 1 from public.availability a where a.tutor_id = t.id),
    exists (select 1 from public.calendar_connections c join public.profiles p on p.id = c.profile_id
            where p.tutor_id = t.id and c.status = 'connected'),
    exists (select 1 from public.profiles p where p.tutor_id = t.id and p.whatsapp_opt_in),
    (select max(h.version) from public.handbook_versions h),
    (select max(k.version) from public.handbook_acknowledgements k where k.tutor_id = t.id),
    t.onboarding_started_at,
    o.id, o.reason, o.expires_at,
    coalesce((select s.vetting_enforced from public.settings s where s.id = 1), false)
  from public.tutors t
  left join lateral (
    select v.id, v.reason, v.expires_at from public.tutor_vetting_overrides v
    where v.tutor_id = t.id and v.revoked_at is null and v.expires_at > now()
    order by v.expires_at desc limit 1
  ) o on true
  where public.is_admin() or t.id = public.my_tutor_id()
  order by t.full_name
$$;

-- ---------------------------------------------------------------------------
-- Tutor handbook
-- ---------------------------------------------------------------------------

create function public.publish_handbook(p_title text, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare v int; admin_name text; t record;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 200 then raise exception 'Please give the handbook a title of up to 200 characters'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 50000 then raise exception 'Please write the handbook (up to 50,000 characters)'; end if;
  perform 1 from public.handbook_versions for update;
  select coalesce(max(version), 0) + 1 into v from public.handbook_versions;
  select full_name into admin_name from public.profiles where id = auth.uid();
  insert into public.handbook_versions (version, title, body, published_by, published_by_name)
  values (v, trim(p_title), trim(p_body), auth.uid(), admin_name);
  for t in select distinct p.tutor_id from public.profiles p where p.tutor_id is not null and p.role in ('tutor', 'admin') loop
    perform public.notify_tutor(t.tutor_id, 'Updated tutor handbook',
      E'Dear tutor,\n\nWe have published version ' || v || ' of the Elite Education tutor handbook. '
        || 'Please read it in the app and confirm that you have read and agree to follow it.'
        || E'\n\nElite Education | eliteeducation.me',
      'Tutor handbook updated', 'Please read and acknowledge', '/handbook');
  end loop;
  return v;
end $$;

create function public.acknowledge_handbook(p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_tutor_id();
begin
  if me is null then raise exception 'Only tutors acknowledge the handbook' using errcode = '42501'; end if;
  if p_version is null or p_version is distinct from (select max(version) from public.handbook_versions) then
    raise exception 'Please acknowledge the current version of the handbook';
  end if;
  insert into public.handbook_acknowledgements (tutor_id, version, profile_id)
  values (me, p_version, auth.uid())
  on conflict (tutor_id, version) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Expiry alerts (called hourly by the send-reminders Edge Function with the service role)
-- ---------------------------------------------------------------------------

create function public.queue_vetting_alerts(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := public.vetting_today(p_now); d record; days_left int; v_threshold int; n int := 0;
  v_first text; subject text; tutor_body text; admin_body text; label text; sentence text; police boolean;
begin
  for d in
    select distinct on (x.tutor_id, x.doc_type) x.id, x.tutor_id, x.doc_type, x.expiry_date, t.full_name
    from public.tutor_documents x join public.tutors t on t.id = x.tutor_id
    where x.status = 'verified' and x.expiry_date is not null
    order by x.tutor_id, x.doc_type, x.expiry_date desc, x.verified_at desc nulls last, x.created_at desc
  loop
    -- Only the latest-expiring verified document of each type counts; superseded ones are ignored.
    days_left := d.expiry_date - today;
    if days_left > 60 then continue; end if;
    v_threshold := case when days_left <= 0 then 0 when days_left <= 7 then 7 when days_left <= 30 then 30 else 60 end;
    if exists (select 1 from public.tutor_document_alerts a where a.document_id = d.id and a.threshold = v_threshold) then
      continue;
    end if;
    -- Record this threshold and every larger one, so a late verification sends a single alert.
    insert into public.tutor_document_alerts (document_id, threshold)
    select d.id, x from unnest(array[60, 30, 7, 0]) x where x >= v_threshold
    on conflict do nothing;

    police := d.doc_type = 'police_clearance';
    label := public.vetting_doc_label(d.doc_type);
    sentence := public.vetting_doc_label(d.doc_type, true);
    v_first := split_part(d.full_name, ' ', 1);
    if v_threshold > 0 then
      subject := case when police then 'Police clearance expires in ' || days_left || case when days_left = 1 then ' day' else ' days' end
                      else 'Document expires in ' || days_left || case when days_left = 1 then ' day' else ' days' end || ': ' || label end;
      tutor_body := 'Dear ' || v_first || E',\n\nYour ' || sentence || ' expires on ' || public.vetting_date(d.expiry_date)
        || '. Please upload a renewed ' || case when police then 'certificate' else 'copy' end
        || ' in the Elite Education app under Checks as soon as possible'
        || case when police then ', so that there is no interruption to your lessons.' else '.' end
        || E'\n\nElite Education | eliteeducation.me';
      admin_body := d.full_name || '''s ' || sentence || ' expires on ' || public.vetting_date(d.expiry_date)
        || ' (in ' || days_left || case when days_left = 1 then ' day).' else ' days).' end
        || ' They have been asked to upload a renewed ' || case when police then 'certificate' else 'copy' end || '.'
        || E'\n\nElite Education | eliteeducation.me';
    else
      subject := case when police then case when days_left = 0 then 'Police clearance expires today' else 'Police clearance has expired' end
                      else case when days_left = 0 then 'Document expires today: ' else 'Document has expired: ' end || label end;
      tutor_body := 'Dear ' || v_first || E',\n\nYour ' || sentence
        || case when days_left = 0 then ' expires today (' else ' expired on ' end || public.vetting_date(d.expiry_date)
        || case when days_left = 0 then ').' else '.' end
        || case when police
             then ' No new lessons can be assigned to you until a renewed certificate has been verified. Please upload it in the Elite Education app under Checks.'
             else ' Please upload a renewed copy in the Elite Education app under Checks.' end
        || E'\n\nElite Education | eliteeducation.me';
      admin_body := d.full_name || '''s ' || sentence
        || case when days_left = 0 then ' expires today (' else ' expired on ' end || public.vetting_date(d.expiry_date)
        || case when days_left = 0 then ').' else '.' end
        || case when police
             then ' No new lessons can be assigned to them until a renewed certificate has been verified.'
             else ' They have been asked to upload a renewed copy.' end
        || E'\n\nElite Education | eliteeducation.me';
    end if;
    perform public.notify_tutor(d.tutor_id, subject, tutor_body, subject, 'Please upload a renewed ' || sentence, '/checks');
    perform public.notify_admins(subject || ': ' || d.full_name, admin_body, subject, d.full_name, '/manage/vetting/' || d.tutor_id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.queue_vetting_alerts(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_vetting_alerts(timestamptz) to service_role;

grant execute on function
  public.submit_tutor_document(uuid, text, text, text, text, date, date),
  public.review_tutor_document(uuid, boolean, date, date, text),
  public.delete_tutor_document(uuid),
  public.tutor_vetting_status(uuid, date),
  public.tutor_is_cleared(uuid),
  public.grant_vetting_override(uuid, text, int),
  public.revoke_vetting_override(uuid),
  public.set_vetting_enforced(boolean),
  public.tutor_compliance(),
  public.publish_handbook(text, text),
  public.acknowledge_handbook(int) to authenticated;
revoke execute on function
  public.submit_tutor_document(uuid, text, text, text, text, date, date),
  public.review_tutor_document(uuid, boolean, date, date, text),
  public.delete_tutor_document(uuid),
  public.tutor_vetting_status(uuid, date),
  public.tutor_is_cleared(uuid),
  public.grant_vetting_override(uuid, text, int),
  public.revoke_vetting_override(uuid),
  public.set_vetting_enforced(boolean),
  public.tutor_compliance(),
  public.publish_handbook(text, text),
  public.acknowledge_handbook(int) from anon;

-- ---------------------------------------------------------------------------
-- Default handbook (version 1)
-- ---------------------------------------------------------------------------

insert into public.handbook_versions (version, title, body, published_by, published_by_name)
values (1, 'Elite Education Tutor Handbook', $handbook$# Elite Education Tutor Handbook

Welcome to Elite Education. This handbook sets out the standards we expect of every tutor. Please read it carefully and confirm that you agree to follow it.

## Safeguarding

- You must hold a valid police clearance certificate, verified by Elite Education, before you teach any student. Please upload a renewed certificate well before your current one expires.
- Report any safeguarding concern to the Elite Education office on the same day.
- In-person lessons take place in a shared area of the home, with a parent or guardian present in the home.
- Online lessons take place on the meeting link in the app. Do not contact students through personal social media.

## Professional conduct

- Arrive on time, fully prepared and appropriately dressed.
- Communicate with families courteously and formally, and through the app wherever possible.
- Keep all information about students and families strictly confidential.

## Lessons and records

- Record attendance and lesson notes in the app within 24 hours of each lesson.
- Give families as much notice as possible of any change, and record your time off in the app.

## Payment

- Submit your monthly invoice through the app by the third working day of the following month.
- Keep your bank details up to date in the app. We will never ask for them by message or email.

**Excellence. Discretion. Results.**$handbook$, null, 'Elite Education');

-- ---------------------------------------------------------------------------
-- File storage: private 'vetting' bucket, objects at tutors/<tutor_id>/<file>. Tutors may remove only
-- their own files that are not behind a verified or rejected document; admins may remove any.
-- Skipped where the storage schema doesn't exist (local tests).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    -- 10 MB per file; PDFs and photos only.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('vetting', 'vetting', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "vetting upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'vetting' and (storage.foldername(name))[1] = 'tutors'
                  and ((storage.foldername(name))[2] = public.my_tutor_id()::text or public.is_admin()))$p$;
    execute $p$create policy "vetting read" on storage.objects for select to authenticated
      using (bucket_id = 'vetting' and (storage.foldername(name))[1] = 'tutors'
             and ((storage.foldername(name))[2] = public.my_tutor_id()::text or public.is_admin()))$p$;
    execute $p$create policy "vetting delete" on storage.objects for delete to authenticated
      using (bucket_id = 'vetting' and (public.is_admin() or (owner_id = auth.uid()::text
             and not exists (select 1 from public.tutor_documents d where d.file_path = name and d.status <> 'pending'))))$p$;
  end if;
end $$;
