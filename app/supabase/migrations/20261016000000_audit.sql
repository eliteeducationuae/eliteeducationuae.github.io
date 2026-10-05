-- Audit log: an append-only record of who changed what, and when.
--
-- Every insert, update and delete on the business tables below is written to public.audit_events by one
-- generic trigger function, public.audit_row(). Rows are never updated or deleted: the log is kept forever.
-- Only admins can read it (History sections and Admin > More > Activity log in the app).
--
-- RULES (keep in step with AUDIT_RULES in src/domain/audit.ts):
--   Audited tables: lessons, lesson_notes, charges, invoices, payments, packages, tutor_invoices, enrolments,
--     students, families, tutors, settings, services, homework, plus student_reports (status changes only)
--     and opportunities (award and status changes only).
--   Not audited: tutor_payment_details, family_billing, profiles, lesson_private_notes, student_notes and the
--     calendar tables.
--   Ignored columns (never stored; a change to only these creates no event):
--     lessons.reminded_at, lessons.whatsapp_reminded_at,
--     invoices.overdue_whatsapp_at, invoices.autopay_claimed_at, invoices.autopay_attempts,
--     homework.due_whatsapp_at, settings.next_invoice_number, student_reports.updated_at.
--   Redacted columns (the change is recorded, the value is replaced with '[redacted]'): any column whose name
--     matches (bank|iban|swift|account_number|token|secret|password|stripe_), case-insensitive, which
--     includes settings.bank_details. A value that was or becomes empty stays null.
--   student_reports: an update event only when the status changes, storing {status} (plus published_at /
--     submitted_at in "after" when they changed).
--   opportunities: an update event only when the status or awarded tutor changes, storing title (always, so
--     the role can be named) and whichever of status, awarded_tutor_id and awarded_at changed.
--
-- Later migrations add their own tables with:  select public.audit_attach('public.<table>');
-- (tax 20261017, vetting 20261019, contacts 20261015, rates 20261014 and so on). Tables the trigger does not
-- know are filtered by their family_id, student_id and tutor_id columns when present.

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default clock_timestamp(),   -- clock_timestamp so rows in one transaction keep order
  actor_id uuid,            -- profiles.id; deliberately no foreign key so deleting an account never touches history
  actor_name text,          -- snapshot of profiles.full_name at the time; null for the system
  actor_role text,          -- 'admin' | 'tutor' | 'parent' | 'student' | 'system'
  acting_as uuid,           -- profile being viewed as, from current_setting('elite.acting_as', true)
  action text not null check (action in ('insert', 'update', 'delete', 'rpc')),
  table_name text not null,
  row_id text,              -- primary key as text (settings -> '1', lesson_notes -> lesson_id)
  family_ids uuid[] not null default '{}',
  student_ids uuid[] not null default '{}',
  tutor_id uuid,
  related_ids uuid[] not null default '{}',  -- parent records the row belongs to (lesson, invoice, package, cycle, enrolment)
  before jsonb,
  after jsonb
);

comment on table public.audit_events is
  'Append-only audit log, kept indefinitely. Written only by the audit_row() trigger; rows can never be changed or '
  'deleted from the app, the API or the service role. Families, students and related records are arrays because '
  'one row can belong to several (a group lesson can span families).';

create index audit_events_at_idx on public.audit_events (at desc, id desc);
create index audit_events_row_idx on public.audit_events (table_name, row_id);
create index audit_events_tutor_idx on public.audit_events (tutor_id, at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, at desc);
create index audit_events_families_idx on public.audit_events using gin (family_ids);
create index audit_events_students_idx on public.audit_events using gin (student_ids);
create index audit_events_related_idx on public.audit_events using gin (related_ids);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Text to uuid, or null when it is not a uuid. */
create function public.audit_uuid(p text) returns uuid
language sql immutable set search_path = public as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

/** Hide sensitive values: bank details, IBANs, tokens, secrets and payment-provider ids. */
create function public.audit_redact(p_table text, p_row jsonb) returns jsonb
language sql immutable strict set search_path = public as $$
  select coalesce(jsonb_object_agg(k,
    case when v <> 'null'::jsonb
              and (k ~* '(bank|iban|swift|account_number|token|secret|password|stripe_)'
                   or (p_table = 'settings' and k = 'bank_details'))
         then to_jsonb('[redacted]'::text) else v end), '{}'::jsonb)
  from jsonb_each(p_row) as e(k, v)
