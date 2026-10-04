-- Elite Education — per-student tutor pay and family prices.
--
-- By default a tutor is paid their usual hourly rate (tutors.hourly_pay) and a family is charged the service price
-- (services.rate). An admin may override either for one student's subject (an enrolment):
--   * enrolment_tutor_pay    — what the enrolment's tutor is paid per hour for that student and subject;
--   * enrolment_family_price — what the family is charged per hour for that student and subject.
-- The rules mirror src/domain/rates.ts and must stay identical to it:
--   * A lesson counts towards the student's active enrolment in the lesson's subject (or their only active enrolment
--     when the lesson has no subject).
--   * Custom pay belongs to the enrolment's tutor. A cover tutor is paid their own usual rate.
--   * Group lessons: each family is charged its own price; the tutor is paid the highest rate among the students.
--   * Snapshot: charges and submitted tutor invoices keep the price they were created with. Changing a rate only
--     affects charges created afterwards and draft tutor invoices (which are rebuilt on each call).

-- ---------------------------------------------------------------------------
-- Tables (admin-write only)
-- ---------------------------------------------------------------------------

create table public.enrolment_tutor_pay (
  enrolment_id uuid primary key references public.enrolments(id) on delete cascade,
  hourly_pay numeric(10,2) not null check (hourly_pay >= 0 and hourly_pay < 100000),
  source text not null default 'custom' check (source in ('custom', 'opportunity')),
  opportunity_id uuid references public.opportunities(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.enrolment_family_price (
  enrolment_id uuid primary key references public.enrolments(id) on delete cascade,
  hourly_price numeric(10,2) not null check (hourly_price >= 0 and hourly_price < 100000),
  updated_at timestamptz not null default now()
);

comment on table public.enrolment_tutor_pay is
  'Custom hourly pay for the tutor of one enrolment (student and subject). Applies only while that tutor teaches the '
  'enrolment and is cleared when the enrolment''s tutor changes; a cover tutor is paid their own usual rate. Visible to '
  'admins and the enrolment''s tutor only.';
comment on table public.enrolment_family_price is
  'Custom hourly price the family pays for one enrolment (student and subject), in place of the service price. '
  'Visible to admins and the student''s family only. Charges keep a snapshot of the price used.';

alter table public.enrolment_tutor_pay enable row level security;
alter table public.enrolment_family_price enable row level security;

create policy "see tutor pay" on public.enrolment_tutor_pay for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.enrolments e where e.id = enrolment_id and e.tutor_id = public.my_tutor_id()));
create policy "admin tutor pay" on public.enrolment_tutor_pay for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "see family price" on public.enrolment_family_price for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.enrolments e join public.students s on s.id = e.student_id
    where e.id = enrolment_id and s.family_id = public.my_family_id()));
create policy "admin family price" on public.enrolment_family_price for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.enrolment_tutor_pay, public.enrolment_family_price to authenticated;
revoke all on public.enrolment_tutor_pay, public.enrolment_family_price from anon;

-- Snapshot of the price used for each charge. Older charges stay null.
alter table public.charges
  add column price_source text check (price_source in ('service', 'custom')),
  add column hourly_price numeric(10,2);
