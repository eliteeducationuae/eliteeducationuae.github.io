-- Elite Education — admissions advisory: guiding a student into a school, a boarding school or a UK or US university.
--
-- A case belongs to one student and is led by an adviser (a tutor) or, when no adviser is set, by the office.
-- Each case holds a shortlist of schools or universities (targets), key dates and deadlines, tasks for the family or
-- the adviser, documents, advisory updates (written as drafts, reviewed by the office, then published to the family)
-- and a timeline the family can follow.
--
-- Who sees what (admissions_access):
--   admin   — every case;
--   adviser — the tutor named as the case's adviser, for that case only. Teaching the student is not enough;
--   family  — the student's parents and the student's own login.
-- Targets, key dates and tasks are written directly by admins and the adviser; everything else goes through the
-- functions below. Documents live in the private `admissions` bucket under cases/<case id>/….
-- Reminders for key dates and tasks are queued hourly by send-reminders (queue_admissions_reminders).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.admissions_cases (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  -- Always copied from the student by admissions_cases_before_write, never taken from the caller.
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('school-entry', 'boarding', 'uk-university', 'us-university', 'other')),
  title text not null check (length(trim(title)) between 1 and 200),
  entry_year text check (length(entry_year) <= 40),
  status text not null default 'active' check (status in ('active', 'on-hold', 'completed', 'closed')),
  -- Null: led by the office.
  adviser_tutor_id uuid references public.tutors(id) on delete set null,
  -- An overview the family can read.
  summary text check (length(summary) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index admissions_cases_student_idx on public.admissions_cases (student_id);
create index admissions_cases_family_idx on public.admissions_cases (family_id);
create index admissions_cases_adviser_idx on public.admissions_cases (adviser_tutor_id);

create table public.admissions_targets (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admissions_cases(id) on delete cascade,
  institution text not null check (length(trim(institution)) between 1 and 200),
  country text check (length(country) <= 100),
  programme text check (length(programme) <= 200),
  entry_year text check (length(entry_year) <= 40),
  requirements text check (length(requirements) <= 4000),
  status text not null default 'researching'
    check (status in ('researching', 'applying', 'submitted', 'interview', 'offer', 'rejected', 'accepted', 'declined')),
  decision_date date,
  notes text check (length(notes) <= 4000),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index admissions_targets_case_idx on public.admissions_targets (case_id, sort);

-- Key dates and deadlines. time_of_day is UAE time (HH:MM).
create table public.admissions_dates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admissions_cases(id) on delete cascade,
  target_id uuid references public.admissions_targets(id) on delete cascade,
  kind text not null check (kind in ('deadline', 'test', 'interview', 'open-day', 'decision', 'other')),
  title text not null check (length(trim(title)) between 1 and 200),
  due_on date not null,
  time_of_day text check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  done boolean not null default false,
  -- A preparation course (an enrolment of the case's student) or session (a lesson including the student).
  enrolment_id uuid references public.enrolments(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  notes text check (length(notes) <= 2000),
  -- Reminder thresholds (days before) already covered; written only by queue_admissions_reminders.
  reminders_sent int[] not null default '{}',
  created_at timestamptz not null default now()
);
create index admissions_dates_case_idx on public.admissions_dates (case_id, due_on);
create index admissions_dates_open_idx on public.admissions_dates (due_on) where not done;

create table public.admissions_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admissions_cases(id) on delete cascade,
  target_id uuid references public.admissions_targets(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  details text check (length(details) <= 4000),
  due_on date,
  owner text not null check (owner in ('family', 'adviser')),
  done_at timestamptz,
  done_by_name text,
  reminders_sent int[] not null default '{}',
  created_at timestamptz not null default now()
);
create index admissions_tasks_case_idx on public.admissions_tasks (case_id);
create index admissions_tasks_open_idx on public.admissions_tasks (due_on) where done_at is null;

create table public.admissions_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admissions_cases(id) on delete cascade,
  target_id uuid references public.admissions_targets(id) on delete set null,
  category text not null
    check (category in ('transcript', 'reference', 'personal-statement', 'test-score', 'portfolio', 'identity', 'other')),
  name text not null check (length(trim(name)) between 1 and 200),
  path text not null check (path like 'cases/' || case_id::text || '/_%' and position('..' in path) = 0 and length(path) <= 500),
  mime_type text check (length(mime_type) <= 200),
  family_visible boolean not null default true,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index admissions_documents_case_idx on public.admissions_documents (case_id);
create index admissions_documents_path_idx on public.admissions_documents (path);

-- Advisory updates: draft → submitted (by the adviser) → approved → published (by the office).
create table public.admissions_updates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admissions_cases(id) on delete cascade,
  kind text not null check (kind in ('monthly', 'ad-hoc')),
  title text not null check (length(trim(title)) between 1 and 200),
  period text check (length(period) <= 60),
  body text not null default '' check (length(body) <= 12000),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'published')),
  ai_assisted boolean not null default false,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz
);
create index admissions_updates_case_idx on public.admissions_updates (case_id, created_at);

-- The family's timeline. Written only by the triggers and functions in this file.
create table public.admissions_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admissions_cases(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('case', 'target', 'date', 'task', 'document', 'update', 'milestone')),
  title text not null,
  detail text,
  family_visible boolean not null default true
);
create index admissions_events_case_idx on public.admissions_events (case_id, at);

