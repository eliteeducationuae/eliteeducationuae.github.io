-- Elite Education — launch readiness: closing accounts, exporting personal data, error reporting, system health,
-- the migrations ledger and scheduled backups.
--
-- 1. Migrations ledger (db_migrations, record_migration, db_version) so the office can see which database version is live.
-- 2. Error tables: app_errors (reported by the app), function_errors and function_runs (written by the Edge Functions).
-- 3. log_app_error: scrubbed, rate-limited error reports from the app (signed in or not).
-- 4. system_health / system_health_report: one JSON report of every background job, read by the System health screen
--    and the health-check Edge Function.
-- 5. export_my_data: a copy of the caller's own personal data.
-- 6. Account deletion: deletion_requests and the anonymise_* functions run by the delete-account Edge Function. Money
--    records (invoices, charges, payments, packages, tutor invoices) are kept for tax law; personal details are removed.
-- 7. The private 'backups' storage bucket written by the backup-export Edge Function (service role only).

-- ---------------------------------------------------------------------------
-- 1. Migrations ledger
-- ---------------------------------------------------------------------------

create table public.db_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
alter table public.db_migrations enable row level security;
create policy "admin reads migrations" on public.db_migrations for select to authenticated using (public.is_admin());
revoke all on public.db_migrations from anon, authenticated;
grant select on public.db_migrations to authenticated;

/** Records that a migration has been applied. Each migration from this one onwards ends by calling it. */
create function public.record_migration(p_version text, p_name text) returns void
language sql security definer set search_path = public as $$
  insert into public.db_migrations (version, name, applied_at) values (p_version, p_name, now())
  on conflict (version) do update set name = excluded.name
$$;
revoke all on function public.record_migration(text, text) from public, anon, authenticated;

-- Migrations applied before the ledger existed.
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
  ('20261012010000', 'classwork_security')
on conflict (version) do nothing;

/**
 * Every applied migration: the ledger above, together with the Supabase CLI's own record
 * (supabase_migrations.schema_migrations) where it exists, so a migration that never called record_migration still
 * shows. Administrators and the service role only (the service role calls it without a signed-in user).
 */
create function public.db_version() returns table (version text, name text, applied_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare has_name boolean;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only administrators can view the database version.' using errcode = '42501';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return query select m.version, m.name, m.applied_at from public.db_migrations m;
    return;
  end if;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' and column_name = 'name')
    into has_name;
  return query execute format(
    'select coalesce(a.version, b.version)::text, coalesce(a.name, b.name)::text, a.applied_at
       from public.db_migrations a
       full join (select s.version::text as version, %s as name
                    from supabase_migrations.schema_migrations s) b on b.version = a.version',
    case when has_name then 's.name::text' else 'null::text' end);
end $$;
revoke all on function public.db_version() from public, anon;
grant execute on function public.db_version() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Error tables
-- ---------------------------------------------------------------------------

/** Errors reported by the app. Scrubbed of personal details before they are stored (see log_app_error). */
create table public.app_errors (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  profile_id uuid references public.profiles(id) on delete set null,
  role text,
  platform text check (platform in ('ios', 'android', 'web', 'unknown')),
  app_version text,
  route text,
  source text check (source in ('boundary', 'query', 'mutation', 'global', 'manual')),
  message text not null,
  stack text,
  fingerprint text
);
create index app_errors_created_idx on public.app_errors (created_at desc);
create index app_errors_profile_idx on public.app_errors (profile_id, created_at desc);

/** Errors in the Edge Functions, written with the service role (withMonitoring in _shared/monitoring.ts). */
create table public.function_errors (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  function_name text not null,
  message text not null,
  status int,
  context jsonb not null default '{}'
);
create index function_errors_created_idx on public.function_errors (function_name, created_at desc);

/** The last run of each Edge Function, and the last health alert sent (on the 'health-check' row). */
create table public.function_runs (
  function_name text primary key,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  last_alert_at timestamptz,
  last_alert_key text
);

alter table public.app_errors enable row level security;
alter table public.function_errors enable row level security;
alter table public.function_runs enable row level security;
create policy "admin reads app errors" on public.app_errors for select to authenticated using (public.is_admin());
create policy "admin reads function errors" on public.function_errors for select to authenticated using (public.is_admin());
create policy "admin reads function runs" on public.function_runs for select to authenticated using (public.is_admin());
revoke all on public.app_errors, public.function_errors, public.function_runs from anon, authenticated;
grant select on public.app_errors, public.function_errors, public.function_runs to authenticated;
revoke all on sequence public.app_errors_id_seq, public.function_errors_id_seq from anon, authenticated;

/** Error reports are kept for 90 days. Called by the health-check Edge Function. */
create function public.purge_old_errors() returns int
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  delete from public.app_errors where created_at < now() - interval '90 days';
  get diagnostics a = row_count;
  delete from public.function_errors where created_at < now() - interval '90 days';
  get diagnostics b = row_count;
  return a + b;
end $$;
revoke all on function public.purge_old_errors() from public, anon, authenticated;
grant execute on function public.purge_old_errors() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Error reports from the app
-- ---------------------------------------------------------------------------

/**
 * Removes personal details from free text: email addresses, phone-like numbers (7 or more digits), login tokens and
 * other long codes. The same rules as scrubText() in supabase/functions/_shared/monitoring.ts and the app's reporter.
 */
create function public.scrub_error_text(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(p,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[email]', 'g'),
    'eyJ[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,2}', '[token]', 'g'),
    '[0-9a-fA-F]{32,}', '[token]', 'g'),
    '(?=[A-Za-z+_=-]*[0-9])[A-Za-z0-9+_=-]{32,}', '[token]', 'g'),
    '\+?[0-9](?:[ -]?[0-9]){6,}', '[number]', 'g')
