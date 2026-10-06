-- Elite Education — four minor security fixes from the round 5 security review.
--
--  1. Family prices: services.rate (the standard family price per lesson) and package offer prices are readable only by
--     admins, parents and the accountant. Everyone signed in still reads the service catalogue (name, length, subject,
--     phase) through public.service_catalogue, which is all tutor and student screens need. Tutors and students no
--     longer see package offers at all.
--  2. View as: while a person is protected, their pending email or phone change (email_change, phone_change) and their
--     user metadata cannot change either, so an email change cannot be started during a view and confirmed after it.
--     A revoked view now protects the person for 24 hours after it was revoked (the life of an email-change link).
--  3. App error reports: anonymous reports are also limited per connection (20 an hour for each request_ip_hash()), as
--     submit_enquiry does, so one script cannot use up the 200-an-hour allowance for genuine signed-out crash reports.
--  4. Admissions files: an uploader reads their own file only while they still have access to its case, so a removed
--     contact or a replaced adviser can no longer download files they uploaded.
--  5. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. Family prices
-- ---------------------------------------------------------------------------

drop policy if exists "read services" on public.services;
create policy "read service prices" on public.services for select to authenticated
  using (public.my_role() in ('admin', 'parent', 'accountant'));

-- The catalogue without prices. The view runs with its owner's rights, so it lists every service to everyone signed
-- in; it is read only (no insert, update or delete is granted) and never exposes rate.
create view public.service_catalogue as
  select id, name, duration_min, subject, phase from public.services;
revoke all on public.service_catalogue from public, anon, authenticated;
grant select on public.service_catalogue to authenticated, service_role;

drop policy if exists "see package offers" on public.package_offers;
create policy "see package offers" on public.package_offers for select to authenticated
  using (public.is_admin() or (active and public.my_role() in ('parent', 'accountant')));

-- ---------------------------------------------------------------------------
-- 2. View as: pending sign-in changes, and 24 hours after a revoked view
-- ---------------------------------------------------------------------------

-- As before, plus: a view whose session was revoked keeps the person protected for 24 hours after revoked_at.
create or replace function public.view_as_protects(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.view_as_sessions v
    where v.target_id = p_user
      and ((v.ended_at is null and v.expires_at > now())
           or (v.revoked_at is null and least(coalesce(v.ended_at, v.expires_at), v.expires_at) > now() - interval '65 minutes')
           or v.revoked_at > now() - interval '24 hours'))
$$;

-- Compared as JSON so a column the auth schema does not have simply reads as unchanged.
create or replace function public.view_as_protect_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  if exists (select 1 from unnest(array['email', 'phone', 'encrypted_password', 'email_change', 'phone_change',
                                        'raw_user_meta_data']) k
             where n -> k is distinct from o -> k)
     and public.view_as_protects(new.id) then
    raise exception 'Account details cannot be changed while the office is viewing this account.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Anonymous error reports: a limit per connection
-- ---------------------------------------------------------------------------

-- The salted connection fingerprint of an anonymous report (never the address itself); null for signed-in reports.
alter table public.app_errors add column if not exists ip_hash text;
create index if not exists app_errors_anon_ip_idx on public.app_errors (ip_hash, created_at desc) where profile_id is null;

/**
 * The app reports an error. Returns false (never raises) when the report is dropped by the rate limit:
 * a signed-in person may send 30 reports in 10 minutes and the same fingerprint once a minute; reports from people
 * who are not signed in are capped at 20 an hour from each connection and 200 an hour in total.
 */
create or replace function public.log_app_error(
  p_message text,
  p_stack text default null,
  p_route text default null,
  p_platform text default 'unknown',
  p_app_version text default null,
  p_source text default 'manual',
  p_fingerprint text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_role text;
  v_profile uuid;
  v_ip text;
begin
  if nullif(trim(coalesce(p_message, '')), '') is null then return false; end if;
  if uid is not null then
    select p.id, p.role into v_profile, v_role from public.profiles p where p.id = uid;
  end if;

  if v_profile is not null then
    if (select count(*) from public.app_errors
         where profile_id = v_profile and created_at > now() - interval '10 minutes') >= 30 then
      return false;
    end if;
    if p_fingerprint is not null and exists (
      select 1 from public.app_errors
       where profile_id = v_profile and fingerprint = left(p_fingerprint, 200) and created_at > now() - interval '1 minute') then
      return false;
    end if;
  else
    v_ip := public.request_ip_hash();
    if v_ip is not null and (select count(*) from public.app_errors
         where profile_id is null and ip_hash = v_ip and created_at > now() - interval '1 hour') >= 20 then
      return false;
    end if;
    if (select count(*) from public.app_errors
         where profile_id is null and created_at > now() - interval '1 hour') >= 200 then
      return false;
    end if;
  end if;

  insert into public.app_errors (profile_id, role, platform, app_version, route, source, message, stack, fingerprint, ip_hash)
  values (
    v_profile,
    v_role,
    case when p_platform in ('ios', 'android', 'web') then p_platform else 'unknown' end,
    left(public.scrub_error_text(p_app_version), 50),
    left(public.scrub_error_text(regexp_replace(p_route, '[?#].*$', '')), 200),
    case when p_source in ('boundary', 'query', 'mutation', 'global', 'manual') then p_source else 'manual' end,
    left(public.scrub_error_text(left(p_message, 2000)), 500),
    left(public.scrub_error_text(left(p_stack, 8000)), 4000),
    left(p_fingerprint, 200),
    v_ip
  );
  return true;
end $$;
revoke all on function public.log_app_error(text, text, text, text, text, text, text) from public;
grant execute on function public.log_app_error(text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admissions files: uploaders keep reading only while they have access to the case
-- ---------------------------------------------------------------------------

-- admissions_can_write(name) is true exactly when admissions_access(admissions_path_case(name)) is not null.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists "admissions read" on storage.objects';
    execute $p$create policy "admissions read" on storage.objects for select to authenticated
      using (bucket_id = 'admissions' and (public.admissions_can_read(name)
             or (owner_id = auth.uid()::text and public.admissions_can_write(name))))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001500', 'secminor_fix');
