-- Elite Education — sign-up, enquiries & booking, messaging & notifications, calendar tools.

-- ---------------------------------------------------------------------------
-- Families can start as prospects (self sign-up or enquiry) before they enrol
-- ---------------------------------------------------------------------------

alter table public.families
  add column status text not null default 'active' check (status in ('prospect', 'active', 'archived')),
  add column created_at timestamptz not null default now();

alter table public.settings
  add column notify_email text,
  add column email_lesson_notes boolean not null default true,
  add column email_invoices boolean not null default true,
  add column email_messages boolean not null default true,
  add column booking_notice_hours int not null default 24;

-- ---------------------------------------------------------------------------
-- Calendar: tutor availability, closures (holidays / term breaks), tutor absences
-- ---------------------------------------------------------------------------

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Monday
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index availability_tutor_idx on public.availability (tutor_id);

create table public.closures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  check (end_date >= start_date)
);

create table public.tutor_absences (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- Enquiries pipeline and lesson requests
-- ---------------------------------------------------------------------------

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'contacted', 'trial-booked', 'enrolled', 'lost')),
  source text not null default 'app' check (source in ('app', 'website', 'referral', 'phone', 'other')),
  parent_name text not null check (length(parent_name) between 1 and 200),
  email text check (length(email) <= 200),
  phone text check (length(phone) <= 50),
  student_name text check (length(student_name) <= 200),
  curriculum text,
  syllabus_id text,
  year_group text,
  message text check (length(message) <= 4000),
  preferred_times text check (length(preferred_times) <= 1000),
  family_id uuid references public.families(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  trial_lesson_id uuid references public.lessons(id) on delete set null,
  next_action_at date,
  notes text,
  lost_reason text
);
create index enquiries_status_idx on public.enquiries (status, created_at desc);

create table public.lesson_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('new-lesson', 'reschedule')),
  lesson_id uuid references public.lessons(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id),
  service_id uuid not null references public.services(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  note text check (length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  response text,
  decided_at timestamptz,
  check (end_at > start_at),
  check (kind = 'new-lesson' or lesson_id is not null)
);
create index lesson_requests_status_idx on public.lesson_requests (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Messaging: one conversation per family (parents, admins and the family's tutors)
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_name text not null,
  sender_role text not null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_family_idx on public.messages (family_id, created_at desc);

create table public.message_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (profile_id, family_id)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_name text not null,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 4000),
  audience text not null default 'everyone' check (audience in ('everyone', 'parents', 'tutors'))
);

-- Emails and pushes waiting to be sent by the `send-notifications` Edge Function.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid references public.profiles(id) on delete cascade,
  email text,
  subject text not null,
  body text not null,
  push_title text,
  push_body text,
  url text,
  send_email boolean not null default true,
  sent_at timestamptz,
  attempts int not null default 0,
  error text
);
create index notification_outbox_pending_idx on public.notification_outbox (created_at) where sent_at is null;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

/** Who can take part in a family's conversation: admins, its parents and tutors who teach its children. */
create function public.can_access_thread(p_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin()
    or public.my_family_id() = p_family_id
    or (public.my_tutor_id() is not null and exists (
      select 1 from public.lessons l join public.students s on s.id = any (l.student_ids)
      where l.tutor_id = public.my_tutor_id() and s.family_id = p_family_id)),
    false)
$$;

create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.availability enable row level security;
alter table public.closures enable row level security;
alter table public.tutor_absences enable row level security;
alter table public.enquiries enable row level security;
alter table public.lesson_requests enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.announcements enable row level security;
alter table public.notification_outbox enable row level security;

create policy "read availability" on public.availability for select to authenticated using (true);
create policy "manage availability" on public.availability for all to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id())
  with check (public.is_admin() or tutor_id = public.my_tutor_id());

create policy "read closures" on public.closures for select to authenticated using (true);
create policy "admin closures" on public.closures for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "see absences" on public.tutor_absences for select to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id());
create policy "manage absences" on public.tutor_absences for all to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id())
  with check (public.is_admin() or tutor_id = public.my_tutor_id());