comment on column public.charges.price_source is
  '''service'' (the service price or a package credit) or ''custom'' (the enrolment''s family price). Null for charges made before per-student prices.';
comment on column public.charges.hourly_price is
  'The custom hourly price used for this charge (snapshot); null when the service price or a package was used.';

-- ---------------------------------------------------------------------------
-- Single source of truth for rates (mirrors src/domain/rates.ts)
-- ---------------------------------------------------------------------------

/**
 * The student's active enrolment a lesson counts towards: the one in the lesson's subject (the first by subject and
 * title if several match), or, for a lesson without a subject, the student's only active enrolment. Otherwise null.
 */
create function public.lesson_enrolment(p_lesson public.lessons, p_student_id uuid) returns public.enrolments
language plpgsql stable security definer set search_path = public as $$
declare e public.enrolments;
begin
  if nullif(trim(p_lesson.subject), '') is not null then
    select * into e from public.enrolments x
    where x.student_id = p_student_id and x.active and lower(trim(x.subject)) = lower(trim(p_lesson.subject))
    order by x.subject, public.enrolment_title(x.subject, x.curriculum, x.level)
    limit 1;
  elsif (select count(*) from public.enrolments x where x.student_id = p_student_id and x.active) = 1 then
    select * into e from public.enrolments x where x.student_id = p_student_id and x.active;
  end if;
  return e;
end $$;
comment on function public.lesson_enrolment(public.lessons, uuid) is
  'The student''s active enrolment a lesson counts towards (by subject, or the only one when the lesson has no subject). Mirrors lessonEnrolment in src/domain/rates.ts.';

/**
 * What the lesson's tutor is paid per hour. Each student's rate is the enrolment's custom pay when the lesson's
 * tutor is the enrolment's tutor, otherwise the tutor's usual rate. The lesson pays the highest of these ('custom'
 * wins a tie). Always one row.
 */
create function public.lesson_tutor_rate(p_lesson_id uuid) returns table (rate numeric, source text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  l public.lessons;
  usual numeric;
  e public.enrolments;
  custom numeric;
  r numeric;
  src text;
  best numeric;
  best_src text;
  sid uuid;
begin
  select * into l from public.lessons x where x.id = p_lesson_id;
  select t.hourly_pay into usual from public.tutors t where t.id = l.tutor_id;
  foreach sid in array coalesce(l.student_ids, '{}'::uuid[]) loop
    e := public.lesson_enrolment(l, sid);
    custom := null;
    if e.id is not null and e.tutor_id = l.tutor_id then
      select p.hourly_pay into custom from public.enrolment_tutor_pay p where p.enrolment_id = e.id;
    end if;
    if custom is not null then r := custom; src := 'custom'; else r := usual; src := 'usual'; end if;
    if best is null or r > best or (r = best and src = 'custom') then best := r; best_src := src; end if;
  end loop;
  if best_src is null then best := usual; best_src := 'usual'; end if;
  rate := best; source := best_src;
  return next;
end $$;
comment on function public.lesson_tutor_rate(uuid) is
  'Hourly pay for a lesson. Group rule: the tutor is paid the highest effective rate among the students (custom wins a tie). '
  'Custom pay applies only when the lesson''s tutor is the enrolment''s tutor; a cover tutor is paid their usual rate. Mirrors src/domain/rates.ts.';

/**
 * The full-fee amount one student's family pays for a lesson: the enrolment's custom hourly price times the lesson's
 * length, or else the service price. Each student in a group is charged their own price.
 */
create function public.lesson_family_price(p_lesson_id uuid, p_student_id uuid)
returns table (amount numeric, hourly_price numeric, source text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  l public.lessons;
  e public.enrolments;
  price numeric;
begin
  select * into l from public.lessons x where x.id = p_lesson_id;
  e := public.lesson_enrolment(l, p_student_id);
  if e.id is not null then
    select f.hourly_price into price from public.enrolment_family_price f where f.enrolment_id = e.id;
  end if;
  if price is not null then
    amount := round(price * extract(epoch from (l.end_at - l.start_at)) / 3600, 2);
    hourly_price := price;
    source := 'custom';
  else
    select svc.rate into amount from public.services svc where svc.id = l.service_id;
    hourly_price := null;
    source := 'service';
  end if;
  return next;
end $$;
comment on function public.lesson_family_price(uuid, uuid) is
  'Full-fee amount for one student in a lesson: custom hourly price x hours, or the service price. Group rule: each family pays its own price. '
  'Charges store a snapshot (price_source, hourly_price, amount), so later rate changes never alter existing charges.';

revoke all on function public.lesson_enrolment(public.lessons, uuid), public.lesson_tutor_rate(uuid),
  public.lesson_family_price(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admins set or clear the overrides
-- ---------------------------------------------------------------------------

/** Set (or, with null, clear) an enrolment's custom tutor pay and family price. Admins only. */
create function public.set_enrolment_rates(p_enrolment_id uuid, p_tutor_pay numeric, p_family_price numeric)
returns void language plpgsql security definer set search_path = public as $$
declare e public.enrolments; pay numeric := round(p_tutor_pay, 2); price numeric := round(p_family_price, 2);
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into e from public.enrolments where id = p_enrolment_id for update;
  if e.id is null then raise exception 'Subject not found'; end if;
  if pay < 0 or price < 0 then raise exception 'Please enter a rate of zero or more.'; end if;
  if pay >= 100000 or price >= 100000 then raise exception 'Please enter a rate below 100,000.'; end if;
  if pay is not null and e.tutor_id is null then
    raise exception 'Please choose a tutor for this subject before setting their pay.';
  end if;

  if pay is null then
    delete from public.enrolment_tutor_pay where enrolment_id = e.id;
  else
    insert into public.enrolment_tutor_pay as p (enrolment_id, hourly_pay, source, opportunity_id, updated_at)
    values (e.id, pay, 'custom', null, now())
    on conflict (enrolment_id) do update set
      hourly_pay = excluded.hourly_pay,
      source = case when p.hourly_pay = excluded.hourly_pay then p.source else 'custom' end,
      opportunity_id = case when p.hourly_pay = excluded.hourly_pay then p.opportunity_id end,
      updated_at = now();
  end if;

  if price is null then
    delete from public.enrolment_family_price where enrolment_id = e.id;
  else
    insert into public.enrolment_family_price (enrolment_id, hourly_price, updated_at)
    values (e.id, price, now())
    on conflict (enrolment_id) do update set hourly_price = excluded.hourly_price, updated_at = now();
  end if;
end $$;
comment on function public.set_enrolment_rates(uuid, numeric, numeric) is
  'Admins set or clear (null) an enrolment''s custom tutor pay and family price. Existing charges and submitted tutor invoices keep their snapshot.';
revoke all on function public.set_enrolment_rates(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_enrolment_rates(uuid, numeric, numeric) to authenticated;

/** Custom pay belongs to the student, subject and tutor combination: a new tutor starts on their usual rate. */
create function public.on_enrolment_tutor_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.enrolment_tutor_pay where enrolment_id = new.id;
  return new;
end $$;
revoke all on function public.on_enrolment_tutor_changed() from public, anon, authenticated;
create trigger enrolments_tutor_pay_reset after update of tutor_id on public.enrolments
  for each row when (new.tutor_id is distinct from old.tutor_id)
  execute function public.on_enrolment_tutor_changed();

-- ---------------------------------------------------------------------------
-- Charges: each student is charged their own price (snapshot on the charge)
-- ---------------------------------------------------------------------------

/** Create charges for a lesson that happened / was late-cancelled. Mirrors chargesForLesson() in src/domain/billing.ts. */
create or replace function public.apply_charges(p_lesson_id uuid, p_attendance jsonb default '{}')
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
  fp record;
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

    -- A package is prepaid lessons, so its credits are still drawn first for full-fee lessons.
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
      insert into public.charges (lesson_id, student_id, family_id, description, amount, status, package_id, date, price_source, hourly_price)
      values (l.id, sid, st.family_id,
              svc.name || ' — ' || st.full_name || ', ' || to_char(l.start_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') || label,
              0, 'package', pkg.id, l.start_at, 'service', null);
    else
      select * into fp from public.lesson_family_price(l.id, sid);
      insert into public.charges (lesson_id, student_id, family_id, description, amount, status, date, price_source, hourly_price)
      values (l.id, sid, st.family_id,
              svc.name || ' — ' || st.full_name || ', ' || to_char(l.start_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') || label,
              round(fp.amount * fee, 2), 'unbilled', l.start_at, fp.source, fp.hourly_price);
    end if;
  end loop;
end $$;
revoke all on function public.apply_charges(uuid, jsonb) from public, anon, authenticated;
comment on function public.apply_charges(uuid, jsonb) is
  'Charges each student in a lesson their own price (custom family price x hours, or the service price), after drawing a package credit for full-fee lessons. '
  'Snapshot rule: amount, price_source and hourly_price are fixed when the charge is created.';

-- ---------------------------------------------------------------------------
-- Tutor invoices: each lesson line uses the lesson's effective rate
-- ---------------------------------------------------------------------------

/** Build (or rebuild) a tutor's invoice for a month from the lessons they taught. Extra lines are kept. */
create or replace function public.create_tutor_invoice(p_tutor_id uuid, p_month date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.tutors; s public.settings; inv public.tutor_invoices;
  first date := date_trunc('month', p_month)::date;
  last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  lesson_items jsonb; extras jsonb;
begin
  if not (public.is_admin() or public.my_tutor_id() = p_tutor_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into t from public.tutors where id = p_tutor_id;
  select * into s from public.settings where id = 1;
  select * into inv from public.tutor_invoices where tutor_id = p_tutor_id and period_start = first for update;
  if inv.id is not null and inv.status not in ('draft', 'rejected') then
    raise exception 'This month''s invoice has already been submitted';
  end if;
  if inv.id is null then
    insert into public.tutor_invoices (tutor_id, number, period_start, period_end)
    values (p_tutor_id, 'TI-' || to_char(first, 'YYYYMM') || '-' || upper(left(replace(p_tutor_id::text, '-', ''), 4)), first, last)
    returning * into inv;
  end if;
  -- Release lessons previously attached to this draft, then claim this month's paid lessons.
  update public.lessons set tutor_invoice_id = null where tutor_invoice_id = inv.id;
  update public.lessons l set tutor_invoice_id = inv.id
  where l.tutor_id = p_tutor_id and l.tutor_invoice_id is null
    and (l.start_at at time zone 'Asia/Dubai')::date between first and last
    and (l.status in ('completed', 'no-show') or (l.status = 'late-cancel' and s.pay_tutor_for_late_cancel));
  select coalesce(jsonb_agg(jsonb_build_object(
      'description', to_char(l.start_at at time zone 'Asia/Dubai', 'DD Mon') || ' — ' || svc.name || ' — '
        || (select string_agg(split_part(st.full_name, ' ', 1), ' & ') from public.students st where st.id = any (l.student_ids))
        || case when l.status = 'completed' then '' else ' (' || l.status || ')' end,
      'quantity', round(extract(epoch from (l.end_at - l.start_at)) / 3600, 2),
      'unitPrice', r.rate,
      'rateSource', r.source,
      'lessonId', l.id) order by l.start_at), '[]')
    into lesson_items
  from public.lessons l join public.services svc on svc.id = l.service_id
  cross join lateral public.lesson_tutor_rate(l.id) r
  where l.tutor_invoice_id = inv.id;
  select coalesce(jsonb_agg(i), '[]') into extras from jsonb_array_elements(inv.items) i where not (i ? 'lessonId');
  update public.tutor_invoices set items = lesson_items || extras, status = 'draft' where id = inv.id;
  return inv.id;
end $$;
comment on function public.create_tutor_invoice(uuid, date) is
  'Builds or rebuilds a tutor''s draft invoice for a month. Each lesson line uses lesson_tutor_rate (rateSource usual or custom; group lessons pay the highest rate). '
  'Snapshot rule: submitted, approved and paid invoices are never rebuilt, so their lines keep the rate they were submitted with.';

-- ---------------------------------------------------------------------------
-- Awarding a role sets the student's enrolment tutor and pay
-- ---------------------------------------------------------------------------

create or replace function public.award_opportunity(p_bid_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.opportunity_bids; o public.opportunities; other record; e public.enrolments;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into b from public.opportunity_bids where id = p_bid_id;
  if b is null or b.status <> 'pending' then raise exception 'That bid is no longer available'; end if;
  select * into o from public.opportunities where id = b.opportunity_id for update;
  if o.status <> 'open' then raise exception 'This opportunity has already been awarded or closed'; end if;
  update public.opportunities set status = 'awarded', awarded_tutor_id = b.tutor_id, awarded_at = now() where id = o.id;
  update public.opportunity_bids set status = 'awarded' where id = b.id;
  perform public.notify_tutor(b.tutor_id, 'You''ve been chosen: ' || o.title,
    'Great news — you''ve been chosen for ' || o.title || '. Elite Education will schedule the first lesson with you shortly.',
    'You got it!', o.title, '/opportunities/' || o.id);
  for other in update public.opportunity_bids set status = 'declined'
               where opportunity_id = o.id and id <> b.id and status = 'pending' returning tutor_id loop
    perform public.notify_tutor(other.tutor_id, 'Update on ' || o.title,
      'Thanks for your interest in ' || o.title || '. On this occasion it has gone to another tutor — keep an eye out for new opportunities.',
      'Opportunity update', o.title || ' has been filled', '/opportunities', false);
  end loop;

  -- The winning tutor teaches the student's enrolment in this subject, at the role's pay.
  if o.student_id is not null then
    if nullif(trim(o.subject), '') is not null then
      select * into e from public.enrolments x
      where x.student_id = o.student_id and x.active and lower(trim(x.subject)) = lower(trim(o.subject))
      order by x.subject, public.enrolment_title(x.subject, x.curriculum, x.level)
      limit 1;
      if e.id is null then
        insert into public.enrolments (student_id, subject, curriculum, tutor_id)
        values (o.student_id, left(trim(o.subject), 80), left(nullif(trim(o.curriculum), ''), 80), b.tutor_id)
        returning * into e;
      end if;
    elsif (select count(*) from public.enrolments x where x.student_id = o.student_id and x.active) = 1 then
      select * into e from public.enrolments x where x.student_id = o.student_id and x.active;
    end if;
    if e.id is not null then
      -- Change the tutor first: the tutor-change trigger clears any earlier tutor's pay.
      update public.enrolments set tutor_id = b.tutor_id where id = e.id;
      if o.pay_rate < 100000 then
        insert into public.enrolment_tutor_pay (enrolment_id, hourly_pay, source, opportunity_id, updated_at)
        values (e.id, o.pay_rate, 'opportunity', o.id, now())
        on conflict (enrolment_id) do update set
          hourly_pay = excluded.hourly_pay, source = 'opportunity', opportunity_id = excluded.opportunity_id, updated_at = now();
      end if;
    end if;
  end if;
end $$;
comment on function public.award_opportunity(uuid) is
  'Awards a role to a bid. When the role names a student, the student''s enrolment in the role''s subject (created if missing) '
  'is given the winning tutor and the role''s pay as custom pay (source opportunity).';
