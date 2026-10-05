-- Admin "View as" (read only).
--
-- An admin can see the app exactly as a parent, student or tutor sees it. The view-as Edge Function signs in as that
-- person on the server (a magic-link token that is verified there; no email is sent), binds the new auth session to a
-- view_as_sessions row with begin_view_as, and only then hands the tokens to the admin's app. Every PostgREST request
-- made with a bound session passes through public.view_as_guard (the db-pre-request hook), which:
--   * refuses everything once the view has ended or expired (VIEW_ENDED_MESSAGE);
--   * marks the transaction read-only, so nothing can be written even by a security-definer function;
--   * allows only GET/HEAD/OPTIONS on tables and views, and only the read RPCs in view_as_read_rpcs().
-- Storage uploads, changes and deletes are refused by restrictive policies (and reads once the view has ended), and an auth.users trigger stops the
-- person's email, phone or password being changed while a view of their account is active.
-- Ending a view revokes its auth session on the server (end_view_as), and the auth schema refuses to refresh a view's
-- session once the view has ended or expired, so its tokens cannot be used for long afterwards.
-- Each view lasts at most 60 minutes and every start and end is recorded in view_as_audit.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  -- The auth session (the JWT's session_id claim) that belongs to this view.
  session_id uuid not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  -- When the view's auth session (and its refresh tokens) was deleted on the server.
  revoked_at timestamptz
);
create index view_as_sessions_target_idx on public.view_as_sessions (target_id);
create index view_as_sessions_admin_idx on public.view_as_sessions (admin_id);

alter table public.view_as_sessions enable row level security;
create policy "admins read views" on public.view_as_sessions for select to authenticated using (public.is_admin());
revoke all on public.view_as_sessions from anon, authenticated;
grant select on public.view_as_sessions to authenticated;

create table public.view_as_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  view_id uuid references public.view_as_sessions(id) on delete set null,
  admin_id uuid,
  target_id uuid,
  action text not null check (action in ('start', 'end'))
);
create index view_as_audit_at_idx on public.view_as_audit (at desc);

alter table public.view_as_audit enable row level security;
create policy "admins read view audit" on public.view_as_audit for select to authenticated using (public.is_admin());
revoke all on public.view_as_audit from anon, authenticated;
grant select on public.view_as_audit to authenticated;

-- ---------------------------------------------------------------------------
-- The caller's auth session id
-- ---------------------------------------------------------------------------

-- Reads the session_id claim from either form PostgREST (and the test shim) may use. Deliberately does not use
-- auth.jwt(). A malformed value cannot match a bound view, so it is treated as no session.
create function public.view_as_session_id() returns uuid
language plpgsql stable set search_path = public as $$
declare raw text;
begin
  raw := coalesce(nullif(current_setting('request.jwt.claim.session_id', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'));
  if raw is null then return null; end if;
  return raw::uuid;
exception when others then
  return null;
end $$;

revoke all on function public.view_as_session_id() from public;
grant execute on function public.view_as_session_id() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Starting and ending a view
-- ---------------------------------------------------------------------------

-- Called only by the view-as Edge Function (service role), after it has created the target's session and before the
-- tokens leave the server, so there is never a moment when the admin holds an unbound, writable session.
create function public.begin_view_as(p_admin uuid, p_target uuid, p_session_id uuid, p_minutes int default 60)
returns public.view_as_sessions
language plpgsql security definer set search_path = public as $$
declare r public.view_as_sessions;
begin
  if p_session_id is null then raise exception 'A session is required.'; end if;
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin') then
    raise exception 'Only the office can view the app as someone else.' using errcode = '42501';
  end if;
  if p_target is null or p_target = p_admin
     or not exists (select 1 from public.profiles where id = p_target and role in ('parent', 'student', 'tutor')) then
    raise exception 'This person cannot be viewed.';
  end if;
  insert into public.view_as_sessions (admin_id, target_id, session_id, expires_at)
  values (p_admin, p_target, p_session_id,
          now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 1), 60)))
  returning * into r;
  insert into public.view_as_audit (view_id, admin_id, target_id, action) values (r.id, p_admin, p_target, 'start');
  return r;
end $$;