create policy "see enquiries" on public.enquiries for select to authenticated
  using (public.is_admin() or (family_id is not null and family_id = public.my_family_id()));
create policy "admin enquiries" on public.enquiries for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "see requests" on public.lesson_requests for select to authenticated
  using (public.is_admin() or family_id = public.my_family_id() or tutor_id = public.my_tutor_id());

create policy "see messages" on public.messages for select to authenticated using (public.can_access_thread(family_id));
create policy "send messages" on public.messages for insert to authenticated
  with check (public.can_access_thread(family_id) and sender_id = auth.uid()
              and sender_role = public.my_role());

create policy "own reads" on public.message_reads for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid() and public.can_access_thread(family_id));

create policy "see announcements" on public.announcements for select to authenticated
  using (public.is_admin() or audience = 'everyone'
         or (audience = 'parents' and public.my_role() = 'parent')
         or (audience = 'tutors' and public.my_role() = 'tutor'));
create policy "admin announcements" on public.announcements for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin outbox" on public.notification_outbox for select to authenticated using (public.is_admin());

grant select, insert, update, delete on public.availability, public.closures, public.tutor_absences, public.enquiries,
  public.lesson_requests, public.messages, public.message_reads, public.announcements, public.notification_outbox to authenticated;
revoke all on public.availability, public.closures, public.tutor_absences, public.enquiries, public.lesson_requests,
  public.messages, public.message_reads, public.announcements, public.notification_outbox from anon;
