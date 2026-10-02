-- Elite Education — initial schema
-- Roles: admin (the business), tutor, parent, student.
-- Row-level security enforces who sees what; money-moving actions go through security-definer
-- functions so families and tutors can't write charges or invoices directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Elite Education',
  currency text not null default 'AED',
  vat_rate numeric(5,4) not null default 0,
  cancellation_hours int not null default 24,
  late_cancel_fee numeric(4,3) not null default 1 check (late_cancel_fee between 0 and 1),
  no_show_fee numeric(4,3) not null default 1 check (no_show_fee between 0 and 1),
  pay_tutor_for_late_cancel boolean not null default true,
  invoice_due_days int not null default 7,
  next_invoice_number int not null default 1001,
  bank_details text
);
insert into public.settings (id) values (1);

create table public.tutors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  hourly_pay numeric(10,2) not null default 0,
  subjects text[] not null default '{}',
  color text not null default '#2b6cb0'
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_name text not null,
  email text not null,
  phone text
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  full_name text not null,
  curriculum text not null check (curriculum in ('IB', 'IGCSE', 'A-Level')),
  syllabus_id text not null,
  school text,
  year_group text,
  current_grade text,
  target_grade text,
  exam_date date
);

-- Tutor-only notes about a student, kept apart so families can never read them.
create table public.student_notes (
  student_id uuid primary key references public.students(id) on delete cascade,
  notes text not null default ''
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'tutor', 'parent', 'student')),
  full_name text not null,
  email text not null,
  phone text,
  tutor_id uuid references public.tutors(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  push_token text,
  ics_token uuid not null default gen_random_uuid() unique
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_min int not null check (duration_min > 0),
  rate numeric(10,2) not null check (rate >= 0)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id),
  student_ids uuid[] not null check (cardinality(student_ids) > 0),
  service_id uuid not null references public.services(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text not null check (location in ('online', 'in-person')),
  meeting_url text,
  address text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'late-cancel', 'no-show')),
  series_id uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  check (end_at > start_at)
);
create index lessons_start_idx on public.lessons (start_at);
create index lessons_tutor_idx on public.lessons (tutor_id, start_at);
create index lessons_students_idx on public.lessons using gin (student_ids);

create table public.lesson_notes (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  summary text not null default '',
  topic_ids text[] not null default '{}',
  attendance jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.lesson_private_notes (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  private_note text not null
);

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  title text not null,
  due_date date not null,
  done boolean not null default false
);
create index homework_student_idx on public.homework (student_id);

create table public.topic_ratings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id text not null,
  lesson_id uuid references public.lessons(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  rated_at timestamptz not null default now()
);
create index topic_ratings_student_idx on public.topic_ratings (student_id);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  service_id uuid references public.services(id),
  lessons_total int not null check (lessons_total > 0),
  lessons_used int not null default 0 check (lessons_used >= 0),
  price numeric(10,2) not null,
  purchased_at date not null default current_date,
  expires_at date,
  check (lessons_used <= lessons_total)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  family_id uuid not null references public.families(id),
  issue_date date not null default current_date,
  due_date date not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  -- [{ description, quantity, unitPrice, chargeId?, packageId? }]
  items jsonb not null default '[]',
  vat_rate numeric(5,4) not null default 0,
  notes text
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.students(id),
  family_id uuid not null references public.families(id),
  description text not null,
  amount numeric(10,2) not null,
  status text not null default 'unbilled' check (status in ('unbilled', 'invoiced', 'package')),
  invoice_id uuid references public.invoices(id) on delete set null,
  package_id uuid references public.packages(id),
  date timestamptz not null
);
create index charges_family_idx on public.charges (family_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('card', 'bank-transfer', 'cash')),
  paid_at timestamptz not null default now(),
  reference text,
  stripe_session_id text unique
);

-- ---------------------------------------------------------------------------
-- Who is asking?
-- ---------------------------------------------------------------------------