$$;

/** Columns that are never stored and whose changes alone create no event. */
create function public.audit_ignored(p_table text) returns text[]
language sql immutable set search_path = public as $$
  select case p_table
    when 'lessons' then array['reminded_at', 'whatsapp_reminded_at']
    when 'invoices' then array['overdue_whatsapp_at', 'autopay_claimed_at', 'autopay_attempts']
    when 'homework' then array['due_whatsapp_at']
    when 'settings' then array['next_invoice_number']
    when 'student_reports' then array['updated_at']
    else array[]::text[]
  end
$$;

/** Students' families, de-duplicated. */
create function public.audit_families_of(p_students uuid[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct family_id), '{}') from public.students where id = any (coalesce(p_students, '{}'))
$$;

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb;
  b jsonb;
  a jsonb;
  k text;
  ign text[] := public.audit_ignored(tg_table_name);
  v_actor uuid := auth.uid();
  v_name text;
  v_role text;
  v_acting text := nullif(current_setting('elite.acting_as', true), '');
  fams uuid[] := '{}';
  studs uuid[] := '{}';
  tut uuid;
  rel uuid[] := '{}';
  l record;
begin
  -- What changed ------------------------------------------------------------
  if tg_table_name = 'student_reports' then
    if tg_op <> 'UPDATE' or (o->'status') = (n->'status') then return null; end if;
    b := jsonb_build_object('status', o->'status');
    a := jsonb_build_object('status', n->'status');
    if (o->'published_at') is distinct from (n->'published_at') then a := a || jsonb_build_object('published_at', n->'published_at'); end if;
    if (o->'submitted_at') is distinct from (n->'submitted_at') then a := a || jsonb_build_object('submitted_at', n->'submitted_at'); end if;
  elsif tg_table_name = 'opportunities' then
    if tg_op <> 'UPDATE' then return null; end if;
    b := jsonb_build_object('title', o->'title');
    a := jsonb_build_object('title', n->'title');
    foreach k in array array['status', 'awarded_tutor_id', 'awarded_at'] loop
      if (o->k) is distinct from (n->k) then
        b := b || jsonb_build_object(k, o->k);
        a := a || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if a - 'title' = '{}'::jsonb then return null; end if;
  elsif tg_op = 'UPDATE' then
    b := '{}'; a := '{}';
    for k in select jsonb_object_keys(n) loop
      continue when k = any (ign);
      if (o->k) is distinct from (n->k) then
        b := b || jsonb_build_object(k, o->k);
        a := a || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if a = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then
    a := n - ign;
  else
    b := o - ign;
  end if;
  b := public.audit_redact(tg_table_name, b);
  a := public.audit_redact(tg_table_name, a);

  -- Who did it --------------------------------------------------------------
  if v_actor is not null then
    select p.role, p.full_name into v_role, v_name from public.profiles p where p.id = v_actor;
  end if;
  if v_role is null then v_role := 'system'; v_name := null; end if;

  -- What it belongs to (the new row, or the old one for a delete) ------------
  r := coalesce(n, o);
  case tg_table_name
    when 'families' then
      fams := array[(r->>'id')::uuid];
    when 'students' then
      studs := array[(r->>'id')::uuid];
      fams := array_remove(array[public.audit_uuid(r->>'family_id')], null);
    when 'tutors' then
      tut := (r->>'id')::uuid;
    when 'lessons' then
      studs := coalesce(array(select public.audit_uuid(x) from jsonb_array_elements_text(r->'student_ids') x), '{}');
      fams := public.audit_families_of(studs);
      tut := public.audit_uuid(r->>'tutor_id');
    when 'lesson_notes' then
      rel := array[(r->>'lesson_id')::uuid];
      select ls.student_ids, ls.tutor_id into l from public.lessons ls where ls.id = (r->>'lesson_id')::uuid;
      if found then
        studs := l.student_ids;
        fams := public.audit_families_of(studs);
        tut := l.tutor_id;
      end if;
    when 'charges' then
      studs := array_remove(array[public.audit_uuid(r->>'student_id')], null);
      fams := array_remove(array[public.audit_uuid(r->>'family_id')], null);
      rel := array_remove(array_remove(array_remove(array[public.audit_uuid(r->>'lesson_id'),
               public.audit_uuid(r->>'invoice_id'), public.audit_uuid(r->>'package_id')], null), null), null);
    when 'invoices' then
      fams := array_remove(array[public.audit_uuid(r->>'family_id')], null);
    when 'payments' then
      rel := array_remove(array[public.audit_uuid(r->>'invoice_id')], null);
      fams := coalesce(array(select i.family_id from public.invoices i where i.id = public.audit_uuid(r->>'invoice_id')), '{}');
    when 'packages' then
      fams := array_remove(array[public.audit_uuid(r->>'family_id')], null);
    when 'tutor_invoices' then
      tut := public.audit_uuid(r->>'tutor_id');
    when 'enrolments' then
      studs := array_remove(array[public.audit_uuid(r->>'student_id')], null);
      fams := public.audit_families_of(studs);
      tut := public.audit_uuid(r->>'tutor_id');
    when 'student_reports' then
      studs := array_remove(array[public.audit_uuid(r->>'student_id')], null);
      fams := public.audit_families_of(studs);
      tut := public.audit_uuid(r->>'tutor_id');
      rel := array_remove(array[public.audit_uuid(r->>'cycle_id'), public.audit_uuid(r->>'enrolment_id')], null);
    when 'homework' then
      studs := array_remove(array[public.audit_uuid(r->>'student_id')], null);
      fams := public.audit_families_of(studs);
      tut := public.audit_uuid(r->>'tutor_id');
      rel := array_remove(array[public.audit_uuid(r->>'lesson_id')], null);
    when 'opportunities' then
      tut := public.audit_uuid(r->>'awarded_tutor_id');
      studs := array_remove(array[public.audit_uuid(r->>'student_id')], null);
      fams := public.audit_families_of(studs);
    when 'settings', 'services' then
      null;
    else
      -- Tables attached by later migrations: use the conventional columns when present.
      studs := array_remove(array[public.audit_uuid(r->>'student_id')], null);
      fams := array_remove(array[public.audit_uuid(r->>'family_id')], null);
      if fams = '{}' then fams := public.audit_families_of(studs); end if;
      tut := public.audit_uuid(r->>'tutor_id');
  end case;

  insert into public.audit_events (actor_id, actor_name, actor_role, acting_as, action, table_name, row_id,
                                   family_ids, student_ids, tutor_id, related_ids, before, after)
  values (v_actor, v_name, v_role, public.audit_uuid(v_acting), lower(tg_op), tg_table_name,
          coalesce(n->>'id', o->>'id', n->>'lesson_id', o->>'lesson_id'),
          coalesce(fams, '{}'), coalesce(studs, '{}'), tut, coalesce(rel, '{}'), b, a);
  return null;