grant execute on function public.can_access_thread(uuid), public.my_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create function public.notify(
  p_profile_id uuid, p_email text, p_subject text, p_body text,
  p_push_title text default null, p_push_body text default null, p_url text default null, p_send_email boolean default true
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_profile_id is null and p_email is null then return; end if;
  insert into public.notification_outbox (profile_id, email, subject, body, push_title, push_body, url, send_email)
  values (p_profile_id, p_email, p_subject, p_body, p_push_title, p_push_body, p_url, p_send_email and p_email is not null);
end $$;

/** Notify a family: every parent login (push + email), or the family email if nobody has logged in yet. */
create function public.notify_family(
  p_family_id uuid, p_subject text, p_body text, p_push_title text, p_push_body text, p_url text, p_send_email boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare p record; any_login boolean := false; fam public.families;
begin
  select * into fam from public.families where id = p_family_id;
  for p in select id, email from public.profiles where family_id = p_family_id and role = 'parent' loop
    any_login := true;
    perform public.notify(p.id, p.email, p_subject, p_body, p_push_title, p_push_body, p_url, p_send_email);
  end loop;
  if not any_login and fam.email is not null then
    perform public.notify(null, fam.email, p_subject, p_body, null, null, p_url, p_send_email);
  end if;
end $$;

/** Notify the business: every admin login, plus the alert email in settings. */
create function public.notify_admins(p_subject text, p_body text, p_push_title text, p_push_body text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare p record; s public.settings;
begin
  select * into s from public.settings where id = 1;
  for p in select id, email from public.profiles where role = 'admin' loop
    perform public.notify(p.id, case when s.notify_email is null then p.email end, p_subject, p_body, p_push_title, p_push_body, p_url);
  end loop;
  if s.notify_email is not null then perform public.notify(null, s.notify_email, p_subject, p_body, null, null, p_url); end if;
end $$;

revoke all on function public.notify(uuid, text, text, text, text, text, text, boolean),
  public.notify_family(uuid, text, text, text, text, text, boolean),
  public.notify_admins(text, text, text, text, text) from public, anon, authenticated;

-- Invoices: tell the family when one is sent.
create function public.on_invoice_sent() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.settings; total numeric;
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    select * into s from public.settings where id = 1;
    total := public.invoice_total(new);
    perform public.notify_family(new.family_id,
      'Invoice ' || new.number || ' from ' || s.business_name,
      'A new invoice for AED ' || to_char(total, 'FM999,999,990.00') || ' is due by ' || to_char(new.due_date, 'DD Mon YYYY')
        || '. You can view and pay it in the Elite Education app.'
        || coalesce(E'\n\nBank transfer: ' || s.bank_details || '. Please quote ' || new.number || '.', ''),
      'New invoice ' || new.number, 'AED ' || to_char(total, 'FM999,999,990.00') || ' due ' || to_char(new.due_date, 'DD Mon'),
      '/invoice/' || new.id, s.email_invoices);
  end if;
  return new;
end $$;
create trigger invoices_notify after insert or update of status on public.invoices
  for each row execute function public.on_invoice_sent();

-- Lesson notes: email the family a summary once a lesson is recorded.
create function public.notify_lesson_recorded(p_lesson_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.lessons; n public.lesson_notes; s public.settings; fam uuid; hw text; names text;
begin
  select * into l from public.lessons where id = p_lesson_id;
  select * into n from public.lesson_notes where lesson_id = p_lesson_id;
  select * into s from public.settings where id = 1;
  if l.status <> 'completed' or n is null then return; end if;
  for fam in select distinct st.family_id from public.students st where st.id = any (l.student_ids) loop
    select string_agg(split_part(full_name, ' ', 1), ' & ') into names
      from public.students where id = any (l.student_ids) and family_id = fam;
    select string_agg('• ' || h.title || ' (due ' || to_char(h.due_date, 'DD Mon') || ')', E'\n') into hw
      from public.homework h join public.students st on st.id = h.student_id
      where h.lesson_id = l.id and st.family_id = fam;
    perform public.notify_family(fam,
      'Lesson notes for ' || names || ' — ' || to_char(l.start_at at time zone 'Asia/Dubai', 'DD Mon'),
      n.summary || coalesce(E'\n\nHomework:\n' || hw, ''),
      'Lesson notes for ' || names, left(n.summary, 120), '/lesson/' || l.id, s.email_lesson_notes);
  end loop;
end $$;
revoke all on function public.notify_lesson_recorded(uuid) from public, anon, authenticated;

-- Messages: push to everyone else in the conversation; email families when staff write to them.
create function public.on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; s public.settings; fam public.families;
begin
  select * into s from public.settings where id = 1;
  select * into fam from public.families where id = new.family_id;
  for p in
    select pr.id, pr.email, pr.role from public.profiles pr
    where pr.id is distinct from new.sender_id and (
      pr.role = 'admin'
      or (pr.role = 'parent' and pr.family_id = new.family_id)
      or (pr.role = 'tutor' and exists (
        select 1 from public.lessons l join public.students st on st.id = any (l.student_ids)
        where l.tutor_id = pr.tutor_id and st.family_id = new.family_id)))
  loop
    perform public.notify(p.id, p.email,
      'New message from ' || new.sender_name,
      new.body || E'\n\nReply in the Elite Education app.',
      new.sender_name, left(new.body, 140), '/messages/' || new.family_id,
      s.email_messages and p.role = 'parent' and new.sender_role <> 'parent');
  end loop;
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.on_message();

create function public.on_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select id, email from public.profiles
           where (new.audience = 'everyone' and role in ('parent', 'tutor', 'student'))
              or (new.audience = 'parents' and role = 'parent')
              or (new.audience = 'tutors' and role = 'tutor') loop
    perform public.notify(p.id, p.email, new.title, new.body, new.title, left(new.body, 140), '/announcements');
  end loop;
  return new;
end $$;
create trigger announcements_notify after insert on public.announcements
  for each row execute function public.on_announcement();

-- complete_lesson now also emails the family. Re-declared with the same signature.
create or replace function public.complete_lesson(
  p_lesson_id uuid, p_status text, p_attendance jsonb, p_summary text, p_private_note text,
  p_topic_ids text[], p_ratings jsonb, p_homework jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare l public.lessons; r jsonb;
begin
  select * into l from public.lessons where id = p_lesson_id for update;
  if l is null then raise exception 'Lesson not found'; end if;
  if not (public.is_admin() or l.tutor_id = public.my_tutor_id()) then
    raise exception 'Only the lesson''s tutor can complete it' using errcode = '42501';
  end if;
  if l.status <> 'scheduled' then raise exception 'This lesson has already been recorded'; end if;
  if p_status not in ('completed', 'no-show') then raise exception 'Invalid status'; end if;

  update public.lessons set status = p_status where id = l.id;
  insert into public.lesson_notes (lesson_id, summary, topic_ids, attendance)
  values (l.id, coalesce(trim(p_summary), ''), coalesce(p_topic_ids, '{}'), coalesce(p_attendance, '{}'))
  on conflict (lesson_id) do update set summary = excluded.summary, topic_ids = excluded.topic_ids, attendance = excluded.attendance;
  if nullif(trim(p_private_note), '') is not null then
    insert into public.lesson_private_notes (lesson_id, private_note) values (l.id, trim(p_private_note))
    on conflict (lesson_id) do update set private_note = excluded.private_note;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_ratings, '[]')) loop
    if (r->>'studentId')::uuid = any (l.student_ids) then
      insert into public.topic_ratings (student_id, topic_id, lesson_id, rating, rated_at)
      values ((r->>'studentId')::uuid, r->>'topicId', l.id, (r->>'rating')::smallint, l.start_at);
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_homework, '[]')) loop
    if (r->>'studentId')::uuid = any (l.student_ids) and nullif(trim(r->>'title'), '') is not null then
      insert into public.homework (student_id, lesson_id, title, due_date)
      values ((r->>'studentId')::uuid, l.id, trim(r->>'title'), (r->>'dueDate')::date);
    end if;
  end loop;
  perform public.apply_charges(l.id, coalesce(p_attendance, '{}'));
  perform public.notify_lesson_recorded(l.id);
end $$;

-- ---------------------------------------------------------------------------
-- Self sign-up: unknown emails become a new prospect family when they ask to
-- ---------------------------------------------------------------------------

drop trigger if exists link_login_on_signup on auth.users;
drop trigger if exists tutors_link_login on public.tutors;
drop trigger if exists families_link_login on public.families;
drop function if exists public.on_auth_user_confirmed();
drop function if exists public.link_existing_login();
drop function if exists public.link_login(uuid, text);

create function public.link_login(p_user_id uuid, p_email text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare t public.tutors; f public.families; parent_name text; fam_id uuid;
begin
  if exists (select 1 from public.profiles where id = p_user_id) then return; end if;

  select * into t from public.tutors where lower(email) = lower(p_email) limit 1;
  if t.id is not null then
    insert into public.profiles (id, role, full_name, email, tutor_id) values (p_user_id, 'tutor', t.full_name, p_email, t.id);
    return;
  end if;

  select * into f from public.families where lower(email) = lower(p_email) limit 1;
  if f.id is not null then
    insert into public.profiles (id, role, full_name, email, family_id) values (p_user_id, 'parent', f.parent_name, p_email, f.id);
    return;
  end if;

  -- A parent signing up through the app who we don't know yet: give them their own (prospect) family.
  if p_meta->>'signup' = 'parent' then
    parent_name := nullif(trim(p_meta->>'full_name'), '');
    if parent_name is null then return; end if;
    insert into public.families (name, parent_name, email, phone, status)
    values (coalesce(nullif(trim(p_meta->>'family_name'), ''), regexp_replace(parent_name, '^.*\s', '')),
            parent_name, p_email, nullif(trim(p_meta->>'phone'), ''), 'prospect')
    returning id into fam_id;
    -- Creating the family fires the families_link_login trigger, which may already have linked this login.
    insert into public.profiles (id, role, full_name, email, phone, family_id)
    values (p_user_id, 'parent', parent_name, p_email, nullif(trim(p_meta->>'phone'), ''), fam_id)
    on conflict (id) do update set phone = excluded.phone;
    perform public.notify_admins('New parent sign-up: ' || parent_name,
      parent_name || ' (' || p_email || ') created an account in the app.', 'New sign-up', parent_name, '/admin/enquiries');
  end if;
end $$;
revoke all on function public.link_login(uuid, text, jsonb) from public, anon, authenticated;

create function public.on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    perform public.link_login(new.id, new.email, coalesce(new.raw_user_meta_data, '{}'));
  end if;
  return new;
end $$;
create trigger link_login_on_signup
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.on_auth_user_confirmed();

create function public.link_existing_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  for u in select id, email from auth.users where lower(email) = lower(new.email) and email_confirmed_at is not null loop
    perform public.link_login(u.id, u.email);
  end loop;
  return new;
end $$;
create trigger tutors_link_login after insert or update of email on public.tutors
  for each row execute function public.link_existing_login();
create trigger families_link_login after insert or update of email on public.families
  for each row execute function public.link_existing_login();

/** A parent adds a child to their own family (during onboarding). */
create function public.add_my_child(
  p_full_name text, p_curriculum text, p_syllabus_id text, p_school text default null, p_year_group text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare fam uuid; sid uuid;
begin
  fam := public.my_family_id();
  if fam is null then raise exception 'Only parents can add children' using errcode = '42501'; end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Enter your child''s name'; end if;
  if (select count(*) from public.students where family_id = fam) >= 10 then raise exception 'Please contact us to add more children'; end if;
  insert into public.students (family_id, full_name, curriculum, syllabus_id, school, year_group)
  values (fam, trim(p_full_name), p_curriculum, p_syllabus_id, nullif(trim(p_school), ''), nullif(trim(p_year_group), ''))
  returning id into sid;
  return sid;
end $$;

-- ---------------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------------

/** Anyone (including the public website) can send an enquiry. Signed-in parents are linked automatically. */
create function public.submit_enquiry(
  p_parent_name text, p_email text, p_phone text, p_student_name text, p_curriculum text,
  p_year_group text, p_message text, p_preferred_times text, p_source text default 'app'
) returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid; fam uuid;
begin
  if nullif(trim(p_parent_name), '') is null then raise exception 'Please enter your name'; end if;
  if nullif(trim(p_email), '') is null and nullif(trim(p_phone), '') is null then
    raise exception 'Please give an email address or phone number';
  end if;
  if p_email is not null and (select count(*) from public.enquiries
      where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 day') >= 5 then
    raise exception 'We already have your enquiry — we''ll be in touch soon';
  end if;
  fam := public.my_family_id();
  insert into public.enquiries (parent_name, email, phone, student_name, curriculum, year_group, message, preferred_times, source, family_id)
  values (trim(p_parent_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''), nullif(trim(p_student_name), ''),
          nullif(p_curriculum, ''), nullif(trim(p_year_group), ''), nullif(trim(p_message), ''), nullif(trim(p_preferred_times), ''),
          case when p_source in ('app', 'website', 'referral', 'phone', 'other') then p_source else 'other' end, fam)
  returning id into eid;
  perform public.notify_admins('New enquiry: ' || trim(p_parent_name),
    trim(p_parent_name) || coalesce(' (' || nullif(trim(p_email), '') || ')', '') || coalesce(', ' || nullif(trim(p_phone), ''), '')
      || coalesce(E'\nStudent: ' || nullif(trim(p_student_name), ''), '') || coalesce(' — ' || nullif(p_curriculum, ''), '')
      || coalesce(E'\n\n' || nullif(trim(p_message), ''), ''),
    'New enquiry', trim(p_parent_name), '/admin/enquiries');
  if nullif(trim(p_email), '') is not null then
    perform public.notify(null, lower(trim(p_email)), 'Thanks for contacting Elite Education',
      'Hi ' || split_part(trim(p_parent_name), ' ', 1) || E',\n\nThanks for getting in touch. We''ll contact you within one working day to arrange a free consultation.\n\nElite Education');
  end if;
  return eid;
end $$;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Booking: open slots, requests and approvals
-- ---------------------------------------------------------------------------

/** Free start times for a tutor (local Dubai time), honouring availability, lessons, closures, absences and notice. */
create function public.open_slots(p_tutor_id uuid, p_from date, p_days int, p_duration_min int, p_ignore_lesson uuid default null)
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
                             and l.start_at < t + make_interval(mins => p_duration_min) and l.end_at > t) then
          start_at := t; end_at := t + make_interval(mins => p_duration_min);
          return next;
        end if;
        t := t + interval '30 minutes';
      end loop;
    end loop;
  end loop;
end $$;
grant execute on function public.open_slots(uuid, date, int, int, uuid) to authenticated;

create function public.request_lesson(
  p_student_id uuid, p_kind text, p_lesson_id uuid, p_tutor_id uuid, p_service_id uuid, p_start timestamptz, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare st public.students; l public.lessons; dur int; rid uuid; svc uuid;
begin
  select * into st from public.students where id = p_student_id;
  if st is null or not (public.is_admin() or st.family_id = public.my_family_id()) then
    raise exception 'Student not found' using errcode = '42501';
  end if;
  if p_kind = 'reschedule' then
    select * into l from public.lessons where id = p_lesson_id and p_student_id = any (student_ids) and status = 'scheduled';
    if l is null then raise exception 'That lesson can no longer be moved'; end if;
    dur := extract(epoch from (l.end_at - l.start_at)) / 60;
    svc := l.service_id;
  elsif p_kind = 'new-lesson' then
    select duration_min, id into dur, svc from public.services where id = p_service_id;
    if dur is null then raise exception 'Choose a lesson type'; end if;
  else
    raise exception 'Unknown request';
  end if;
  if not exists (select 1 from public.open_slots(coalesce(l.tutor_id, p_tutor_id), (p_start at time zone 'Asia/Dubai')::date, 1, dur, l.id) o
                 where o.start_at = p_start) then
    raise exception 'Sorry, that time is no longer available';
  end if;
  insert into public.lesson_requests (family_id, student_id, requested_by, kind, lesson_id, tutor_id, service_id, start_at, end_at, note)
  values (st.family_id, st.id, auth.uid(), p_kind, l.id, coalesce(l.tutor_id, p_tutor_id), svc, p_start,
          p_start + make_interval(mins => dur), nullif(trim(p_note), ''))
  returning id into rid;
  perform public.notify_admins(
    case when p_kind = 'reschedule' then 'Reschedule request: ' else 'Lesson request: ' end || st.full_name,
    st.full_name || ' — ' || to_char(p_start at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI') || coalesce(E'\n\n' || nullif(trim(p_note), ''), ''),
    'Lesson request', st.full_name || ', ' || to_char(p_start at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI'), '/admin/requests');
  return rid;
end $$;
grant execute on function public.request_lesson(uuid, text, uuid, uuid, uuid, timestamptz, text) to authenticated;

create function public.decide_request(p_id uuid, p_approve boolean, p_response text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.lesson_requests; st public.students; clash boolean;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into r from public.lesson_requests where id = p_id for update;
  if r is null or r.status <> 'pending' then raise exception 'This request has already been dealt with'; end if;
  select * into st from public.students where id = r.student_id;
  if p_approve then
    select exists (select 1 from public.lessons l
                   where l.status = 'scheduled' and l.id is distinct from r.lesson_id
                     and (l.tutor_id = r.tutor_id or r.student_id = any (l.student_ids))
                     and l.start_at < r.end_at and l.end_at > r.start_at) into clash;
    if clash then raise exception 'That time now clashes with another lesson — decline and suggest another time'; end if;
    if r.kind = 'reschedule' then
      update public.lessons set start_at = r.start_at, end_at = r.end_at where id = r.lesson_id and status = 'scheduled';
      if not found then raise exception 'The original lesson can no longer be moved'; end if;
    else
      insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location)
      select r.tutor_id, array[r.student_id], r.service_id, r.start_at, r.end_at,
             coalesce((select location from public.lessons where r.student_id = any (student_ids) order by start_at desc limit 1), 'online');
    end if;
  end if;
  update public.lesson_requests set status = case when p_approve then 'approved' else 'declined' end,
    response = nullif(trim(p_response), ''), decided_at = now() where id = r.id;
  perform public.notify_family(r.family_id,
    case when p_approve then 'Lesson confirmed: ' else 'Lesson request update: ' end || st.full_name,
    case when p_approve
      then 'Confirmed for ' || to_char(r.start_at at time zone 'Asia/Dubai', 'FMDay DD Mon at HH24:MI') || '.'
      else 'Sorry, we can''t do ' || to_char(r.start_at at time zone 'Asia/Dubai', 'FMDay DD Mon at HH24:MI') || '.' end
      || coalesce(E'\n\n' || nullif(trim(p_response), ''), ''),
    case when p_approve then 'Lesson confirmed' else 'Request declined' end,
    st.full_name || ', ' || to_char(r.start_at at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI'), '/', true);
end $$;
grant execute on function public.decide_request(uuid, boolean, text) to authenticated;

create function public.withdraw_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.lesson_requests set status = 'withdrawn', decided_at = now()
  where id = p_id and status = 'pending' and (family_id = public.my_family_id() or public.is_admin());
  if not found then raise exception 'Request not found'; end if;
end $$;
grant execute on function public.withdraw_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Messaging helpers
-- ---------------------------------------------------------------------------

/** Conversations the caller can see, newest first, with unread counts. */
create function public.my_threads()
returns table (family_id uuid, family_name text, parent_name text, last_body text, last_sender text, last_at timestamptz, unread int)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.parent_name, m.body, m.sender_name, m.created_at,
    (select count(*)::int from public.messages x
       where x.family_id = f.id and x.sender_id is distinct from auth.uid()
         and x.created_at > coalesce((select r.last_read_at from public.message_reads r
                                      where r.profile_id = auth.uid() and r.family_id = f.id), '-infinity'))
  from public.families f
  left join lateral (select body, sender_name, created_at from public.messages
                     where messages.family_id = f.id order by created_at desc limit 1) m on true
  where public.can_access_thread(f.id) and f.status <> 'archived'
    and (m.created_at is not null or public.my_family_id() = f.id or public.is_admin())
  order by m.created_at desc nulls last, f.name
$$;
grant execute on function public.my_threads() to authenticated;

create function public.send_message(p_family_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or not public.can_access_thread(p_family_id) then raise exception 'Conversation not found' using errcode = '42501'; end if;
  if nullif(trim(p_body), '') is null then return; end if;
  insert into public.messages (family_id, sender_id, sender_name, sender_role, body)
  values (p_family_id, me.id, me.full_name, me.role, trim(p_body));
  insert into public.message_reads (profile_id, family_id, last_read_at) values (me.id, p_family_id, now())
  on conflict (profile_id, family_id) do update set last_read_at = now();
end $$;
grant execute on function public.send_message(uuid, text) to authenticated;

create function public.mark_thread_read(p_family_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.message_reads (profile_id, family_id, last_read_at)
  select auth.uid(), p_family_id, now() where public.can_access_thread(p_family_id)
  on conflict (profile_id, family_id) do update set last_read_at = now()
$$;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cover: reassign a lesson to another tutor
-- ---------------------------------------------------------------------------

create function public.reassign_lesson(p_lesson_id uuid, p_tutor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.lessons; t public.tutors;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into l from public.lessons where id = p_lesson_id and status = 'scheduled' for update;
  if l is null then raise exception 'Only scheduled lessons can be reassigned'; end if;
  select * into t from public.tutors where id = p_tutor_id;
  if exists (select 1 from public.lessons x where x.tutor_id = p_tutor_id and x.status = 'scheduled'
             and x.start_at < l.end_at and x.end_at > l.start_at) then
    raise exception '% already has a lesson then', t.full_name;
  end if;
  update public.lessons set tutor_id = p_tutor_id where id = l.id;
  perform public.notify(p.id, p.email, 'Cover lesson', 'You''re covering a lesson on '
      || to_char(l.start_at at time zone 'Asia/Dubai', 'FMDay DD Mon at HH24:MI') || '.',
      'Cover lesson', to_char(l.start_at at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI'), '/lesson/' || l.id)
    from public.profiles p where p.tutor_id = p_tutor_id and p.role in ('tutor', 'admin');
end $$;
grant execute on function public.reassign_lesson(uuid, uuid) to authenticated;

grant execute on function public.add_my_child(text, text, text, text, text) to authenticated;