create function public.me() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create function public.my_tutor_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tutor_id from public.profiles where id = auth.uid() and role in ('tutor', 'admin')
$$;

create function public.my_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.profiles where id = auth.uid() and role = 'parent'
$$;

/** Students the current user may see. */
create function public.visible_student_ids() returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p is null then return '{}'; end if;
  if p.role = 'admin' then return array(select id from public.students); end if;
  if p.role = 'parent' then return array(select id from public.students where family_id = p.family_id); end if;
  if p.role = 'student' then return array[p.student_id]; end if;
  -- tutor
  return array(select distinct unnest(student_ids) from public.lessons where tutor_id = p.tutor_id);
end $$;

create function public.can_see_lesson(l public.lessons) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin()
    or l.tutor_id = public.my_tutor_id()
    or (
      (select role from public.profiles where id = auth.uid()) in ('parent', 'student')
      and l.student_ids && public.visible_student_ids()
    ),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.settings enable row level security;
alter table public.tutors enable row level security;
alter table public.families enable row level security;
alter table public.students enable row level security;
alter table public.student_notes enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_notes enable row level security;
alter table public.lesson_private_notes enable row level security;
alter table public.homework enable row level security;
alter table public.topic_ratings enable row level security;
alter table public.packages enable row level security;
alter table public.invoices enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;

-- Reference data everyone signed in can read; only admins change it.
create policy "read settings" on public.settings for select to authenticated using (true);
create policy "admin settings" on public.settings for update to authenticated using (public.is_admin());
create policy "read tutors" on public.tutors for select to authenticated using (true);
create policy "admin tutors" on public.tutors for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read services" on public.services for select to authenticated using (true);
create policy "admin services" on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "admin profiles" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "see students" on public.students for select to authenticated
  using (id = any (public.visible_student_ids()));
create policy "admin students" on public.students for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "staff student notes" on public.student_notes for all to authenticated
  using (public.is_admin() or (public.my_tutor_id() is not null and student_id = any (public.visible_student_ids())))
  with check (public.is_admin() or (public.my_tutor_id() is not null and student_id = any (public.visible_student_ids())));

create policy "see families" on public.families for select to authenticated
  using (public.is_admin() or id = public.my_family_id()
         or id in (select family_id from public.students where id = any (public.visible_student_ids())));
create policy "admin families" on public.families for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "see lessons" on public.lessons for select to authenticated using (public.can_see_lesson(lessons));
create policy "admin lessons" on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "see notes" on public.lesson_notes for select to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and public.can_see_lesson(l)));
create policy "staff private notes" on public.lesson_private_notes for select to authenticated
  using (public.is_admin() or exists (select 1 from public.lessons l where l.id = lesson_id and l.tutor_id = public.my_tutor_id()));

create policy "see homework" on public.homework for select to authenticated using (student_id = any (public.visible_student_ids()));
create policy "admin homework" on public.homework for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "see ratings" on public.topic_ratings for select to authenticated using (student_id = any (public.visible_student_ids()));

create policy "see packages" on public.packages for select to authenticated using (public.is_admin() or family_id = public.my_family_id());
create policy "admin packages" on public.packages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "see charges" on public.charges for select to authenticated using (public.is_admin() or family_id = public.my_family_id());
create policy "admin charges" on public.charges for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "see invoices" on public.invoices for select to authenticated
  using (public.is_admin() or (family_id = public.my_family_id() and status <> 'draft'));
create policy "admin invoices" on public.invoices for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "see payments" on public.payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.invoices i where i.id = invoice_id and i.family_id = public.my_family_id()));
create policy "admin payments" on public.payments for insert to authenticated with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Billing helpers
-- ---------------------------------------------------------------------------

create function public.invoice_total(inv public.invoices) returns numeric
language sql stable as $$
  select round(coalesce(sum((i->>'quantity')::numeric * (i->>'unitPrice')::numeric), 0) * (1 + inv.vat_rate), 2)
  from jsonb_array_elements(inv.items) i