$$;
revoke all on function public.scrub_error_text(text) from public, anon, authenticated;

/**
 * The app reports an error. Returns false (never raises) when the report is dropped by the rate limit:
 * a signed-in person may send 30 reports in 10 minutes and the same fingerprint once a minute; reports from people
 * who are not signed in are capped at 200 an hour in total.
 */
create function public.log_app_error(
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
    if (select count(*) from public.app_errors
         where profile_id is null and created_at > now() - interval '1 hour') >= 200 then
      return false;
    end if;
  end if;

  insert into public.app_errors (profile_id, role, platform, app_version, route, source, message, stack, fingerprint)
  values (
    v_profile,
    v_role,
    case when p_platform in ('ios', 'android', 'web') then p_platform else 'unknown' end,
    left(public.scrub_error_text(p_app_version), 50),
    left(public.scrub_error_text(regexp_replace(p_route, '[?#].*$', '')), 200),
    case when p_source in ('boundary', 'query', 'mutation', 'global', 'manual') then p_source else 'manual' end,
    left(public.scrub_error_text(left(p_message, 2000)), 500),
    left(public.scrub_error_text(left(p_stack, 8000)), 4000),
    left(p_fingerprint, 200)
  );
  return true;
end $$;
revoke all on function public.log_app_error(text, text, text, text, text, text, text) from public;
grant execute on function public.log_app_error(text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. System health
-- ---------------------------------------------------------------------------

/**
 * The health of every background job, as read by the System health screen (camelCase keys, a contract with the app):
 * { checkedAt, status, checks: [{ key, label, status, detail, count }], jobs: [{ name, lastStartedAt, lastSucceededAt,
 *   lastFailedAt, lastError }], database: { latest, latestName, count, migrations: [{ version, name, appliedAt }] } }.
 * Details are counts only: never names, contact details or message contents. Service role only; admins use system_health().
 */
create function public.system_health_report() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  -- Matches MAX_ATTEMPTS in the send-notifications Edge Function.
  max_attempts constant int := 5;
  checks jsonb := '[]';
  n int; m int;
  st text; detail text;
  run public.function_runs;
  queued int; unknown_n int;
  stale boolean;
  overall text := 'ok';
  jobs jsonb;
  migrations jsonb;
  latest_version text;
  latest_name text;
  total_migrations int;
begin
  -- Emails and push notifications ------------------------------------------------
  select count(*) into n from public.notification_outbox
   where sent_at is null and attempts < max_attempts and created_at < now() - interval '10 minutes'
     and (whatsapp_not_before is null or whatsapp_not_before <= now());
  select count(*) into m from public.notification_outbox
   where sent_at is null and attempts >= max_attempts and created_at > now() - interval '24 hours';
  if n > 0 then
    st := 'failing';
    detail := n || case when n = 1 then ' notification has' else ' notifications have' end
      || ' been waiting for more than 10 minutes.';
  elsif m > 0 then
    st := 'warning'; n := m;
    detail := m || case when m = 1 then ' notification' else ' notifications' end
      || ' could not be delivered after ' || max_attempts || ' attempts in the last 24 hours.';
  else
    st := 'ok'; detail := 'All notifications are being sent.';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'notifications', 'label', 'Emails and push notifications',
    'status', st, 'detail', detail, 'count', n));

  -- WhatsApp ---------------------------------------------------------------------
  select count(*) into n from public.notification_outbox
   where whatsapp and whatsapp_status = 'pending'
     and coalesce(whatsapp_not_before, created_at) < now() - interval '10 minutes';
  select count(*) into m from public.notification_outbox
   where whatsapp and whatsapp_status = 'failed' and created_at > now() - interval '24 hours';
  if n > 0 then
    st := 'failing';
    detail := n || case when n = 1 then ' WhatsApp message is' else ' WhatsApp messages are' end
      || ' more than 10 minutes late.';
  elsif m >= 5 then
    st := 'failing'; n := m;
    detail := m || ' WhatsApp messages could not be sent in the last 24 hours.';
  elsif m > 0 then
    st := 'warning'; n := m;
    detail := m || case when m = 1 then ' WhatsApp message' else ' WhatsApp messages' end
      || ' could not be sent in the last 24 hours.';
  else
    st := 'ok'; detail := 'WhatsApp messages are being sent.';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'whatsapp', 'label', 'WhatsApp messages',
    'status', st, 'detail', detail, 'count', n));

  -- Calendar sync ----------------------------------------------------------------
  select count(*) into n from public.calendar_sync_queue
   where processed_at is null and (created_at < now() - interval '30 minutes' or attempts >= 5);
  if n > 0 then
    st := 'failing';
    detail := n || case when n = 1 then ' lesson change has' else ' lesson changes have' end
      || ' not reached Google Calendar after 30 minutes.';
  else
    st := 'ok'; detail := 'Google Calendar is up to date.';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'calendar', 'label', 'Google Calendar sync',
    'status', st, 'detail', detail, 'count', n));

  -- Autopay ------------------------------------------------------------------------
  select * into run from public.function_runs where function_name = 'charge-invoice';
  select count(*) into queued from public.invoices where autopay_status in ('pending', 'processing', 'unknown');
  select count(*) into unknown_n from public.invoices where autopay_status = 'unknown';
  stale := run.last_started_at is null or run.last_started_at < now() - interval '30 minutes';
  if stale and queued > 0 then
    st := 'failing'; n := queued;
    detail := 'Automatic card payments have not run for more than 30 minutes and ' || queued
      || case when queued = 1 then ' invoice is' else ' invoices are' end || ' waiting.';
  elsif stale and run.last_started_at is not null then
    st := 'warning'; n := 0;
    detail := 'Automatic card payments have not run for more than 30 minutes. Nothing is waiting to be charged.';
  elsif unknown_n > 0 then
    st := 'warning'; n := unknown_n;
    detail := unknown_n || case when unknown_n = 1 then ' card payment has' else ' card payments have' end
      || ' an unconfirmed outcome and will be checked with Stripe again.';
  else
    st := 'ok'; n := queued;
    detail := 'Automatic card payments are running.';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'autopay', 'label', 'Automatic card payments',
    'status', st, 'detail', detail, 'count', n));

  -- Stripe webhook -----------------------------------------------------------------
  select count(*) into n from public.function_errors
   where function_name = 'stripe-webhook' and created_at > now() - interval '24 hours';
  if n > 0 then
    st := 'failing';
    detail := 'The Stripe webhook reported ' || n || case when n = 1 then ' error' else ' errors' end
      || ' in the last 24 hours. Some card payments may not have been recorded.';
  else
    st := 'ok'; detail := 'Stripe payments are being recorded.';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'stripe', 'label', 'Stripe payments',
    'status', st, 'detail', detail, 'count', n));

  -- Other server errors --------------------------------------------------------------
  select count(*) into n from public.function_errors
   where function_name <> 'stripe-webhook' and created_at > now() - interval '24 hours';
  st := case when n >= 10 then 'failing' when n >= 1 then 'warning' else 'ok' end;
  detail := case when n = 0 then 'No server errors in the last 24 hours.'
    else n || case when n = 1 then ' server error' else ' server errors' end || ' in the last 24 hours.' end;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'server-errors', 'label', 'Server errors',
    'status', st, 'detail', detail, 'count', n));

  -- App errors -----------------------------------------------------------------------
  select count(*) into n from public.app_errors where created_at > now() - interval '24 hours';
  st := case when n >= 100 then 'failing' when n >= 20 then 'warning' else 'ok' end;
  detail := case when n = 0 then 'No app errors in the last 24 hours.'
    else n || case when n = 1 then ' app error was' else ' app errors were' end || ' reported in the last 24 hours.' end;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'app-errors', 'label', 'App errors',
    'status', st, 'detail', detail, 'count', n));

  -- Backups --------------------------------------------------------------------------
  select * into run from public.function_runs where function_name = 'backup-export';
  n := 0;
  if run.last_failed_at is not null and (run.last_succeeded_at is null or run.last_failed_at > run.last_succeeded_at) then
    st := 'failing'; n := 1;
    detail := 'The last nightly backup failed. Please check the backup-export function.';
  elsif run.last_succeeded_at is null then
    st := 'warning';
    detail := 'No nightly backup has been recorded yet.';
  elsif run.last_succeeded_at < now() - interval '26 hours' then
    st := 'warning';
    detail := 'The last nightly backup finished more than 26 hours ago.';
  else
    st := 'ok'; detail := 'The nightly backup is up to date.';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('key', 'backups', 'label', 'Nightly backups',
    'status', st, 'detail', detail, 'count', n));

  -- Overall status is the worst check.
  if exists (select 1 from jsonb_array_elements(checks) c where c->>'status' = 'failing') then overall := 'failing';
  elsif exists (select 1 from jsonb_array_elements(checks) c where c->>'status' = 'warning') then overall := 'warning';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.function_name, 'lastStartedAt', r.last_started_at, 'lastSucceededAt', r.last_succeeded_at,
           'lastFailedAt', r.last_failed_at, 'lastError', r.last_error) order by r.function_name), '[]')
    into jobs from public.function_runs r;

  select count(*) into total_migrations from public.db_version();
  select v.version, v.name into latest_version, latest_name from public.db_version() v order by v.version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('version', x.version, 'name', x.name, 'appliedAt', x.applied_at)
           order by x.version desc), '[]')
    into migrations
    from (select v.version, v.name, v.applied_at from public.db_version() v order by v.version desc limit 100) x;

  return jsonb_build_object(
    'checkedAt', now(),
    'status', overall,
    'checks', checks,
    'jobs', jobs,
    'database', jsonb_build_object('latest', latest_version, 'latestName', latest_name,
                                   'count', total_migrations, 'migrations', migrations));