-- ---------------------------------------------------------------------------
-- Who may see a case
-- ---------------------------------------------------------------------------

/** 'admin', 'adviser' (the case's own adviser), 'family' (the student's parents or the student) or null. */
create function public.admissions_access(p_case_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.admissions_cases; my_role text;
begin
  if auth.uid() is null or p_case_id is null then return null; end if;
  if public.is_admin() then return 'admin'; end if;
  select * into c from public.admissions_cases where id = p_case_id;
  if c.id is null then return null; end if;
  if c.adviser_tutor_id is not null and c.adviser_tutor_id = public.my_tutor_id() then return 'adviser'; end if;
  select role into my_role from public.profiles where id = auth.uid();
  if my_role in ('parent', 'student') and c.student_id = any (public.visible_student_ids()) then return 'family'; end if;
  return null;
end $$;

/** True for admins and the case's adviser. */
create function public.admissions_can_manage(p_case_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.admissions_access(p_case_id) in ('admin', 'adviser'), false)
$$;

revoke all on function public.admissions_access(uuid), public.admissions_can_manage(uuid) from public, anon;
grant execute on function public.admissions_access(uuid), public.admissions_can_manage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------------

/** Add an entry to a case's timeline. */
create function public.admissions_log(p_case_id uuid, p_kind text, p_title text, p_detail text default null, p_family_visible boolean default true)
returns void language sql security definer set search_path = public as $$
  insert into public.admissions_events (case_id, kind, title, detail, family_visible)
  values (p_case_id, p_kind, left(p_title, 300), left(nullif(trim(p_detail), ''), 2000), coalesce(p_family_visible, true))
$$;

/** Tell whoever leads a case: the adviser (by login, or by email when they have none) or, with no adviser, the office. */
create function public.admissions_notify_staff(p_case_id uuid, p_subject text, p_body text, p_push_title text, p_push_body text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.admissions_cases;
begin
  select * into c from public.admissions_cases where id = p_case_id;
  if c.adviser_tutor_id is null then
    perform public.notify_admins(p_subject, p_body, p_push_title, p_push_body, p_url);
  elsif exists (select 1 from public.profiles where tutor_id = c.adviser_tutor_id and role in ('tutor', 'admin')) then
    perform public.notify_tutor(c.adviser_tutor_id, p_subject, p_body, p_push_title, p_push_body, p_url);
  else
    perform public.notify(null, (select email from public.tutors where id = c.adviser_tutor_id), p_subject, p_body, null, null, p_url);
  end if;
end $$;

/** The first name of a case's student. */
create function public.admissions_first_name(p_case_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select split_part(st.full_name, ' ', 1) from public.admissions_cases c join public.students st on st.id = c.student_id
  where c.id = p_case_id
$$;

revoke all on function public.admissions_log(uuid, text, text, text, boolean),
  public.admissions_notify_staff(uuid, text, text, text, text, text), public.admissions_first_name(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: integrity
-- ---------------------------------------------------------------------------

/** A case's family is always the student's family; created_at never changes; updated_at is kept current. */
create function public.admissions_cases_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.student_id is distinct from old.student_id then
    select family_id into new.family_id from public.students where id = new.student_id;
    if new.family_id is null then raise exception 'Please choose a student.'; end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger admissions_cases_before_write before insert or update on public.admissions_cases
  for each row execute function public.admissions_cases_before_write();

create function public.admissions_targets_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger admissions_targets_before_write before insert or update on public.admissions_targets
  for each row execute function public.admissions_targets_before_write();

/** Links on key dates, tasks and documents must stay within the case (and its student). */
create function public.admissions_check_links() returns trigger
language plpgsql security definer set search_path = public as $$
declare student uuid;
begin
  if new.target_id is not null
     and not exists (select 1 from public.admissions_targets where id = new.target_id and case_id = new.case_id) then
    raise exception 'Please choose a school or university from this case''s shortlist.';
  end if;
  if tg_table_name = 'admissions_dates' then
    select student_id into student from public.admissions_cases where id = new.case_id;
    if new.enrolment_id is not null
       and not exists (select 1 from public.enrolments where id = new.enrolment_id and student_id = student) then
      raise exception 'Please choose a course that this student is enrolled on.';
    end if;
    if new.lesson_id is not null
       and not exists (select 1 from public.lessons where id = new.lesson_id and student = any (student_ids)) then
      raise exception 'Please choose a lesson that includes this student.';
    end if;
    if new.lesson_id is not null and new.enrolment_id is not null and exists (
         select 1 from public.lessons l, public.enrolments e
         where l.id = new.lesson_id and e.id = new.enrolment_id and l.subject is not null
           and lower(trim(l.subject)) <> lower(trim(e.subject))) then
      raise exception 'Please choose a lesson in the selected subject.';
    end if;
  end if;
  return new;
end $$;
create trigger admissions_dates_check_links before insert or update on public.admissions_dates
  for each row execute function public.admissions_check_links();
create trigger admissions_tasks_check_links before insert or update on public.admissions_tasks
  for each row execute function public.admissions_check_links();
create trigger admissions_documents_check_links before insert or update on public.admissions_documents
  for each row execute function public.admissions_check_links();

/**
 * Reminder bookkeeping belongs to queue_admissions_reminders. Deliberately not security definer, so current_user is
 * the caller: rows written straight from the app (role authenticated) keep their reminders_sent. A date that moves
 * starts afresh, so a rescheduled interview or deadline is reminded again from the next threshold.
 */
create function public.admissions_keep_reminders() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.reminders_sent := case when tg_op = 'UPDATE' then old.reminders_sent else '{}' end;
  end if;
  if tg_op = 'UPDATE' and new.due_on is distinct from old.due_on and new.reminders_sent = old.reminders_sent then
    new.reminders_sent := '{}';
  end if;
  return new;
end $$;
create trigger admissions_dates_keep_reminders before insert or update on public.admissions_dates
  for each row execute function public.admissions_keep_reminders();
create trigger admissions_tasks_keep_reminders before insert or update on public.admissions_tasks
  for each row execute function public.admissions_keep_reminders();

-- ---------------------------------------------------------------------------
-- Triggers: the family's timeline and notices
-- ---------------------------------------------------------------------------

create function public.on_admissions_target_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text := trim(new.institution);
begin
  if tg_op = 'INSERT' then
    perform public.admissions_log(new.case_id, 'target', t || ' added to the shortlist');
  elsif new.status is distinct from old.status and new.status <> 'researching' then
    perform public.admissions_log(new.case_id, 'target', case new.status
      when 'applying' then 'Application under way for ' || t
      when 'submitted' then 'Application submitted to ' || t
      when 'interview' then 'Interview invitation from ' || t
      when 'offer' then 'Offer received from ' || t
      when 'rejected' then t || ' did not offer a place'
      when 'accepted' then 'Place accepted at ' || t
      when 'declined' then 'Offer from ' || t || ' declined'
    end);
  end if;
  return null;
end $$;
create trigger admissions_targets_timeline after insert or update of status on public.admissions_targets
  for each row execute function public.on_admissions_target_change();

create function public.on_admissions_date_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done then
    perform public.admissions_log(new.case_id, 'date', 'Completed: ' || trim(new.title));
  end if;
  return null;
end $$;
create trigger admissions_dates_timeline after update of done on public.admissions_dates
  for each row execute function public.on_admissions_date_done();

-- A new task for the family: they hear about it straight away.
create function public.on_admissions_task_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.admissions_cases;
begin
  if new.owner <> 'family' or new.done_at is not null then return null; end if;
  select * into c from public.admissions_cases where id = new.case_id;
  perform public.notify_family(c.family_id, 'A new task from your admissions adviser',
    trim(new.title)
      || coalesce(E'\n\nPlease complete this by ' || to_char(new.due_on, 'FMDay FMDD FMMonth YYYY') || '.', '')
      || coalesce(E'\n\n' || nullif(trim(new.details), ''), '')
      || E'\n\nYou can view the task and mark it as done in the Elite Education app.',
    'New admissions task', public.admissions_first_name(c.id) || ': ' || trim(new.title),
    '/admissions/' || c.id || '?tab=tasks');
  return null;
end $$;
create trigger admissions_tasks_notify after insert on public.admissions_tasks
  for each row execute function public.on_admissions_task_added();

revoke all on function public.admissions_cases_before_write(), public.admissions_targets_before_write(),
  public.admissions_check_links(), public.admissions_keep_reminders(), public.on_admissions_target_change(),
  public.on_admissions_date_done(), public.on_admissions_task_added()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.admissions_cases enable row level security;
alter table public.admissions_targets enable row level security;
alter table public.admissions_dates enable row level security;
alter table public.admissions_tasks enable row level security;
alter table public.admissions_documents enable row level security;
alter table public.admissions_updates enable row level security;
alter table public.admissions_events enable row level security;

create policy "see admissions cases" on public.admissions_cases for select to authenticated
  using (public.admissions_access(id) is not null);
create policy "admin adds admissions cases" on public.admissions_cases for insert to authenticated
  with check (public.is_admin());
create policy "admin edits admissions cases" on public.admissions_cases for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes admissions cases" on public.admissions_cases for delete to authenticated
  using (public.is_admin());

create policy "see admissions targets" on public.admissions_targets for select to authenticated
  using (public.admissions_access(case_id) is not null);
create policy "manage admissions targets" on public.admissions_targets for insert to authenticated
  with check (public.admissions_can_manage(case_id));
create policy "edit admissions targets" on public.admissions_targets for update to authenticated
  using (public.admissions_can_manage(case_id)) with check (public.admissions_can_manage(case_id));
create policy "delete admissions targets" on public.admissions_targets for delete to authenticated
  using (public.admissions_can_manage(case_id));

create policy "see admissions dates" on public.admissions_dates for select to authenticated
  using (public.admissions_access(case_id) is not null);
create policy "manage admissions dates" on public.admissions_dates for insert to authenticated
  with check (public.admissions_can_manage(case_id));
create policy "edit admissions dates" on public.admissions_dates for update to authenticated
  using (public.admissions_can_manage(case_id)) with check (public.admissions_can_manage(case_id));
create policy "delete admissions dates" on public.admissions_dates for delete to authenticated
  using (public.admissions_can_manage(case_id));

-- Families complete their own tasks through set_admissions_task_done().
create policy "see admissions tasks" on public.admissions_tasks for select to authenticated
  using (public.admissions_access(case_id) is not null);
create policy "manage admissions tasks" on public.admissions_tasks for insert to authenticated
  with check (public.admissions_can_manage(case_id));
create policy "edit admissions tasks" on public.admissions_tasks for update to authenticated
  using (public.admissions_can_manage(case_id)) with check (public.admissions_can_manage(case_id));
create policy "delete admissions tasks" on public.admissions_tasks for delete to authenticated
  using (public.admissions_can_manage(case_id));

-- Documents, updates and the timeline are read here and written through the functions below only.
create policy "see admissions documents" on public.admissions_documents for select to authenticated
  using (public.admissions_can_manage(case_id)
         or (public.admissions_access(case_id) = 'family' and (family_visible or uploaded_by = auth.uid())));
create policy "see admissions updates" on public.admissions_updates for select to authenticated
  using (public.admissions_can_manage(case_id) or (public.admissions_access(case_id) = 'family' and status = 'published'));
create policy "see admissions events" on public.admissions_events for select to authenticated
  using (public.admissions_can_manage(case_id) or (public.admissions_access(case_id) = 'family' and family_visible));

grant select, insert, update, delete on public.admissions_cases, public.admissions_targets, public.admissions_dates,
  public.admissions_tasks to authenticated;
grant select on public.admissions_documents, public.admissions_updates, public.admissions_events to authenticated;
revoke insert, update, delete on public.admissions_documents, public.admissions_updates, public.admissions_events from authenticated;
revoke all on public.admissions_cases, public.admissions_targets, public.admissions_dates, public.admissions_tasks,
  public.admissions_documents, public.admissions_updates, public.admissions_events from anon;

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

/**
 * Open (p_id null; admins only) or edit an admissions case. Admins may change everything; the adviser may change the
 * summary and status only (the other parameters are ignored for them). The adviser hears when a case is given to them.
 */
create function public.save_admissions_case(
  p_id uuid, p_student_id uuid, p_kind text, p_title text, p_entry_year text, p_status text, p_adviser_tutor_id uuid, p_summary text
) returns public.admissions_cases language plpgsql security definer set search_path = public as $$
declare c public.admissions_cases; access text; old_adviser uuid; st public.students;
begin
  if p_id is null then
    if not public.is_admin() then
      raise exception 'Only the Elite Education office can open an admissions case.' using errcode = '42501';
    end if;
  else
    access := public.admissions_access(p_id);
    if access is null or access = 'family' then
      raise exception 'Only the office or the case''s adviser can change this case.' using errcode = '42501';
    end if;
    select * into c from public.admissions_cases where id = p_id for update;
    if c.id is null then raise exception 'Admissions case not found'; end if;
    old_adviser := c.adviser_tutor_id;
  end if;

  if coalesce(p_status, 'active') not in ('active', 'on-hold', 'completed', 'closed') then
    raise exception 'Please choose a valid status for the case.';
  end if;
  if length(coalesce(p_summary, '')) > 4000 then raise exception 'Please keep the summary to 4,000 characters or fewer.'; end if;

  if access = 'adviser' then
    update public.admissions_cases
       set summary = nullif(trim(p_summary), ''), status = coalesce(p_status, c.status)
     where id = c.id
    returning * into c;
    return c;
  end if;

  -- Admins: everything.
  select * into st from public.students where id = p_student_id;
  if st.id is null then raise exception 'Please choose a student.'; end if;
  if p_kind is null or p_kind not in ('school-entry', 'boarding', 'uk-university', 'us-university', 'other') then
    raise exception 'Please choose the kind of admissions support.';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Please give the case a title.'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Please keep the title to 200 characters or fewer.'; end if;
  if length(trim(coalesce(p_entry_year, ''))) > 40 then raise exception 'Please keep the year of entry to 40 characters or fewer.'; end if;
  if p_adviser_tutor_id is not null and not exists (select 1 from public.tutors where id = p_adviser_tutor_id) then
    raise exception 'Please choose an adviser from the tutor list.';
  end if;

  if p_id is null then
    insert into public.admissions_cases (student_id, family_id, kind, title, entry_year, status, adviser_tutor_id, summary)
    values (st.id, st.family_id, p_kind, trim(p_title), nullif(trim(p_entry_year), ''), coalesce(p_status, 'active'),
            p_adviser_tutor_id, nullif(trim(p_summary), ''))
    returning * into c;
    perform public.admissions_log(c.id, 'case', 'Admissions advisory opened: ' || c.title);
  else
    update public.admissions_cases
       set student_id = st.id, kind = p_kind, title = trim(p_title), entry_year = nullif(trim(p_entry_year), ''),
           status = coalesce(p_status, c.status), adviser_tutor_id = p_adviser_tutor_id, summary = nullif(trim(p_summary), '')
     where id = c.id
    returning * into c;
  end if;

  if c.adviser_tutor_id is not null and c.adviser_tutor_id is distinct from old_adviser then
    perform public.notify_tutor(c.adviser_tutor_id, 'You are now advising ' || split_part(st.full_name, ' ', 1),
      'You have been asked to lead the admissions advisory for ' || st.full_name || ': ' || c.title || '.'
        || E'\n\nYou can view the shortlist, key dates and tasks in the Elite Education app.',
      'New admissions case', split_part(st.full_name, ' ', 1) || ': ' || c.title, '/admissions/' || c.id);
  end if;
  return c;
end $$;

/** Mark a task done or not done. The family may complete only their own tasks; the adviser hears when they do. */
create function public.set_admissions_task_done(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t public.admissions_tasks; access text; me public.profiles;
begin
  select * into t from public.admissions_tasks where id = p_id for update;
  access := public.admissions_access(t.case_id);
  if t.id is null or access is null then raise exception 'Task not found'; end if;
  if access = 'family' and t.owner <> 'family' then
    raise exception 'Only the adviser can complete this task.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if coalesce(p_done, false) then
    if t.done_at is not null then return; end if;
    update public.admissions_tasks set done_at = now(), done_by_name = me.full_name where id = t.id;
    perform public.admissions_log(t.case_id, 'task', 'Completed: ' || trim(t.title));
    if access = 'family' then
      perform public.admissions_notify_staff(t.case_id,
        public.admissions_first_name(t.case_id) || '''s family has completed a task: ' || trim(t.title),
        coalesce(me.full_name, 'The family') || ' has marked "' || trim(t.title) || '" as done.'
          || E'\n\nYou can view the case in the Elite Education app.',
        'Admissions task completed', public.admissions_first_name(t.case_id) || ': ' || trim(t.title),
        '/admissions/' || t.case_id || '?tab=tasks');
    end if;
  else
    update public.admissions_tasks set done_at = null, done_by_name = null where id = t.id;
  end if;
end $$;

/** True when the caller uploaded the stored file p_name to the admissions bucket (dynamic SQL: storage may be absent). */
create function public.admissions_owns_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare found boolean;
begin
  if to_regclass('storage.objects') is null then return false; end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = ''admissions'' and name = $1 and owner_id = $2)'
    into found using p_name, auth.uid()::text;
  return coalesce(found, false);
end $$;
revoke all on function public.admissions_owns_object(text) from public, anon, authenticated;

/**
 * Record a file already uploaded to the admissions bucket at cases/<case id>/…. Anyone with access to the case may add
 * one; files the family adds are always visible to the family. Nobody is sent the file itself.
 */
create function public.add_admissions_document(
  p_case_id uuid, p_target_id uuid, p_category text, p_name text, p_path text, p_mime_type text, p_family_visible boolean
) returns public.admissions_documents language plpgsql security definer set search_path = public as $$
declare d public.admissions_documents; access text := public.admissions_access(p_case_id); me public.profiles;
  visible boolean; first_name text;
begin
  if access is null or not exists (select 1 from public.admissions_cases where id = p_case_id) then
    raise exception 'You can only add documents to an admissions case you are part of.' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('transcript', 'reference', 'personal-statement', 'test-score', 'portfolio', 'identity', 'other') then
    raise exception 'Please choose what kind of document this is.';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Please give the document a name.'; end if;
  if length(trim(p_name)) > 200 then raise exception 'Please keep the document name to 200 characters or fewer.'; end if;
  if p_path is null or left(p_path, length('cases/' || p_case_id::text || '/')) <> 'cases/' || p_case_id::text || '/'
     or length(p_path) <= length('cases/' || p_case_id::text || '/') or position('..' in p_path) > 0 or length(p_path) > 500 then
    raise exception 'The file could not be accepted. Please try uploading it again.';
  end if;
  if length(coalesce(p_mime_type, '')) > 200 then raise exception 'The file type could not be recognised.'; end if;
  -- One document per stored file, so a document's visibility can never be widened by listing its file again.
  if exists (select 1 from public.admissions_documents where path = p_path) then
    raise exception 'The file could not be accepted. Please try uploading it again.';
  end if;
  -- The family may only list a file they uploaded themselves.
  if access = 'family' and to_regclass('storage.objects') is not null then
    if not public.admissions_owns_object(p_path) then
      raise exception 'The file could not be accepted. Please try uploading it again.';
    end if;
  end if;

  visible := case when access = 'family' then true else coalesce(p_family_visible, true) end;
  select * into me from public.profiles where id = auth.uid();
  insert into public.admissions_documents (case_id, target_id, category, name, path, mime_type, family_visible, uploaded_by, uploaded_by_name)
  values (p_case_id, p_target_id, p_category, trim(p_name), p_path, nullif(trim(p_mime_type), ''), visible, auth.uid(), me.full_name)
  returning * into d;
  perform public.admissions_log(p_case_id, 'document', 'Document added: ' || d.name, null, visible);

  first_name := public.admissions_first_name(p_case_id);
  if access = 'family' then
    perform public.admissions_notify_staff(p_case_id, 'New admissions document for ' || first_name || ': ' || d.name,
      coalesce(me.full_name, 'The family') || ' has added "' || d.name || '" to ' || first_name || '''s admissions file.'
        || E'\n\nYou can view it in the Elite Education app.',
      'New admissions document', first_name || ': ' || d.name, '/admissions/' || p_case_id || '?tab=documents');
  elsif visible then
    perform public.notify_family((select family_id from public.admissions_cases where id = p_case_id),
      'A new document has been shared for ' || first_name,
      '"' || d.name || '" has been added to ' || first_name || '''s admissions file.'
        || E'\n\nYou can view it securely in the Elite Education app.',
      'New admissions document', first_name || ': ' || d.name, '/admissions/' || p_case_id || '?tab=documents');
  end if;
  return d;
end $$;

/**
 * Delete a document (the office, the adviser or whoever added it). Returns the stored file's path when the caller should
 * remove it from storage, or null when another document still refers to the same file.
 */
create function public.delete_admissions_document(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d public.admissions_documents; access text;
begin
  select * into d from public.admissions_documents where id = p_id;
  access := public.admissions_access(d.case_id);
  if d.id is null or access is null or (access = 'family' and not d.family_visible and d.uploaded_by is distinct from auth.uid()) then
    raise exception 'Document not found';
  end if;
  if not (access in ('admin', 'adviser') or d.uploaded_by = auth.uid()) then
    raise exception 'Only the person who added this document, or the adviser, can delete it.' using errcode = '42501';
  end if;
  delete from public.admissions_documents where id = d.id;
  if exists (select 1 from public.admissions_documents where path = d.path) then return null; end if;
  return d.path;
end $$;

/** Write (p_id null) or edit an advisory update. The adviser edits drafts and submitted updates; the office, any not yet published. */
create function public.save_advisory_update(
  p_id uuid, p_case_id uuid, p_kind text, p_title text, p_period text, p_body text, p_ai_assisted boolean
) returns public.admissions_updates language plpgsql security definer set search_path = public as $$
declare u public.admissions_updates; access text; me public.profiles;
begin
  if p_id is not null then
    select * into u from public.admissions_updates where id = p_id for update;
    if u.id is null or not public.admissions_can_manage(u.case_id) then
      raise exception 'Only the adviser or the office can write advisory updates.' using errcode = '42501';
    end if;
    access := public.admissions_access(u.case_id);
  else
    access := public.admissions_access(p_case_id);
    if access is null or access = 'family' or not exists (select 1 from public.admissions_cases where id = p_case_id) then
      raise exception 'Only the adviser or the office can write advisory updates.' using errcode = '42501';
    end if;
  end if;
  if p_kind is null or p_kind not in ('monthly', 'ad-hoc') then raise exception 'Please choose a monthly or an ad hoc update.'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Please give the update a title.'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Please keep the title to 200 characters or fewer.'; end if;
  if length(trim(coalesce(p_period, ''))) > 60 then raise exception 'Please keep the period to 60 characters or fewer.'; end if;
  if length(coalesce(p_body, '')) > 12000 then raise exception 'Please keep the update to 12,000 characters or fewer.'; end if;

  if p_id is null then
    select * into me from public.profiles where id = auth.uid();
    insert into public.admissions_updates (case_id, kind, title, period, body, ai_assisted, author_id, author_name)
    values (p_case_id, p_kind, trim(p_title), nullif(trim(p_period), ''), coalesce(trim(p_body), ''),
            coalesce(p_ai_assisted, false), auth.uid(), me.full_name)
    returning * into u;
    return u;
  end if;

  if u.status = 'published' then raise exception 'A published update cannot be changed.'; end if;
  if access = 'adviser' and u.status not in ('draft', 'submitted') then
    raise exception 'This update has been approved. Please ask the office to make any further changes.' using errcode = '42501';
  end if;
  update public.admissions_updates
     set kind = p_kind, title = trim(p_title), period = nullif(trim(p_period), ''), body = coalesce(trim(p_body), ''),
         ai_assisted = u.ai_assisted or coalesce(p_ai_assisted, false)
   where id = u.id
  returning * into u;
  return u;
end $$;

/**
 * Move an advisory update through draft → submitted → approved → published. The adviser may submit a draft or take it
 * back; the office may do anything except un-publish. Publishing adds it to the timeline and tells the family.
 */
create function public.set_advisory_update_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare u public.admissions_updates; access text; c public.admissions_cases; first_name text;
begin
  if p_status is null or p_status not in ('draft', 'submitted', 'approved', 'published') then
    raise exception 'Please choose a valid status for the update.';
  end if;
  select * into u from public.admissions_updates where id = p_id for update;
  access := public.admissions_access(u.case_id);
  if u.id is null or access is null or access = 'family' then
    raise exception 'Only the adviser or the office can change an advisory update.' using errcode = '42501';
  end if;
  if u.status = 'published' then
    if p_status = 'published' then return; end if;
    raise exception 'A published update cannot be withdrawn.';
  end if;
  if p_status = u.status then return; end if;
  if access = 'adviser' and not ((u.status = 'draft' and p_status = 'submitted') or (u.status = 'submitted' and p_status = 'draft')) then
    raise exception 'Only the office can approve or publish advisory updates.' using errcode = '42501';
  end if;
  if p_status = 'published' and length(trim(u.body)) = 0 then
    raise exception 'Please write the update before publishing it.';
  end if;

  update public.admissions_updates
     set status = p_status,
         submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         published_at = case when p_status = 'published' then now() else published_at end
   where id = u.id;

  select * into c from public.admissions_cases where id = u.case_id;
  first_name := public.admissions_first_name(c.id);
  if p_status = 'submitted' and access = 'adviser' then
    perform public.notify_admins('Advisory update ready for review: ' || first_name,
      '"' || u.title || '" for ' || first_name || ' has been submitted for review.'
        || E'\n\nYou can review, approve and publish it in the Elite Education app.',
      'Advisory update to review', first_name || ': ' || u.title, '/admissions/update?id=' || u.id);
  elsif p_status = 'published' then
    perform public.admissions_log(c.id, 'update', 'Advisory update: ' || u.title);
    perform public.notify_family(c.family_id, 'A new advisory update for ' || first_name,
      u.title || ' is ready to read in the Elite Education app.',
      'New advisory update', first_name || ': ' || u.title, '/admissions/' || c.id || '?tab=updates');
  end if;
end $$;

/** Delete an advisory update that has not been published. */
create function public.delete_advisory_update(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u public.admissions_updates;
begin
  select * into u from public.admissions_updates where id = p_id for update;
  if u.id is null or not public.admissions_can_manage(u.case_id) then
    raise exception 'Only the adviser or the office can delete an advisory update.' using errcode = '42501';
  end if;
  if u.status = 'published' then raise exception 'A published update cannot be deleted.'; end if;
  delete from public.admissions_updates where id = u.id;
end $$;

/** Add a milestone to the family's timeline. */
create function public.add_admissions_milestone(p_case_id uuid, p_title text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admissions_can_manage(p_case_id) or not exists (select 1 from public.admissions_cases where id = p_case_id) then
    raise exception 'Only the adviser or the office can add a milestone.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Please give the milestone a title.'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Please keep the title to 200 characters or fewer.'; end if;
  if length(coalesce(p_detail, '')) > 2000 then raise exception 'Please keep the detail to 2,000 characters or fewer.'; end if;
  perform public.admissions_log(p_case_id, 'milestone', trim(p_title), p_detail, true);
end $$;

/** Invoice the family for admissions advisory (admins only). The usual invoice notices and autopay follow. */
create function public.bill_admissions_fee(p_case_id uuid, p_description text, p_quantity numeric, p_unit_price numeric)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare c public.admissions_cases; s public.settings; inv public.invoices;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into c from public.admissions_cases where id = p_case_id;
  if c.id is null then raise exception 'Admissions case not found'; end if;
  if length(trim(coalesce(p_description, ''))) = 0 then raise exception 'Please describe the fee.'; end if;
  if length(trim(p_description)) > 200 then raise exception 'Please keep the description to 200 characters or fewer.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Please enter a quantity greater than zero.'; end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'Please enter a price of zero or more.'; end if;
  select * into s from public.settings where id = 1;
  insert into public.invoices (number, family_id, issue_date, due_date, status, items, vat_rate)
  values (public.next_invoice_number(), c.family_id, current_date, current_date + s.invoice_due_days, 'sent',
          jsonb_build_array(jsonb_build_object('description', trim(p_description), 'quantity', p_quantity,
                                               'unitPrice', p_unit_price, 'admissionsCaseId', c.id)),
          s.vat_rate)
  returning * into inv;
  return inv;
end $$;

revoke all on function public.save_admissions_case(uuid, uuid, text, text, text, text, uuid, text),
  public.set_admissions_task_done(uuid, boolean),
  public.add_admissions_document(uuid, uuid, text, text, text, text, boolean),
  public.delete_admissions_document(uuid),
  public.save_advisory_update(uuid, uuid, text, text, text, text, boolean),
  public.set_advisory_update_status(uuid, text), public.delete_advisory_update(uuid),
  public.add_admissions_milestone(uuid, text, text), public.bill_admissions_fee(uuid, text, numeric, numeric)
  from public, anon;
grant execute on function public.save_admissions_case(uuid, uuid, text, text, text, text, uuid, text),
  public.set_admissions_task_done(uuid, boolean),
  public.add_admissions_document(uuid, uuid, text, text, text, text, boolean),
  public.delete_admissions_document(uuid),
  public.save_advisory_update(uuid, uuid, text, text, text, text, boolean),
  public.set_advisory_update_status(uuid, text), public.delete_advisory_update(uuid),
  public.add_admissions_milestone(uuid, text, text), public.bill_admissions_fee(uuid, text, numeric, numeric)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reminders (send-reminders, hourly, service role only)
-- ---------------------------------------------------------------------------

/**
 * Queue push and email reminders for key dates (14, 7, 1 and 0 days before) and open tasks (3 and 0 days before) on
 * active cases, to the family and to the adviser (or the office). Each threshold is sent once: a reminder covers every
 * threshold at or above the days left, so a date added five days out gets a single reminder, never two at once.
 * Reminders go out between 08:00 and 20:59 UAE time only. Returns the number of dates and tasks reminded.
 */
create function public.queue_admissions_reminders(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := (p_now at time zone 'Asia/Dubai')::date;
  local_hour int := extract(hour from p_now at time zone 'Asia/Dubai')::int;
  n int := 0; r record; days int; due int; subject text; body text; first_name text; label text; url text; when_text text;
begin
  if local_hour not between 8 and 20 then return 0; end if;

  -- Key dates
  for r in
    select d.*, c.family_id, st.full_name as student_name, tg.institution
    from public.admissions_dates d
    join public.admissions_cases c on c.id = d.case_id
    join public.students st on st.id = c.student_id
    left join public.admissions_targets tg on tg.id = d.target_id
    where not d.done and c.status = 'active' and d.due_on between today and today + 14
    order by d.due_on, d.id
    for update of d
  loop
    days := r.due_on - today;
    select min(x) into due from unnest(array[14, 7, 1, 0]) x where x >= days;
    if due is null or due = any (r.reminders_sent) then continue; end if;
    update public.admissions_dates
       set reminders_sent = array(select distinct x from unnest(r.reminders_sent || array[14, 7, 1, 0]) x
                                  where x = any (r.reminders_sent) or x >= days order by x desc)
     where id = r.id;

    first_name := split_part(r.student_name, ' ', 1);
    label := case r.kind when 'deadline' then 'Deadline' when 'test' then 'Test' when 'interview' then 'Interview'
      when 'open-day' then 'Open day' when 'decision' then 'Decision' else 'Key date' end;
    subject := case days when 0 then 'Today: ' when 1 then 'Tomorrow: ' else label || ' in ' || days || ' days: ' end || trim(r.title);
    when_text := to_char(r.due_on, 'FMDay FMDD FMMonth YYYY') || coalesce(' at ' || r.time_of_day || ' (UAE time)', '');
    body := '"' || trim(r.title) || '"' || coalesce(' (' || r.institution || ')', '') || ' for ' || first_name
      || ' is on ' || when_text || '.' || E'\n\nYou can see every key date in the Elite Education app.';
    url := '/admissions/' || r.case_id;
    perform public.notify_family(r.family_id, subject, body, subject, first_name || coalesce(' — ' || r.institution, ''), url);
    perform public.admissions_notify_staff(r.case_id, first_name || ': ' || subject, body, subject,
      first_name || coalesce(' — ' || r.institution, ''), url);
    n := n + 1;
  end loop;

  -- Open tasks with a due date
  for r in
    select t.*, c.family_id, st.full_name as student_name
    from public.admissions_tasks t
    join public.admissions_cases c on c.id = t.case_id
    join public.students st on st.id = c.student_id
    where t.done_at is null and t.due_on is not null and c.status = 'active' and t.due_on between today and today + 3
    order by t.due_on, t.id
    for update of t
  loop
    days := r.due_on - today;
    select min(x) into due from unnest(array[3, 0]) x where x >= days;
    if due is null or due = any (r.reminders_sent) then continue; end if;
    update public.admissions_tasks
       set reminders_sent = array(select distinct x from unnest(r.reminders_sent || array[3, 0]) x
                                  where x = any (r.reminders_sent) or x >= days order by x desc)
     where id = r.id;

    first_name := split_part(r.student_name, ' ', 1);
    subject := case days when 0 then 'Task due today: ' when 1 then 'Task due tomorrow: ' else 'Task due in ' || days || ' days: ' end
      || trim(r.title);
    body := '"' || trim(r.title) || '" on ' || first_name || '''s admissions plan is due on '
      || to_char(r.due_on, 'FMDay FMDD FMMonth YYYY') || '.' || E'\n\nYou can view the task and mark it as done in the Elite Education app.';
    url := '/admissions/' || r.case_id || '?tab=tasks';
    if r.owner = 'family' then
      perform public.notify_family(r.family_id, subject, body, subject, first_name || ': ' || trim(r.title), url);
    else
      perform public.admissions_notify_staff(r.case_id, first_name || ': ' || subject, body, subject,
        first_name || ': ' || trim(r.title), url);
    end if;
    n := n + 1;
  end loop;

  return n;
end $$;
revoke all on function public.queue_admissions_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_admissions_reminders(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Admissions storage: cases/<case id>/…
-- Path segments are compared as text, never cast, so a malformed path is simply refused.
-- ---------------------------------------------------------------------------

/** The case a storage path belongs to, or null for a malformed path. */
create function public.admissions_path_case(p_name text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/'); found uuid;
begin
  if coalesce(array_length(parts, 1), 0) < 3 or parts[1] <> 'cases' or '' = any (parts) or position('..' in p_name) > 0 then
    return null;
  end if;
  select c.id into found from public.admissions_cases c where c.id::text = parts[2];
  return found;
end $$;
revoke all on function public.admissions_path_case(text) from public, anon, authenticated;

create function public.admissions_can_write(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.admissions_access(public.admissions_path_case(p_name)) is not null, false)
$$;

create function public.admissions_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_case uuid := public.admissions_path_case(p_name); access text;
begin
  if v_case is null then return false; end if;
  access := public.admissions_access(v_case);
  if access in ('admin', 'adviser') then return true; end if;
  return coalesce(access = 'family', false) and exists (
    select 1 from public.admissions_documents d
    where d.case_id = v_case and d.path = p_name and (d.family_visible or d.uploaded_by = auth.uid()));
end $$;

/** True when no admissions document refers to the stored file p_name. */
create function public.admissions_can_delete(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_name is not null and length(p_name) > 0
    and not exists (select 1 from public.admissions_documents d where d.path = p_name)
$$;

revoke all on function public.admissions_can_read(text), public.admissions_can_write(text), public.admissions_can_delete(text)
  from public, anon;
grant execute on function public.admissions_can_read(text), public.admissions_can_write(text), public.admissions_can_delete(text)
  to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    -- 25 MB per file; documents and photos only.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('admissions', 'admissions', false, 26214400, array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do nothing;
    execute $p$create policy "admissions read" on storage.objects for select to authenticated
      using (bucket_id = 'admissions' and (public.admissions_can_read(name) or owner_id = auth.uid()::text))$p$;
    execute $p$create policy "admissions upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'admissions' and public.admissions_can_write(name))$p$;
    execute $p$create policy "admissions delete" on storage.objects for delete to authenticated
      using (bucket_id = 'admissions' and (public.is_admin() or owner_id = auth.uid()::text)
             and public.admissions_can_delete(name))$p$;
  end if;
end $$;