$$;

-- Mark an invoice paid once payments cover it (covers admin payments and the Stripe webhook).
create function public.refresh_invoice_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = new.invoice_id;
  if (select coalesce(sum(amount), 0) from public.payments where invoice_id = inv.id) >= public.invoice_total(inv) then
    update public.invoices set status = 'paid' where id = inv.id and status <> 'void';
  end if;
  return new;
end $$;
create trigger payments_refresh_invoice after insert on public.payments
  for each row execute function public.refresh_invoice_status();

/** Create charges for a lesson that happened / was late-cancelled. Mirrors chargesForLesson() in src/domain/billing.ts. */
create function public.apply_charges(p_lesson_id uuid, p_attendance jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.lessons;
  svc public.services;
  s public.settings;
  st public.students;
  fee numeric;
  label text;
  pkg public.packages;
  sid uuid;
begin
  select * into l from public.lessons where id = p_lesson_id;
  select * into svc from public.services where id = l.service_id;
  select * into s from public.settings where id = 1;
  foreach sid in array l.student_ids loop
    select * into st from public.students where id = sid;
    continue when st is null;
    if l.status = 'late-cancel' then fee := s.late_cancel_fee; label := ' (late cancellation)';
    elsif l.status = 'no-show' or p_attendance->>sid::text = 'absent' then fee := s.no_show_fee; label := ' (missed lesson)';
    elsif l.status = 'completed' then fee := 1; label := '';
    else continue;
    end if;
    continue when fee <= 0;

    pkg := null;
    if fee = 1 then
      select * into pkg from public.packages p
       where p.family_id = st.family_id and p.lessons_used < p.lessons_total
         and (p.service_id is null or p.service_id = svc.id)
         and (p.expires_at is null or p.expires_at >= (l.start_at at time zone 'Asia/Dubai')::date)
       order by p.purchased_at limit 1 for update;
    end if;

    if pkg.id is not null then
      update public.packages set lessons_used = lessons_used + 1 where id = pkg.id;
      insert into public.charges (lesson_id, student_id, family_id, description, amount, status, package_id, date)
      values (l.id, sid, st.family_id,
              svc.name || ' — ' || st.full_name || ', ' || to_char(l.start_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') || label,
              0, 'package', pkg.id, l.start_at);
    else
      insert into public.charges (lesson_id, student_id, family_id, description, amount, status, date)
      values (l.id, sid, st.family_id,
              svc.name || ' — ' || st.full_name || ', ' || to_char(l.start_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') || label,
              round(svc.rate * fee, 2), 'unbilled', l.start_at);
    end if;
  end loop;
end $$;
revoke all on function public.apply_charges(uuid, jsonb) from public, anon, authenticated;

create function public.next_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.settings set next_invoice_number = next_invoice_number + 1 where id = 1
  returning next_invoice_number - 1 into n;
  return 'INV-' || lpad(n::text, 4, '0');
end $$;
revoke all on function public.next_invoice_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Actions (RPCs)
-- ---------------------------------------------------------------------------

create function public.complete_lesson(
  p_lesson_id uuid,
  p_status text,
  p_attendance jsonb,
  p_summary text,
  p_private_note text,
  p_topic_ids text[],
  p_ratings jsonb,   -- [{ studentId, topicId, rating }]
  p_homework jsonb   -- [{ studentId, title, dueDate }]
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
end $$;

create function public.cancel_lesson(p_lesson_id uuid, p_reason text, p_waive boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.lessons;
  s public.settings;
  v_role text;
  hours numeric;
  waive boolean;
  chargeable boolean;
  new_status text;
begin
  select * into l from public.lessons where id = p_lesson_id for update;
  if l is null or not public.can_see_lesson(l) then raise exception 'Lesson not found'; end if;
  if l.status <> 'scheduled' then raise exception 'This lesson can no longer be cancelled'; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role = 'student' then raise exception 'Ask a parent to cancel lessons' using errcode = '42501'; end if;
  select * into s from public.settings where id = 1;

  -- Only the business can waive a fee; a tutor cancelling never charges the family.
  waive := case when v_role = 'admin' then coalesce(p_waive, false) else v_role = 'tutor' end;
  hours := extract(epoch from (l.start_at - now())) / 3600;
  chargeable := hours < s.cancellation_hours and not waive and s.late_cancel_fee > 0;
  new_status := case when chargeable then 'late-cancel' else 'cancelled' end;

  update public.lessons set status = new_status, cancelled_at = now(), cancel_reason = p_reason where id = l.id;
  if chargeable then perform public.apply_charges(l.id); end if;
  return jsonb_build_object('status', new_status, 'chargeable', chargeable, 'hoursNotice', hours,
                            'fee', case when chargeable then s.late_cancel_fee else 0 end);
end $$;

create function public.set_homework_done(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.homework set done = p_done where id = p_id and student_id = any (public.visible_student_ids());
  if not found then raise exception 'Homework not found'; end if;
end $$;

create function public.invoice_unbilled(p_family_id uuid)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare inv public.invoices; s public.settings; items jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('description', description, 'quantity', 1, 'unitPrice', amount, 'chargeId', id) order by date), '[]')
    into items from public.charges where family_id = p_family_id and status = 'unbilled';
  if jsonb_array_length(items) = 0 then return null; end if;
  select * into s from public.settings where id = 1;
  insert into public.invoices (number, family_id, issue_date, due_date, status, items, vat_rate)
  values (public.next_invoice_number(), p_family_id, current_date, current_date + s.invoice_due_days, 'sent', items, s.vat_rate)
  returning * into inv;
  update public.charges set status = 'invoiced', invoice_id = inv.id where family_id = p_family_id and status = 'unbilled';
  return inv;
end $$;

create function public.sell_package(
  p_family_id uuid, p_name text, p_service_id uuid, p_lessons_total int, p_price numeric, p_expires_at date default null
) returns public.invoices language plpgsql security definer set search_path = public as $$
declare pkg public.packages; inv public.invoices; s public.settings;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into s from public.settings where id = 1;
  insert into public.packages (family_id, name, service_id, lessons_total, price, expires_at)
  values (p_family_id, p_name, p_service_id, p_lessons_total, p_price, p_expires_at) returning * into pkg;
  insert into public.invoices (number, family_id, issue_date, due_date, status, items, vat_rate)
  values (public.next_invoice_number(), p_family_id, current_date, current_date + s.invoice_due_days, 'sent',
          jsonb_build_array(jsonb_build_object('description', p_name || ' (' || p_lessons_total || ' lessons)',
                                               'quantity', 1, 'unitPrice', p_price, 'packageId', pkg.id)),
          s.vat_rate)
  returning * into inv;
  return inv;
end $$;

-- Voiding an invoice releases its charges so they can be billed again.
create function public.release_voided_charges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.charges set status = 'unbilled', invoice_id = null where invoice_id = new.id;
  end if;
  return new;
end $$;
create trigger invoices_release_charges after update of status on public.invoices
  for each row execute function public.release_voided_charges();

create function public.set_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  update public.profiles set push_token = p_token where id = auth.uid()
$$;

grant execute on function public.complete_lesson(uuid, text, jsonb, text, text, text[], jsonb, jsonb) to authenticated;
grant execute on function public.cancel_lesson(uuid, text, boolean) to authenticated;
grant execute on function public.set_homework_done(uuid, boolean) to authenticated;
grant execute on function public.invoice_unbilled(uuid) to authenticated;
grant execute on function public.sell_package(uuid, text, uuid, int, numeric, date) to authenticated;
grant execute on function public.set_push_token(text) to authenticated;