end $$;
revoke all on function public.system_health_report() from public, anon, authenticated;
grant execute on function public.system_health_report() to service_role;

/** The System health screen. Administrators only. */
create function public.system_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can view system health' using errcode = '42501';
  end if;
  return public.system_health_report();
end $$;
revoke all on function public.system_health() from public, anon;
grant execute on function public.system_health() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A copy of my data
-- ---------------------------------------------------------------------------

/**
 * Everything the app holds about the caller, as JSON (format 'elite-education-export/1'). Only the caller's own
 * records: a parent receives their family and children; a student their own record; a tutor their tutor record, the
 * lessons they teach and their payment details with the account number masked. Never includes private tutor notes,
 * calendar or push tokens, Stripe identifiers or full bank account numbers.
 */
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  fam public.families;
  sids uuid[] := '{}';
  tid uuid;
  lesson_ids uuid[] := '{}';
  is_family_login boolean;
  result jsonb;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Please sign in to download your data.' using errcode = '42501'; end if;

  is_family_login := p.role = 'parent' and p.family_id is not null;
  if is_family_login then
    select * into fam from public.families where id = p.family_id;
    sids := array(select s.id from public.students s where s.family_id = p.family_id order by s.full_name);
  elsif p.role = 'student' and p.student_id is not null then
    sids := array[p.student_id];
  end if;
  if p.role in ('tutor', 'admin') then tid := p.tutor_id; end if;

  if cardinality(sids) > 0 then
    lesson_ids := array(select l.id from public.lessons l where l.student_ids && sids);
  elsif tid is not null then
    lesson_ids := array(select l.id from public.lessons l where l.tutor_id = tid);
  end if;

  result := jsonb_build_object(
    'format', 'elite-education-export/1',
    'exportedAt', now(),
    'account', jsonb_build_object('fullName', p.full_name, 'email', p.email, 'phone', p.phone, 'role', p.role,
                                  'whatsappOptIn', p.whatsapp_opt_in, 'whatsappNumber', p.whatsapp_number),
    'family', case when is_family_login and fam.id is not null then
      jsonb_build_object('name', fam.name, 'parentName', fam.parent_name, 'email', fam.email, 'phone', fam.phone) end,
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'fullName', s.full_name, 'curriculum', s.curriculum, 'school', s.school, 'yearGroup', s.year_group,
        'currentGrade', s.current_grade, 'targetGrade', s.target_grade, 'examDate', s.exam_date) order by s.full_name), '[]')
      from public.students s where s.id = any (sids)),
    'enrolments', (select coalesce(jsonb_agg(jsonb_build_object(
        'studentId', e.student_id, 'subject', e.subject, 'curriculum', e.curriculum, 'level', e.level,
        'examBoard', e.exam_board, 'active', e.active, 'tutorName', t.full_name, 'createdAt', e.created_at)
        order by e.created_at), '[]')
      from public.enrolments e left join public.tutors t on t.id = e.tutor_id where e.student_id = any (sids)),
    'lessons', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'startAt', l.start_at, 'endAt', l.end_at, 'status', l.status, 'location', l.location,
        'subject', coalesce(l.subject, svc.subject, svc.name), 'service', svc.name, 'tutorName', t.full_name,
        'studentNames', (select coalesce(jsonb_agg(s.full_name order by s.full_name), '[]') from public.students s
                          where s.id = any (l.student_ids) and (tid is not null and l.tutor_id = tid or s.id = any (sids))))
        order by l.start_at), '[]')
      from public.lessons l
      join public.services svc on svc.id = l.service_id
      join public.tutors t on t.id = l.tutor_id
      where l.id = any (lesson_ids)),
    -- Shared lesson notes only. Private tutor notes (lesson_private_notes) and student_notes are never exported.
    'lessonNotes', (select coalesce(jsonb_agg(jsonb_build_object(
        'lessonId', n.lesson_id, 'summary', n.summary, 'createdAt', n.created_at) order by n.created_at), '[]')
      from public.lesson_notes n where n.lesson_id = any (lesson_ids) and length(n.summary) > 0),
    'homework', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'studentId', h.student_id, 'title', h.title, 'details', h.details, 'dueDate', h.due_date,
        'done', h.done, 'createdAt', h.created_at,
        'attachments', (select coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'name', a->>'name', 'url', a->>'url')), '[]')
                          from jsonb_array_elements(h.attachments) a)) order by h.due_date), '[]')
      from public.homework h where h.student_id = any (sids)),
    'homeworkSubmissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'homeworkId', x.homework_id, 'studentId', x.student_id, 'submittedAt', x.submitted_at, 'note', x.note,
        'files', (select coalesce(jsonb_agg(f->>'name'), '[]') from jsonb_array_elements(x.files) f),
        'feedback', x.feedback, 'mark', x.mark, 'feedbackAt', x.feedback_at) order by x.submitted_at), '[]')
      from public.homework_submissions x where x.student_id = any (sids)),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
        'studentId', r.student_id, 'cycle', c.name, 'subject', r.subject, 'attainment', r.attainment, 'effort', r.effort,
        'progress', r.progress, 'strengths', r.strengths, 'nextSteps', r.next_steps, 'comment', r.comment,
        'publishedAt', r.published_at) order by r.published_at), '[]')
      from public.student_reports r join public.report_cycles c on c.id = r.cycle_id
      where r.student_id = any (sids) and r.status = 'published'),
    'invoices', case when is_family_login then (select coalesce(jsonb_agg(jsonb_build_object(
        'number', i.number, 'issueDate', i.issue_date, 'dueDate', i.due_date, 'status', i.status,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('description', it->>'description',
                    'quantity', it->'quantity', 'unitPrice', it->'unitPrice')), '[]') from jsonb_array_elements(i.items) it),
        'vatRate', i.vat_rate, 'total', public.invoice_total(i)) order by i.issue_date, i.number), '[]')
      from public.invoices i where i.family_id = p.family_id and i.status <> 'draft') else '[]'::jsonb end,
    'payments', case when is_family_login then (select coalesce(jsonb_agg(jsonb_build_object(
        'invoiceNumber', i.number, 'amount', pay.amount, 'method', pay.method, 'paidAt', pay.paid_at) order by pay.paid_at), '[]')
      from public.payments pay join public.invoices i on i.id = pay.invoice_id where i.family_id = p.family_id) else '[]'::jsonb end,
    'packages', case when is_family_login then (select coalesce(jsonb_agg(jsonb_build_object(
        'name', k.name, 'lessonsTotal', k.lessons_total, 'lessonsUsed', k.lessons_used, 'price', k.price,
        'purchasedAt', k.purchased_at, 'expiresAt', k.expires_at) order by k.purchased_at), '[]')
      from public.packages k where k.family_id = p.family_id) else '[]'::jsonb end,
    'messages', (select coalesce(jsonb_agg(jsonb_build_object(
        'sentAt', mm.created_at, 'body', mm.body, 'fromMe', mm.sender_id is not distinct from p.id) order by mm.created_at), '[]')
      from public.messages mm
      where (is_family_login and mm.family_id = p.family_id) or (not is_family_login and mm.sender_id = p.id)),
    'lessonRequests', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', q.kind, 'status', q.status, 'studentId', q.student_id, 'subject', q.subject, 'startAt', q.start_at,
        'endAt', q.end_at, 'note', q.note, 'response', q.response, 'createdAt', q.created_at) order by q.created_at), '[]')
      from public.lesson_requests q
      where (is_family_login and q.family_id = p.family_id)
         or (p.role = 'student' and (q.requested_by = p.id or q.student_id = any (sids)))),
    'tutor', (select jsonb_build_object('fullName', t.full_name, 'email', t.email, 'phone', t.phone, 'subjects', t.subjects)
      from public.tutors t where t.id = tid),
    'availability', (select coalesce(jsonb_agg(jsonb_build_object(
        'weekday', a.weekday, 'startTime', a.start_time, 'endTime', a.end_time) order by a.weekday, a.start_time), '[]')
      from public.availability a where a.tutor_id = tid),
    'tutorInvoices', (select coalesce(jsonb_agg(jsonb_build_object(
        'number', ti.number, 'month', to_char(ti.period_start, 'YYYY-MM'), 'status', ti.status,
        'total', public.tutor_invoice_total(ti)) order by ti.period_start), '[]')
      from public.tutor_invoices ti where ti.tutor_id = tid),
    -- Masked: the full IBAN never leaves the database in an export.
    'paymentDetails', (select jsonb_build_object('accountName', d.account_name, 'bankName', d.bank_name,
                                                  'ibanLast4', right(d.iban, 4))
      from public.tutor_payment_details d where d.tutor_id = tid)
  );
  return result;
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Closing accounts
-- ---------------------------------------------------------------------------