revoke all on function public.begin_view_as(uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.begin_view_as(uuid, uuid, uuid, int) to service_role;

-- Deletes a view's auth session, and with it every refresh token, so its tokens can no longer be refreshed or used
-- with the auth endpoints. Returns false where the auth schema cannot be changed from here (the view then stays
-- protected for one token lifetime instead; see view_as_protects).
create function public.view_as_revoke_auth(p_view_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select session_id into sid from public.view_as_sessions where id = p_view_id;
  if sid is null or to_regclass('auth.sessions') is null then return false; end if;
  begin
    execute 'delete from auth.sessions where id = $1' using sid;
  exception when insufficient_privilege then
    return false;
  end;
  update public.view_as_sessions set revoked_at = now() where id = p_view_id and revoked_at is null;
  return true;
end $$;

revoke all on function public.view_as_revoke_auth(uuid) from public, anon, authenticated;
grant execute on function public.view_as_revoke_auth(uuid) to service_role;

-- Called by the admin's own (normal) session when they return to their account. Ending twice is harmless.
create function public.end_view_as(p_view_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.view_as_sessions;
begin
  if not public.is_admin() then
    raise exception 'Only the office can end a view.' using errcode = '42501';
  end if;
  select * into r from public.view_as_sessions where id = p_view_id for update;
  if not found or r.admin_id is distinct from auth.uid() then
    raise exception 'This view was not found.' using errcode = '42501';
  end if;
  if r.ended_at is null then
    update public.view_as_sessions set ended_at = now() where id = r.id;
    insert into public.view_as_audit (view_id, admin_id, target_id, action) values (r.id, r.admin_id, r.target_id, 'end');
  end if;
  if r.revoked_at is null then perform public.view_as_revoke_auth(r.id); end if;
end $$;

-- True when the caller's session belongs to a view, ended or not (the Edge Functions and storage refuse both).
create function public.is_view_as_session() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.view_as_sessions where session_id = public.view_as_session_id())
$$;

-- True when the caller's session belongs to a view that has ended or expired (storage then refuses even reads).
create function public.view_as_closed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.view_as_sessions
    where session_id = public.view_as_session_id() and (ended_at is not null or expires_at <= now()))
$$;

revoke all on function public.view_as_closed() from public, anon;
grant execute on function public.view_as_closed() to authenticated;

-- The view the caller's session belongs to, or null.
create function public.current_view_as() returns public.view_as_sessions
language sql stable security definer set search_path = public as $$
  select * from public.view_as_sessions where session_id = public.view_as_session_id()
$$;

revoke all on function public.end_view_as(uuid), public.is_view_as_session(), public.current_view_as() from public, anon;
grant execute on function public.end_view_as(uuid), public.is_view_as_session(), public.current_view_as() to authenticated;

-- ---------------------------------------------------------------------------
-- The PostgREST guard
-- ---------------------------------------------------------------------------

-- RPCs a view may call. Each one only reads:
--   my_threads         (20261004000000_engagement.sql) sql stable select of families and messages; unread counts only.
--   list_resources     (20261008000000_homework.sql)   plpgsql stable; loops over resources and returns rows.
--   login_emails       (20261003000000_auto_link_logins.sql) sql stable select of profile emails (admins only).
--   open_slots         (20261009000000_calendar.sql, replacing the engagement version) plpgsql stable; reads
--                      settings, closures, absences, availability, lessons and busy blocks, returns free slots.
--   is_view_as_session, current_view_as (this file) stable selects.
-- The transaction is also made read-only before any of them runs, so a later change to one of them cannot write.
create function public.view_as_read_rpcs() returns text[]
language sql immutable as $$
  select array['my_threads', 'list_resources', 'login_emails', 'open_slots', 'is_view_as_session', 'current_view_as']
$$;

grant execute on function public.view_as_read_rpcs() to anon, authenticated, service_role;

create function public.view_as_guard() returns void
language plpgsql security definer set search_path = public as $$
declare
  sid uuid := public.view_as_session_id();
  r public.view_as_sessions;
  m text := upper(coalesce(current_setting('request.method', true), ''));
  p text := coalesce(current_setting('request.path', true), '');
  fn text;
begin
  if sid is null then return; end if;
  select * into r from public.view_as_sessions where session_id = sid;
  if not found then return; end if;

  if r.ended_at is not null or r.expires_at <= now() then
    raise exception 'This view has ended. Please return to your own account.' using errcode = '42501';
  end if;

  -- Second layer: nothing in this request can write, whatever it calls. Switching a transaction to read-only is
  -- allowed at any point (only switching back to read-write must come before the first query).
  perform set_config('transaction_read_only', 'on', true);

  fn := (regexp_match(p, '/rpc/([A-Za-z0-9_]+)'))[1];
  if fn is not null then
    if fn = any (public.view_as_read_rpcs()) then return; end if;
  elsif m in ('GET', 'HEAD', 'OPTIONS') then
    return;
  end if;

  raise exception 'Viewing only — changes are disabled.' using errcode = '42501';
end $$;

revoke all on function public.view_as_guard() from public;
grant execute on function public.view_as_guard() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: a view can read files it may see but never upload, change or delete them, and reads nothing once it has
-- ended or expired
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $p$create policy "view as cannot upload" on storage.objects as restrictive for insert to authenticated
      with check (not public.is_view_as_session())$p$;
    execute $p$create policy "view as cannot change" on storage.objects as restrictive for update to authenticated
      using (not public.is_view_as_session()) with check (not public.is_view_as_session())$p$;
    execute $p$create policy "view as cannot delete" on storage.objects as restrictive for delete to authenticated
      using (not public.is_view_as_session())$p$;
    execute $p$create policy "view as ended cannot read" on storage.objects as restrictive for select to authenticated
      using (not public.view_as_closed())$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Auth: the person's sign-in details cannot change while their account is being viewed
-- ---------------------------------------------------------------------------

-- The admin's app holds the person's tokens for the length of the view, and the auth endpoints do not pass through
-- PostgREST, so this is checked in the auth schema itself.
--
-- A person is protected while a view of their account is active, and afterwards until the view's session is revoked
-- or its last access token has run out. Refreshing is refused once a view has ended or expired (below), so that
-- token outlives the view by at most one access-token lifetime (Supabase's default is one hour; 65 minutes allows
-- for clock skew). If the project's JWT expiry is raised, raise this interval to match.
create function public.view_as_protects(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.view_as_sessions v
    where v.target_id = p_user
      and ((v.ended_at is null and v.expires_at > now())
           or (v.revoked_at is null and least(coalesce(v.ended_at, v.expires_at), v.expires_at) > now() - interval '65 minutes')))
$$;

revoke all on function public.view_as_protects(uuid) from public, anon, authenticated;

create function public.view_as_protect_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.email is distinct from old.email or new.phone is distinct from old.phone
      or new.encrypted_password is distinct from old.encrypted_password)
     and public.view_as_protects(new.id) then
    raise exception 'Account details cannot be changed while the office is viewing this account.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.view_as_protect_user() from public, anon, authenticated;