end $$;

/** (Re)create the standard audit trigger on a table. Run from migrations only. */
create function public.audit_attach(p_table regclass) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := 'audit_' || (select c.relname from pg_class c where c.oid = p_table);
begin
  if exists (select 1 from pg_trigger where tgrelid = p_table and tgname = v_name) then
    execute format('drop trigger %I on %s', v_name, p_table);
  end if;
  execute format('create trigger %I after insert or update or delete on %s for each row execute function public.audit_row()',
                 v_name, p_table);
end $$;

select public.audit_attach('public.lessons');
select public.audit_attach('public.lesson_notes');
select public.audit_attach('public.charges');
select public.audit_attach('public.invoices');
select public.audit_attach('public.payments');
select public.audit_attach('public.packages');
select public.audit_attach('public.tutor_invoices');
select public.audit_attach('public.enrolments');
select public.audit_attach('public.students');
select public.audit_attach('public.families');
select public.audit_attach('public.tutors');
select public.audit_attach('public.settings');
select public.audit_attach('public.services');
select public.audit_attach('public.homework');

create trigger audit_student_reports after update on public.student_reports
  for each row when (old.status is distinct from new.status) execute function public.audit_row();
create trigger audit_opportunities after update on public.opportunities
  for each row when (old.awarded_tutor_id is distinct from new.awarded_tutor_id or old.status is distinct from new.status)
  execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Immutability and access