alter table public.families add column if not exists deleted_at timestamptz;
alter table public.students add column if not exists deleted_at timestamptz;
alter table public.tutors add column if not exists deleted_at timestamptz;

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  target_kind text not null check (target_kind in ('profile', 'family', 'tutor')),
  profile_id uuid references public.profiles(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  tutor_id uuid references public.tutors(id) on delete set null,
  role text,
  -- Identifies the account while the request is pending; replaced by a label without personal details on completion.
  label text not null,
  reason text,
  requested_by uuid references public.profiles(id) on delete set null,
  processed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  summary jsonb not null default '{}',
  error text
);
create index deletion_requests_status_idx on public.deletion_requests (status, created_at desc);
alter table public.deletion_requests enable row level security;
create policy "admin reads deletion requests" on public.deletion_requests for select to authenticated using (public.is_admin());
revoke all on public.deletion_requests from anon, authenticated;
grant select on public.deletion_requests to authenticated;

/** Placeholder email for a closed account: unique, and never deliverable (.invalid is reserved). */
create function public.deleted_email(p_id uuid) returns text
language sql immutable as $$ select 'deleted-' || left(p_id::text, 8) || '@deleted.invalid' $$;
revoke all on function public.deleted_email(uuid) from public, anon, authenticated;

/** Refuses to remove the only administrator. */
create function public.assert_not_last_admin(p_profile_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_profile_id and role = 'admin')
     and not exists (select 1 from public.profiles where role = 'admin' and id <> p_profile_id) then
    raise exception 'You are the only administrator. Please appoint another administrator before deleting this account.'
      using errcode = 'P0001', hint = 'last_admin';
  end if;
