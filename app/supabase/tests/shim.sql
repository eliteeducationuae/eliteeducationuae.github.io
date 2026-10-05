-- Minimal stand-in for the Supabase auth schema so migrations and RLS can be tested on plain Postgres.
-- Not used in production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
grant usage on schema public to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Columns used by the View as trigger on auth.users (present in the real auth schema).
alter table auth.users add column if not exists phone text, add column if not exists encrypted_password text;
-- Auth tables used by the View as revocation and guards (present in the real auth schema).
create table if not exists auth.sessions (id uuid primary key, user_id uuid);
create table if not exists auth.refresh_tokens (id bigserial primary key, token text, user_id varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade);
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null);
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null);
