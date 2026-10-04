-- Two-way Google Calendar sync and Google Meet links.
--
-- Tutors and the office may connect a Google Calendar. Their lessons are then written into that
-- calendar (online lessons receive a Google Meet link), and the busy times in a tutor's calendar
-- are copied back as busy_blocks so that families can never request a time the tutor has already
-- committed elsewhere. Only start and end times are copied: never event titles or attendees.
--
-- OAuth tokens live in calendar_connections but are readable only by the service role: the app can
-- see whether a calendar is connected, never the tokens themselves. All writes happen in the
-- google-connect and calendar-sync Edge Functions, which use the service role.

-- ---------------------------------------------------------------------------
-- Connections (one Google Calendar per profile)
-- ---------------------------------------------------------------------------

create table public.calendar_connections (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  google_email text,
  calendar_id text not null default 'primary',
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.calendar_connections enable row level security;
create policy "own or admin calendar status" on public.calendar_connections for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
revoke all on public.calendar_connections from anon, authenticated;
-- Column privileges: the tokens are deliberately left out, so they stay server-only.
grant select (profile_id, provider, google_email, calendar_id, status, last_synced_at, last_error)
  on public.calendar_connections to authenticated;

/** One-time OAuth state values, valid for 15 minutes. Server-only. */
create table public.calendar_oauth_states (
  state uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  return_to text,
  created_at timestamptz not null default now()
);
alter table public.calendar_oauth_states enable row level security;
revoke all on public.calendar_oauth_states from anon, authenticated;

/** The Google event written for each lesson in each connected calendar. No foreign key to lessons,
    so that events for deleted lessons can still be removed from Google. */
create table public.lesson_calendar_events (
  lesson_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  calendar_id text not null,
  etag text,
  synced_at timestamptz not null default now(),
  primary key (lesson_id, profile_id)
);
alter table public.lesson_calendar_events enable row level security;
create policy "admin lesson calendar events" on public.lesson_calendar_events for select to authenticated
  using (public.is_admin());
revoke all on public.lesson_calendar_events from anon;
revoke insert, update, delete on public.lesson_calendar_events from authenticated;
grant select on public.lesson_calendar_events to authenticated;

/** Times when a tutor is busy in Google Calendar. Times only: no titles, no attendees. */
create table public.busy_blocks (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text not null default 'google' check (source in ('google')),
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index busy_blocks_tutor_idx on public.busy_blocks (tutor_id, start_at);
alter table public.busy_blocks enable row level security;
-- Parents and students see nothing here; they only ever see the open slots that remain.
create policy "admin or own busy blocks" on public.busy_blocks for select to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id());
revoke all on public.busy_blocks from anon;
revoke insert, update, delete on public.busy_blocks from authenticated;
grant select on public.busy_blocks to authenticated;

/** Lessons waiting to be written to Google. Filled by a trigger, drained by calendar-sync. Server-only. */
create table public.calendar_sync_queue (
  id bigserial primary key,
  lesson_id uuid not null,
  reason text not null check (reason in ('created', 'changed', 'cancelled', 'deleted', 'backfill')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index calendar_sync_queue_pending_idx on public.calendar_sync_queue (created_at) where processed_at is null;
alter table public.calendar_sync_queue enable row level security;
revoke all on public.calendar_sync_queue from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queueing lesson changes
-- ---------------------------------------------------------------------------

create function public.queue_calendar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.calendar_connections where status = 'connected') then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.calendar_sync_queue (lesson_id, reason) values (new.id, 'created');
  elsif tg_op = 'DELETE' then
    insert into public.calendar_sync_queue (lesson_id, reason) values (old.id, 'deleted');
  elsif (new.start_at, new.end_at, new.status, new.tutor_id, new.student_ids, new.service_id, new.location, new.meeting_url, new.address)
        is distinct from
        (old.start_at, old.end_at, old.status, old.tutor_id, old.student_ids, old.service_id, old.location, old.meeting_url, old.address) then
    insert into public.calendar_sync_queue (lesson_id, reason)
    values (new.id, case when new.status in ('cancelled', 'late-cancel') then 'cancelled' else 'changed' end);
  end if;
  return null;
end $$;
revoke all on function public.queue_calendar_sync() from public, anon, authenticated;

create trigger lessons_queue_calendar_sync
  after insert or update or delete on public.lessons
  for each row execute function public.queue_calendar_sync();

/** Queues the upcoming lessons a newly connected calendar should show. Server-only. */
create function public.queue_calendar_backfill(p_profile uuid) returns int
language plpgsql security definer set search_path = public as $$
declare p public.profiles; n int;
begin
  select * into p from public.profiles where id = p_profile;
  if p is null or p.role not in ('admin', 'tutor') then return 0; end if;
  insert into public.calendar_sync_queue (lesson_id, reason)
  select l.id, 'backfill' from public.lessons l
   where l.status = 'scheduled'
     and l.start_at > now() - interval '1 day' and l.start_at < now() + interval '180 days'
     and (p.role = 'admin' or (p.tutor_id is not null and l.tutor_id = p.tutor_id));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.queue_calendar_backfill(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Open slots now also respect Google busy times
-- ---------------------------------------------------------------------------

/** Free start times for a tutor (local Dubai time), honouring availability, lessons, closures, absences, notice and Google busy times. */
create or replace function public.open_slots(p_tutor_id uuid, p_from date, p_days int, p_duration_min int, p_ignore_lesson uuid default null)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare d date; a record; t timestamptz; s public.settings;
begin
  select * into s from public.settings where id = 1;
  if auth.uid() is null then return; end if;
  for d in select generate_series(p_from, p_from + least(greatest(p_days, 1), 60) - 1, interval '1 day')::date loop
    continue when exists (select 1 from public.closures c where d between c.start_date and c.end_date);
    continue when exists (select 1 from public.tutor_absences x where x.tutor_id = p_tutor_id and d between x.start_date and x.end_date);
    for a in select * from public.availability v where v.tutor_id = p_tutor_id and v.weekday = (extract(isodow from d)::int - 1)
             order by v.start_time loop
      t := (d + a.start_time) at time zone 'Asia/Dubai';
      while t + make_interval(mins => p_duration_min) <= (d + a.end_time) at time zone 'Asia/Dubai' loop
        if t >= now() + make_interval(hours => s.booking_notice_hours)
           and not exists (select 1 from public.lessons l
                           where l.tutor_id = p_tutor_id and l.status in ('scheduled', 'completed', 'no-show')
                             and l.id is distinct from p_ignore_lesson
                             and l.start_at < t + make_interval(mins => p_duration_min) and l.end_at > t)
           and not exists (select 1 from public.busy_blocks b
                           where b.tutor_id = p_tutor_id
                             and b.start_at < t + make_interval(mins => p_duration_min) and b.end_at > t) then
          start_at := t; end_at := t + make_interval(mins => p_duration_min);
          return next;
        end if;
        t := t + interval '30 minutes';
      end loop;
    end loop;
  end loop;
end $$;
grant execute on function public.open_slots(uuid, date, int, int, uuid) to authenticated;