create trigger view_as_protect_user before update on auth.users
  for each row execute function public.view_as_protect_user();

-- Adding a second factor or linking another sign-in (Google, Apple) only touches the auth schema too, so neither
-- can happen while the person is protected. Their existing factors and identities keep working as normal.
create function public.view_as_protect_auth_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.view_as_protects(coalesce(new.user_id, old.user_id)) then
    raise exception 'Account details cannot be changed while the office is viewing this account.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- A view's session cannot be refreshed once the view has ended or expired.
create function public.view_as_refuse_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.view_as_sessions v
             where v.session_id = new.session_id::uuid and (v.ended_at is not null or v.expires_at <= now())) then
    raise exception 'This view has ended. Please return to your own account.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.view_as_protect_auth_link(), public.view_as_refuse_refresh() from public, anon, authenticated;

do $$
begin
  if to_regclass('auth.mfa_factors') is not null then
    execute 'create trigger view_as_protect_mfa before insert on auth.mfa_factors
               for each row execute function public.view_as_protect_auth_link()';
  end if;
  if to_regclass('auth.identities') is not null then
    execute 'create trigger view_as_protect_identities before insert or delete on auth.identities
               for each row execute function public.view_as_protect_auth_link()';
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'create trigger view_as_refuse_refresh before insert on auth.refresh_tokens
               for each row execute function public.view_as_refuse_refresh()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Wire the guard into PostgREST (a no-op where there is no authenticator role, as in the tests)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.view_as_guard''';
  end if;
end $$;

notify pgrst, 'reload config';