end $$;
revoke all on function public.assert_not_last_admin(uuid) from public, anon, authenticated;

/**
 * A student record: name and school details removed, notes, homework, hand-ins, ratings, subjects, reports and lesson
 * requests deleted. The record itself stays (as 'Former student') because retained invoices and charges refer to it.
 * Returns { storagePaths, storageFolders } for the files the delete-account Edge Function removes from storage.
 */
create function public.anonymise_student(p_student_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare paths jsonb;
begin
  select coalesce(jsonb_agg(distinct 'classwork/' || (f->>'path')), '[]') into paths
  from (
    select a as f from public.homework h, jsonb_array_elements(h.attachments) a where h.student_id = p_student_id
    union all
    select a from public.homework_submissions x, jsonb_array_elements(x.files) a where x.student_id = p_student_id
  ) files
  where f->>'kind' = 'file' and f->>'path' like 'students/' || p_student_id::text || '/%';

  delete from public.student_notes where student_id = p_student_id;
  delete from public.homework_submissions where student_id = p_student_id;
  delete from public.homework where student_id = p_student_id;
  delete from public.topic_ratings where student_id = p_student_id;
  delete from public.enrolments where student_id = p_student_id;
  delete from public.student_reports where student_id = p_student_id;
  delete from public.lesson_requests where student_id = p_student_id;
  update public.resources set student_ids = array_remove(student_ids, p_student_id) where p_student_id = any (student_ids);
  update public.students
     set full_name = 'Former student', school = null, year_group = null, current_grade = null, target_grade = null,
         exam_date = null, phase = null, deleted_at = coalesce(deleted_at, now())
   where id = p_student_id;
  return jsonb_build_object('storagePaths', paths,
                            'storageFolders', jsonb_build_array('classwork/students/' || p_student_id::text || '/'));
end $$;
revoke all on function public.anonymise_student(uuid) from public, anon, authenticated;

/**
 * A family closes its account: the whole family is anonymised. Upcoming lessons for only this family's children are
 * cancelled ('Account closed'); in group lessons the children are removed instead. Invoices, charges, payments and
 * packages are kept for tax records.
 *
 * LEGAL REVIEW (Craig): families.name (the surname) is kept as the bill-to name on retained tax invoices, which UAE VAT
 * law may require for the retention period. Please confirm with the accountant; if not required it can be replaced too.
 */
create function public.anonymise_family(p_family_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fam public.families;
  sids uuid[];
  sid uuid;
  part jsonb;
  paths jsonb := '[]';
  folders jsonb := '[]';
  cancelled int := 0;
  n int;
  has_card_payments boolean;
begin
  select * into fam from public.families where id = p_family_id for update;
  if fam.id is null then raise exception 'Family not found'; end if;
  sids := array(select id from public.students where family_id = p_family_id);

  -- Upcoming lessons: cancel those for only this family's children; remove the children from group lessons.
  update public.lessons
     set status = 'cancelled', cancel_reason = 'Account closed', cancelled_at = now()
   where status = 'scheduled' and start_at > now() and student_ids <@ sids and cardinality(sids) > 0;
  get diagnostics cancelled = row_count;
  update public.lessons
     set student_ids = array(select x from unnest(student_ids) x where x <> all (sids))
   where status = 'scheduled' and start_at > now() and student_ids && sids and not (student_ids <@ sids);
  get diagnostics n = row_count;

  foreach sid in array sids loop
    part := public.anonymise_student(sid);
    paths := paths || (part->'storagePaths');
    folders := folders || (part->'storageFolders');
  end loop;

  delete from public.lesson_requests where family_id = p_family_id;
  delete from public.messages where family_id = p_family_id;
  delete from public.message_reads where family_id = p_family_id;
  -- Emails waiting for (or already sent to) the family address carry names and lesson details.
  delete from public.notification_outbox
   where profile_id is null and email is not null and lower(email) = lower(fam.email);
  update public.enquiries
     set parent_name = 'Former family', email = null, phone = null, student_name = null, message = null,
         preferred_times = null, notes = null
   where family_id = p_family_id;

  -- Saved card summary removed and autopay off. The Stripe customer id is kept only when card payments were taken,
  -- so a refund can still be made; otherwise it is cleared.
  select exists (select 1 from public.payments pay join public.invoices i on i.id = pay.invoice_id
                  where i.family_id = p_family_id and pay.method = 'card') into has_card_payments;
  update public.family_billing
     set autopay = false, card_brand = null, card_last4 = null, card_expires = null, updated_at = now(),
         stripe_customer_id = case when has_card_payments then stripe_customer_id end
   where family_id = p_family_id;

  update public.families
     set parent_name = name, email = public.deleted_email(id), phone = null, status = 'archived',
         deleted_at = coalesce(deleted_at, now())
   where id = p_family_id;

  return jsonb_build_object(
    'familyAnonymised', true,
    'studentsAnonymised', coalesce(cardinality(sids), 0),
    'futureLessonsCancelled', cancelled,
    'groupLessonsUpdated', n,
    'invoicesRetained', (select count(*) from public.invoices where family_id = p_family_id),
    'paymentsRetained', (select count(*) from public.payments pay join public.invoices i on i.id = pay.invoice_id
                          where i.family_id = p_family_id),
    'packagesRetained', (select count(*) from public.packages where family_id = p_family_id),
    'storagePaths', paths,
    'storageFolders', folders);
end $$;
revoke all on function public.anonymise_family(uuid) from public, anon, authenticated;

/**
 * A tutor leaves: name and contact details removed, availability, absences, bank details and calendar links deleted.
 * Tutor invoices and lessons are kept for pay and tax records. Upcoming lessons are not cancelled; they are counted
 * so the office can give them to another tutor.
 */
create function public.anonymise_tutor(p_tutor_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare paths jsonb; upcoming int;
begin
  if not exists (select 1 from public.tutors where id = p_tutor_id) then raise exception 'Tutor not found'; end if;

  select coalesce(jsonb_agg('applications/' || cv_path), '[]') into paths
    from public.tutor_applications where tutor_id = p_tutor_id and cv_path is not null;
  update public.tutor_applications
     set full_name = 'Former tutor', email = public.deleted_email(id), phone = null, experience = null,
         qualifications = null, availability = null, cv_path = null, notes = null
   where tutor_id = p_tutor_id;

  delete from public.availability where tutor_id = p_tutor_id;
  delete from public.tutor_absences where tutor_id = p_tutor_id;
  delete from public.tutor_payment_details where tutor_id = p_tutor_id;
  delete from public.busy_blocks where tutor_id = p_tutor_id;
  delete from public.lesson_calendar_events
   where profile_id in (select id from public.profiles where tutor_id = p_tutor_id and role = 'tutor');
  delete from public.calendar_connections
   where profile_id in (select id from public.profiles where tutor_id = p_tutor_id and role = 'tutor');

  update public.tutors
     set full_name = 'Former tutor', email = public.deleted_email(id), phone = null, deleted_at = coalesce(deleted_at, now())
   where id = p_tutor_id;

  select count(*) into upcoming from public.lessons
   where tutor_id = p_tutor_id and status = 'scheduled' and start_at > now();
  return jsonb_build_object('upcomingLessonsNeedingTutor', upcoming, 'storagePaths', paths,
    'tutorInvoicesRetained', (select count(*) from public.tutor_invoices where tutor_id = p_tutor_id));
end $$;
revoke all on function public.anonymise_tutor(uuid) from public, anon, authenticated;

/**
 * A login's own data, cleared before its auth user is removed (which then deletes the profile): contact details,
 * WhatsApp consent, push token, queued notifications, calendar links; messages they wrote stay in the family's
 * conversation without their name.
 */
create function public.anonymise_profile_data(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text; former text;
begin
  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then return; end if;
  former := case v_role when 'tutor' then 'Former tutor' when 'student' then 'Former student'
                        when 'admin' then 'Elite Education' else 'Former parent' end;
  update public.messages set sender_id = null, sender_name = former where sender_id = p_profile_id;
  update public.homework_submissions set submitted_by_name = former where submitted_by = p_profile_id;
  update public.homework_submissions set feedback_by_name = former where feedback_by = p_profile_id;
  update public.resources set uploaded_by_name = former where uploaded_by = p_profile_id;
  delete from public.notification_outbox where profile_id = p_profile_id;
  delete from public.message_reads where profile_id = p_profile_id;
  delete from public.lesson_calendar_events where profile_id = p_profile_id;
  delete from public.calendar_connections where profile_id = p_profile_id;
  delete from public.calendar_oauth_states where profile_id = p_profile_id;
  update public.profiles
     set phone = null, whatsapp_opt_in = false, whatsapp_number = null, whatsapp_opted_in_at = null, push_token = null
   where id = p_profile_id;
end $$;
revoke all on function public.anonymise_profile_data(uuid) from public, anon, authenticated;

/** How a closed account is described once its personal details are gone. */
create function public.deletion_closed_label(p_kind text, p_role text) returns text
language sql immutable as $$
  select case
    when p_kind = 'family' then 'Family (closed)'
    when p_kind = 'tutor' then 'Tutor (closed)'
    when p_role = 'parent' then 'Parent account (closed)'
    when p_role = 'student' then 'Student login (closed)'
    when p_role = 'tutor' then 'Tutor (closed)'
    when p_role = 'admin' then 'Administrator (closed)'
    else 'Account (closed)' end
$$;
revoke all on function public.deletion_closed_label(text, text) from public, anon, authenticated;

/** '1 invoice' / '3 invoices' from a count in a deletion summary. */
create function public.deletion_count(p_summary jsonb, p_key text, p_one text, p_many text) returns text
language sql immutable as $$
  select coalesce(p_summary->>p_key, '0') || ' ' || case when coalesce(p_summary->>p_key, '0') = '1' then p_one else p_many end
$$;
revoke all on function public.deletion_count(jsonb, text, text, text) from public, anon, authenticated;

/** The office records a request to close an account (exactly one target). Returns the request id. */
create function public.admin_record_deletion_request(
  p_profile_id uuid default null, p_family_id uuid default null, p_tutor_id uuid default null, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles; fam public.families; t public.tutors;
  v_kind text; v_label text; v_role text; v_family uuid; v_tutor uuid; v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can record a deletion request.' using errcode = '42501';
  end if;
  if num_nonnulls(p_profile_id, p_family_id, p_tutor_id) <> 1 then
    raise exception 'Please choose exactly one account to close.';
  end if;

  if p_profile_id is not null then
    select * into p from public.profiles where id = p_profile_id;
    if p.id is null then raise exception 'That account could not be found.'; end if;
    perform public.assert_not_last_admin(p.id);
    v_kind := 'profile'; v_role := p.role; v_family := p.family_id; v_tutor := p.tutor_id;
    select * into fam from public.families where id = p.family_id;
    v_label := case p.role
      when 'parent' then 'Parent account (' || coalesce(fam.name, p.full_name) || ' family)'
      when 'student' then 'Student login (' || p.full_name || ')'
      when 'tutor' then 'Tutor (' || p.full_name || ')'
      else 'Administrator (' || p.full_name || ')' end;
  elsif p_family_id is not null then
    select * into fam from public.families where id = p_family_id;
    if fam.id is null then raise exception 'That family could not be found.'; end if;
    if fam.deleted_at is not null then raise exception 'This family''s account has already been closed.'; end if;
    v_kind := 'family'; v_role := 'parent'; v_family := fam.id;
    v_label := 'Family (' || fam.name || ' family)';
  else
    select * into t from public.tutors where id = p_tutor_id;
    if t.id is null then raise exception 'That tutor could not be found.'; end if;
    if t.deleted_at is not null then raise exception 'This tutor''s account has already been closed.'; end if;
    v_kind := 'tutor'; v_role := 'tutor'; v_tutor := t.id;
    v_label := 'Tutor (' || t.full_name || ')';
  end if;

  select id into v_id from public.deletion_requests
   where status in ('pending', 'processing', 'failed') and target_kind = v_kind
     and (profile_id = p_profile_id or family_id = p_family_id or tutor_id = p_tutor_id)
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.deletion_requests (target_kind, profile_id, family_id, tutor_id, role, label, reason, requested_by)
  values (v_kind, p_profile_id, v_family, v_tutor, v_role, v_label, nullif(trim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.admin_record_deletion_request(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.admin_record_deletion_request(uuid, uuid, uuid, text) to authenticated;

/** The office withdraws a request that has not been carried out. */
create function public.admin_cancel_deletion_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can cancel a deletion request.' using errcode = '42501';
  end if;
  update public.deletion_requests set status = 'cancelled' where id = p_id and status in ('pending', 'failed');
  if not found then raise exception 'Only a waiting or failed request can be cancelled.'; end if;
end $$;
revoke all on function public.admin_cancel_deletion_request(uuid) from public, anon;
grant execute on function public.admin_cancel_deletion_request(uuid) to authenticated;

/** A person asks to close their own account (delete-account Edge Function). Service role only. */
create function public.begin_account_deletion(p_profile_id uuid, p_requested_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.profiles; fam public.families; v_id uuid;
begin
  select * into p from public.profiles where id = p_profile_id;
  if p.id is null then raise exception 'That account could not be found.'; end if;
  perform public.assert_not_last_admin(p.id);
  select id into v_id from public.deletion_requests
   where profile_id = p_profile_id and status in ('pending', 'processing', 'failed') limit 1;
  if v_id is not null then return v_id; end if;
  select * into fam from public.families where id = p.family_id;
  insert into public.deletion_requests (target_kind, profile_id, family_id, tutor_id, role, label, requested_by)
  values ('profile', p.id, p.family_id, p.tutor_id, p.role,
          case p.role
            when 'parent' then 'Parent account (' || coalesce(fam.name, p.full_name) || ' family)'
            when 'student' then 'Student login (' || p.full_name || ')'
            when 'tutor' then 'Tutor (' || p.full_name || ')'
            else 'Administrator (' || p.full_name || ')' end,
          p_requested_by)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.begin_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid, uuid) to service_role;

/**
 * Carries out a deletion request: anonymises the records, tells the remaining administrators (without any names or
 * contact details) and marks the request completed. Returns the summary, including storagePaths/storageFolders to
 * remove and linkedProfileIds (other logins of the same family or tutor) whose auth users the Edge Function deletes
 * together with profileId. Service role only.
 */
create function public.perform_account_deletion(p_request_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.deletion_requests;
  p public.profiles;
  v_role text;
  v_family uuid;
  v_tutor uuid;
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
  v_family := case when r.target_kind = 'family' or v_role = 'parent' then coalesce(p.family_id, r.family_id) end;
  v_tutor := case when r.target_kind = 'tutor' or v_role in ('tutor', 'admin') then coalesce(p.tutor_id, r.tutor_id) end;
  if p.id is not null then perform public.assert_not_last_admin(p.id); end if;

  v_summary := jsonb_build_object(
    'role', v_role, 'familyAnonymised', false, 'studentsAnonymised', 0, 'futureLessonsCancelled', 0,
    'upcomingLessonsNeedingTutor', 0, 'invoicesRetained', 0, 'paymentsRetained', 0, 'storagePaths', '[]'::jsonb,
    'storageFolders', '[]'::jsonb, 'profileId', p.id, 'linkedProfileIds', '[]'::jsonb);

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
    when (v_summary->>'familyAnonymised')::boolean then
      E'\n\nWhat was kept, for tax records: ' || public.deletion_count(v_summary, 'invoicesRetained', 'invoice', 'invoices')
      || ' and ' || public.deletion_count(v_summary, 'paymentsRetained', 'payment', 'payments')
      || E'. Personal details, messages, notes and homework have been removed.'
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
    || 'Account type: ' || replace(public.deletion_closed_label(r.target_kind, v_role), ' (closed)', '') || '.' || kept
    || E'\n\nThe request is listed under Deletion requests.';
  for a in select pr.id, pr.email from public.profiles pr
            where pr.role = 'admin' and pr.id is distinct from p.id and pr.id <> all (linked) loop
    insert into public.notification_outbox (profile_id, email, subject, body, push_title, push_body, url, send_email)
    values (a.id, a.email, 'An account has been closed', body, 'Account closed',
            'An account has been closed. Open the app for details.', '/manage/deletion-requests', a.email is not null);
  end loop;

  update public.deletion_requests
     set status = 'completed', completed_at = now(), summary = v_summary,
         label = public.deletion_closed_label(r.target_kind, v_role), processed_by = p_actor
   where id = r.id;
  return v_summary;
end $$;
revoke all on function public.perform_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.perform_account_deletion(uuid, uuid) to service_role;

/** Records why a deletion could not be finished, so the office can try again. Service role only. */
create function public.fail_account_deletion(p_request_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.deletion_requests
     set status = 'failed', error = left(public.scrub_error_text(coalesce(p_error, 'Unknown error')), 500)
   where id = p_request_id and status <> 'cancelled'
$$;
revoke all on function public.fail_account_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_account_deletion(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Backups bucket: private, written and read by the service role only (no policies for anon or authenticated).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
    on conflict (id) do nothing;
  end if;
end $$;

select public.record_migration('20261020000000', 'launch');