-- ---------------------------------------------------------------------------

-- Nobody can change or remove history: not admins, not the service role, not the table owner.
-- A legally required purge needs a database owner to run, in the Supabase SQL editor and deliberately outside
-- the app:  alter table public.audit_events disable trigger audit_events_no_change;  (then delete, then enable).
-- New rows may only come from the audit_row() trigger (so a later blanket grant cannot allow forged events).
create function public.audit_events_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() < 2 then
      raise exception 'Audit events are written automatically and cannot be added by hand' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'The audit log cannot be changed or deleted' using errcode = '42501';
end $$;
create trigger audit_events_no_change before update or delete on public.audit_events
  for each row execute function public.audit_events_immutable();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.audit_events_immutable();
create trigger audit_events_only_trigger before insert on public.audit_events
  for each row execute function public.audit_events_immutable();

alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated, service_role;
grant select on public.audit_events to authenticated, service_role;
create policy "admins read audit" on public.audit_events for select to authenticated using (public.is_admin());

revoke all on function public.audit_row() from public, anon, authenticated;
revoke all on function public.audit_redact(text, jsonb) from public, anon, authenticated;
revoke all on function public.audit_attach(regclass) from public, anon, authenticated, service_role;
revoke all on function public.audit_ignored(text) from public, anon, authenticated;
revoke all on function public.audit_families_of(uuid[]) from public, anon, authenticated;
revoke all on function public.audit_events_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading the log (admins only)
-- ---------------------------------------------------------------------------

create function public.list_audit_events(
  p_entity_id text default null,   -- row_id = p_entity_id, or a related record
  p_family_id uuid default null,
  p_student_id uuid default null,
  p_tutor_id uuid default null,
  p_actor_id uuid default null,
  p_tables text[] default null,
  p_from timestamptz default null, -- at >= p_from
  p_to timestamptz default null,   -- at < p_to
  p_before_at timestamptz default null, p_before_id uuid default null,  -- keyset: (at, id) < (p_before_at, p_before_id)
  p_limit int default 50           -- 1..200
) returns setof public.audit_events
language plpgsql stable security invoker set search_path = public as $$
declare v_entity uuid := public.audit_uuid(p_entity_id);
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
    select e.* from public.audit_events e
    where (p_entity_id is null or e.row_id = p_entity_id or (v_entity is not null and e.related_ids @> array[v_entity]))
      and (p_family_id is null or e.family_ids @> array[p_family_id])
      and (p_student_id is null or e.student_ids @> array[p_student_id])
      and (p_tutor_id is null or e.tutor_id = p_tutor_id)
      and (p_actor_id is null or e.actor_id = p_actor_id)
      and (p_tables is null or e.table_name = any (p_tables))
      and (p_from is null or e.at >= p_from)
      and (p_to is null or e.at < p_to)
      and (p_before_at is null
           or (p_before_id is null and e.at < p_before_at)
           or (p_before_id is not null and (e.at, e.id) < (p_before_at, p_before_id)))
    order by e.at desc, e.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

/** Everyone who has changed something, with their most recent name and role, for the Activity log filter. */
create function public.audit_actors() returns table (actor_id uuid, actor_name text, actor_role text)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
    select x.actor_id, x.actor_name, x.actor_role from (
      select distinct on (e.actor_id) e.actor_id, e.actor_name, e.actor_role
      from public.audit_events e where e.actor_id is not null
      order by e.actor_id, e.at desc, e.id desc
    ) x
    order by x.actor_name nulls last, x.actor_id;
end $$;

revoke all on function public.list_audit_events(text, uuid, uuid, uuid, uuid, text[], timestamptz, timestamptz, timestamptz, uuid, int) from public, anon;
revoke all on function public.audit_actors() from public, anon;
grant execute on function public.list_audit_events(text, uuid, uuid, uuid, uuid, text[], timestamptz, timestamptz, timestamptz, uuid, int) to authenticated, service_role;
grant execute on function public.audit_actors() to authenticated, service_role;
-- list_audit_events runs as the caller and uses this pure helper.
revoke all on function public.audit_uuid(text) from public, anon;
grant execute on function public.audit_uuid(text) to authenticated, service_role;
