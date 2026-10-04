-- Elite Education — running the business in one place:
-- roles tutors bid for, hiring, tutor bank details, tutor invoices, student reports and expenses.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** Notify every login belonging to a tutor (their tutor account, or an admin who also teaches). */
create function public.notify_tutor(
  p_tutor_id uuid, p_subject text, p_body text, p_push_title text, p_push_body text, p_url text, p_send_email boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select id, email from public.profiles where tutor_id = p_tutor_id and role in ('tutor', 'admin') loop
    perform public.notify(p.id, p.email, p_subject, p_body, p_push_title, p_push_body, p_url, p_send_email);
  end loop;
end $$;
revoke all on function public.notify_tutor(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Roles tutors bid for (student placements)
-- ---------------------------------------------------------------------------

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 4000),
  curriculum text,
  syllabus_id text,
  student_id uuid references public.students(id) on delete set null,
  enquiry_id uuid references public.enquiries(id) on delete set null,
  schedule text check (length(schedule) <= 500),
  location text check (length(location) <= 200),
  pay_rate numeric(10,2) not null check (pay_rate >= 0),
  closes_on date,
  status text not null default 'open' check (status in ('open', 'awarded', 'closed')),
  visibility text not null default 'all' check (visibility in ('all', 'invited')),
  invited_tutor_ids uuid[] not null default '{}',
  awarded_tutor_id uuid references public.tutors(id) on delete set null,
  awarded_at timestamptz
);

create table public.opportunity_bids (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  pitch text not null check (length(pitch) between 1 and 2000),
  availability text check (length(availability) <= 500),
  status text not null default 'pending' check (status in ('pending', 'awarded', 'declined', 'withdrawn')),
  unique (opportunity_id, tutor_id)
);

create function public.can_see_opportunity(o public.opportunities) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin()
    or (public.my_tutor_id() is not null and (
      (o.status = 'open' and (o.visibility = 'all' or public.my_tutor_id() = any (o.invited_tutor_ids)))
      or o.awarded_tutor_id = public.my_tutor_id()
      or exists (select 1 from public.opportunity_bids b where b.opportunity_id = o.id and b.tutor_id = public.my_tutor_id()))),
    false)
$$;

create function public.on_opportunity_posted() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.status <> 'open' then return new; end if;
  for t in select id from public.tutors
           where new.visibility = 'all' or id = any (new.invited_tutor_ids) loop
    perform public.notify_tutor(t.id, 'New student opportunity: ' || new.title,
      coalesce(new.description || E'\n\n', '') || coalesce('When: ' || new.schedule || E'\n', '')
        || coalesce('Where: ' || new.location || E'\n', '') || 'Pay: AED ' || to_char(new.pay_rate, 'FM999,990') || ' per hour'
        || coalesce(E'\nApply by ' || to_char(new.closes_on, 'DD Mon'), '') || E'\n\nExpress interest in the Elite Education app.',
      'New opportunity', new.title, '/opportunities/' || new.id);
  end loop;
  return new;
end $$;
create trigger opportunities_notify after insert on public.opportunities
  for each row execute function public.on_opportunity_posted();

create function public.place_bid(p_opportunity_id uuid, p_pitch text, p_availability text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.opportunities; me uuid := public.my_tutor_id(); t public.tutors;
begin
  if me is null then raise exception 'Only tutors can express interest' using errcode = '42501'; end if;
  select * into o from public.opportunities where id = p_opportunity_id;
  if o is null or not public.can_see_opportunity(o) then raise exception 'Opportunity not found'; end if;
  if o.status <> 'open' or (o.closes_on is not null and o.closes_on < (now() at time zone 'Asia/Dubai')::date) then
    raise exception 'This opportunity has closed';
  end if;
  if nullif(trim(p_pitch), '') is null then raise exception 'Tell us why you''d be a great fit'; end if;
  insert into public.opportunity_bids (opportunity_id, tutor_id, pitch, availability)
  values (o.id, me, trim(p_pitch), nullif(trim(p_availability), ''))
  on conflict (opportunity_id, tutor_id) do update
    set pitch = excluded.pitch, availability = excluded.availability, status = 'pending', created_at = now();
  select * into t from public.tutors where id = me;
  perform public.notify_admins('Interest in ' || o.title || ' from ' || t.full_name, trim(p_pitch),
    'New interest', t.full_name || ' — ' || o.title, '/manage/opportunity/' || o.id);
end $$;

create function public.withdraw_bid(p_opportunity_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.opportunity_bids set status = 'withdrawn'
  where opportunity_id = p_opportunity_id and tutor_id = public.my_tutor_id() and status = 'pending';
  if not found then raise exception 'Nothing to withdraw'; end if;
end $$;

create function public.award_opportunity(p_bid_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.opportunity_bids; o public.opportunities; other record;
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
end $$;

-- ---------------------------------------------------------------------------
-- Hiring: public applications to join as a tutor
-- ---------------------------------------------------------------------------

create table public.tutor_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null check (length(full_name) between 1 and 200),
  email text not null check (length(email) between 3 and 200),
  phone text check (length(phone) <= 50),
  curricula text[] not null default '{}',
  subjects text check (length(subjects) <= 500),
  experience text check (length(experience) <= 4000),
  qualifications text check (length(qualifications) <= 2000),
  availability text check (length(availability) <= 1000),
  cv_path text,
  status text not null default 'applied' check (status in ('applied', 'interview', 'offer', 'hired', 'rejected')),
  notes text,
  tutor_id uuid references public.tutors(id) on delete set null
);

create function public.submit_tutor_application(
  p_full_name text, p_email text, p_phone text, p_curricula text[], p_subjects text,
  p_experience text, p_qualifications text, p_availability text, p_cv_path text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if nullif(trim(p_full_name), '') is null then raise exception 'Please enter your name'; end if;
  if nullif(trim(p_email), '') is null or position('@' in p_email) = 0 then raise exception 'Please enter a valid email address'; end if;
  if (select count(*) from public.tutor_applications where lower(email) = lower(trim(p_email)) and created_at > now() - interval '30 days') >= 2 then
    raise exception 'We already have your application — we''ll be in touch soon';
  end if;
  insert into public.tutor_applications (full_name, email, phone, curricula, subjects, experience, qualifications, availability, cv_path)
  values (trim(p_full_name), lower(trim(p_email)), nullif(trim(p_phone), ''), coalesce(p_curricula, '{}'), nullif(trim(p_subjects), ''),
          nullif(trim(p_experience), ''), nullif(trim(p_qualifications), ''), nullif(trim(p_availability), ''), nullif(p_cv_path, ''))
  returning id into aid;
  perform public.notify_admins('Tutor application: ' || trim(p_full_name),
    trim(p_full_name) || ' (' || lower(trim(p_email)) || ') applied to teach ' || coalesce(array_to_string(p_curricula, ', '), '')
      || coalesce(E'\n\n' || nullif(trim(p_experience), ''), ''),
    'New tutor application', trim(p_full_name), '/manage/applications');
  perform public.notify(null, lower(trim(p_email)), 'Thanks for applying to Elite Education',
    'Hi ' || split_part(trim(p_full_name), ' ', 1) || E',\n\nThanks for applying to teach with Elite Education. We review every application and will be in touch soon.\n\nElite Education');
  return aid;
end $$;

-- ---------------------------------------------------------------------------
-- Tutor bank details (replaces the Google Form). Never included in notifications.
-- ---------------------------------------------------------------------------

create table public.tutor_payment_details (
  tutor_id uuid primary key references public.tutors(id) on delete cascade,
  account_name text not null check (length(account_name) between 1 and 200),
  bank_name text not null check (length(bank_name) between 1 and 200),
  iban text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  swift text check (swift is null or swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tutor invoices: monthly submit → approve → pay
-- ---------------------------------------------------------------------------

create table public.tutor_invoices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  number text not null unique,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  -- [{ description, quantity, unitPrice, lessonId? }]
  items jsonb not null default '[]',
  notes text,
  admin_comment text,
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  unique (tutor_id, period_start)
);

alter table public.lessons add column tutor_invoice_id uuid references public.tutor_invoices(id) on delete set null;

create function public.tutor_invoice_total(inv public.tutor_invoices) returns numeric
language sql stable as $$
  select round(coalesce(sum((i->>'quantity')::numeric * (i->>'unitPrice')::numeric), 0), 2)
  from jsonb_array_elements(inv.items) i
$$;

/** Build (or rebuild) a tutor's invoice for a month from the lessons they taught. Extra lines are kept. */
create function public.create_tutor_invoice(p_tutor_id uuid, p_month date)
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
      'unitPrice', t.hourly_pay,
      'lessonId', l.id) order by l.start_at), '[]')
    into lesson_items
  from public.lessons l join public.services svc on svc.id = l.service_id
  where l.tutor_invoice_id = inv.id;
  select coalesce(jsonb_agg(i), '[]') into extras from jsonb_array_elements(inv.items) i where not (i ? 'lessonId');
  update public.tutor_invoices set items = lesson_items || extras, status = 'draft' where id = inv.id;
  return inv.id;
end $$;

create function public.update_tutor_invoice(p_id uuid, p_extras jsonb, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.tutor_invoices; e jsonb; clean jsonb := '[]';
begin
  select * into inv from public.tutor_invoices where id = p_id for update;
  if inv is null or not (public.is_admin() or inv.tutor_id = public.my_tutor_id()) then raise exception 'Invoice not found'; end if;
  if inv.status not in ('draft', 'rejected') then raise exception 'Submitted invoices can''t be edited'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_extras, '[]')) loop
    if nullif(trim(e->>'description'), '') is null or (e->>'quantity')::numeric <= 0 or (e->>'unitPrice')::numeric < 0 then
      raise exception 'Each extra line needs a description, a quantity and a price';
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('description', trim(e->>'description'),
      'quantity', (e->>'quantity')::numeric, 'unitPrice', (e->>'unitPrice')::numeric));
  end loop;
  update public.tutor_invoices
  set items = (select coalesce(jsonb_agg(i), '[]') from jsonb_array_elements(inv.items) i where i ? 'lessonId') || clean,
      notes = nullif(trim(p_notes), '')
  where id = p_id;
end $$;

create function public.submit_tutor_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.tutor_invoices; t public.tutors;
begin
  select * into inv from public.tutor_invoices where id = p_id for update;
  if inv is null or inv.tutor_id is distinct from public.my_tutor_id() then raise exception 'Invoice not found' using errcode = '42501'; end if;
  if inv.status not in ('draft', 'rejected') then raise exception 'This invoice has already been submitted'; end if;
  if jsonb_array_length(inv.items) = 0 then raise exception 'There''s nothing on this invoice yet'; end if;
  update public.tutor_invoices set status = 'submitted', submitted_at = now(), admin_comment = null where id = p_id;
  select * into t from public.tutors where id = inv.tutor_id;
  perform public.notify_admins('Tutor invoice from ' || t.full_name,
    t.full_name || ' submitted ' || inv.number || ' for AED ' || to_char(public.tutor_invoice_total(inv), 'FM999,999,990.00') || '.',
    'Tutor invoice to approve', t.full_name || ' — AED ' || to_char(public.tutor_invoice_total(inv), 'FM999,990'), '/manage/tutor-invoice/' || inv.id);
end $$;

create function public.review_tutor_invoice(p_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.tutor_invoices;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into inv from public.tutor_invoices where id = p_id for update;
  if inv is null or inv.status <> 'submitted' then raise exception 'Only submitted invoices can be reviewed'; end if;
  update public.tutor_invoices
  set status = case when p_approve then 'approved' else 'rejected' end,
      approved_at = case when p_approve then now() end, admin_comment = nullif(trim(p_comment), '')
  where id = p_id;
  perform public.notify_tutor(inv.tutor_id,
    'Invoice ' || inv.number || case when p_approve then ' approved' else ' needs changes' end,
    case when p_approve then 'Your invoice has been approved and will be paid soon.'
         else 'Please check your invoice and resubmit.' end || coalesce(E'\n\n' || nullif(trim(p_comment), ''), ''),
    case when p_approve then 'Invoice approved' else 'Invoice needs changes' end, inv.number, '/tutor-invoices/' || inv.id);
end $$;

create function public.mark_tutor_invoice_paid(p_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.tutor_invoices;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into inv from public.tutor_invoices where id = p_id for update;
  if inv is null or inv.status <> 'approved' then raise exception 'Only approved invoices can be marked paid'; end if;
  update public.tutor_invoices set status = 'paid', paid_at = now(), payment_reference = nullif(trim(p_reference), '') where id = p_id;
  perform public.notify_tutor(inv.tutor_id, 'Payment sent: ' || inv.number,
    'AED ' || to_char(public.tutor_invoice_total(inv), 'FM999,999,990.00') || ' has been paid' || coalesce(' (ref ' || nullif(trim(p_reference), '') || ')', '') || '.',
    'Payment sent', 'AED ' || to_char(public.tutor_invoice_total(inv), 'FM999,990') || ' for ' || inv.number, '/tutor-invoices/' || inv.id);
end $$;

-- ---------------------------------------------------------------------------
-- Student reports
-- ---------------------------------------------------------------------------

create table public.report_cycles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(name) between 1 and 200),
  starts_on date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'closed'))
);

create table public.student_reports (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.report_cycles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id),
  attainment text check (length(attainment) <= 20),
  effort smallint check (effort between 1 and 5),
  progress smallint check (progress between 1 and 5),
  strengths text check (length(strengths) <= 3000),
  next_steps text check (length(next_steps) <= 3000),
  comment text check (length(comment) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'published')),
  ai_assisted boolean not null default false,
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  published_at timestamptz,
  unique (cycle_id, student_id)
);

/** Start a report round: one draft per student taught since `p_starts_on`, assigned to their main tutor. */
create function public.open_report_cycle(p_name text, p_starts_on date, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; t record;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.report_cycles (name, starts_on, due_date) values (trim(p_name), p_starts_on, p_due) returning id into cid;
  insert into public.student_reports (cycle_id, student_id, tutor_id)
  select cid, x.student_id, x.tutor_id from (
    select sid as student_id, l.tutor_id,
           row_number() over (partition by sid order by count(*) desc, max(l.start_at) desc) as rk
    from public.lessons l, unnest(l.student_ids) sid
    where l.start_at >= p_starts_on and l.status in ('completed', 'no-show', 'scheduled')
    group by sid, l.tutor_id) x
  where x.rk = 1;
  for t in select tutor_id, count(*) n from public.student_reports where cycle_id = cid group by tutor_id loop
    perform public.notify_tutor(t.tutor_id, 'Reports to write: ' || trim(p_name),
      'You have ' || t.n || ' report' || case when t.n = 1 then '' else 's' end || ' to write, due ' || to_char(p_due, 'DD Mon') ||
      '. Each one is prefilled with attendance, homework and topic progress — and you can draft the comments with AI.',
      'Reports to write', t.n || ' due ' || to_char(p_due, 'DD Mon'), '/reports');
  end loop;
  return cid;
end $$;

create function public.save_report(
  p_id uuid, p_attainment text, p_effort smallint, p_progress smallint,
  p_strengths text, p_next_steps text, p_comment text, p_ai_assisted boolean
) returns void language plpgsql security definer set search_path = public as $$
declare r public.student_reports;
begin
  select * into r from public.student_reports where id = p_id for update;
  if r is null or not (public.is_admin() or r.tutor_id = public.my_tutor_id()) then raise exception 'Report not found' using errcode = '42501'; end if;
  if r.status = 'published' or (not public.is_admin() and r.status not in ('draft', 'submitted')) then
    raise exception 'This report can no longer be edited';
  end if;
  update public.student_reports set attainment = nullif(trim(p_attainment), ''), effort = p_effort, progress = p_progress,
    strengths = nullif(trim(p_strengths), ''), next_steps = nullif(trim(p_next_steps), ''), comment = nullif(trim(p_comment), ''),
    ai_assisted = r.ai_assisted or coalesce(p_ai_assisted, false), updated_at = now()
  where id = p_id;
end $$;

create function public.submit_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.student_reports;
begin
  select * into r from public.student_reports where id = p_id for update;
  if r is null or not (public.is_admin() or r.tutor_id = public.my_tutor_id()) then raise exception 'Report not found' using errcode = '42501'; end if;
  if r.status <> 'draft' then raise exception 'This report has already been submitted'; end if;
  if r.comment is null or r.effort is null or r.progress is null then raise exception 'Add effort, progress and a comment before submitting'; end if;
  update public.student_reports set status = 'submitted', submitted_at = now() where id = p_id;
end $$;

create function public.set_report_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.student_reports; c public.report_cycles; st public.students;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_status not in ('draft', 'approved', 'published') then raise exception 'Invalid status'; end if;
  select * into r from public.student_reports where id = p_id for update;
  if r is null then raise exception 'Report not found'; end if;
  if p_status = 'published' and r.status not in ('submitted', 'approved') then raise exception 'Only finished reports can be published'; end if;
  update public.student_reports set status = p_status, published_at = case when p_status = 'published' then now() end where id = p_id;
  if p_status = 'published' then
    select * into c from public.report_cycles where id = r.cycle_id;
    select * into st from public.students where id = r.student_id;
    perform public.notify_family(st.family_id, c.name || ' report for ' || split_part(st.full_name, ' ', 1),
      split_part(st.full_name, ' ', 1) || '''s ' || c.name || ' report is ready to read in the Elite Education app.',
      'New report', split_part(st.full_name, ' ', 1) || ' — ' || c.name, '/parent/progress', true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Expenses (admin only)
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  date date not null,
  category text not null check (length(category) between 1 and 100),
  description text check (length(description) <= 500),
  amount numeric(10,2) not null check (amount >= 0),
  vat_amount numeric(10,2) not null default 0 check (vat_amount >= 0),
  receipt_path text
);
create index expenses_date_idx on public.expenses (date);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.opportunities enable row level security;
alter table public.opportunity_bids enable row level security;
alter table public.tutor_applications enable row level security;
alter table public.tutor_payment_details enable row level security;
alter table public.tutor_invoices enable row level security;
alter table public.report_cycles enable row level security;
alter table public.student_reports enable row level security;
alter table public.expenses enable row level security;

create policy "see opportunities" on public.opportunities for select to authenticated using (public.can_see_opportunity(opportunities));
create policy "admin opportunities" on public.opportunities for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "see bids" on public.opportunity_bids for select to authenticated using (public.is_admin() or tutor_id = public.my_tutor_id());

create policy "admin applications" on public.tutor_applications for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "own bank details" on public.tutor_payment_details for all to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id())
  with check (public.is_admin() or tutor_id = public.my_tutor_id());

create policy "see tutor invoices" on public.tutor_invoices for select to authenticated using (public.is_admin() or tutor_id = public.my_tutor_id());

create policy "see report cycles" on public.report_cycles for select to authenticated using (true);
create policy "admin report cycles" on public.report_cycles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "see reports" on public.student_reports for select to authenticated
  using (public.is_admin() or tutor_id = public.my_tutor_id()
         or (status = 'published' and public.my_role() in ('parent', 'student') and student_id = any (public.visible_student_ids())));

create policy "admin expenses" on public.expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.opportunities, public.opportunity_bids, public.tutor_applications, public.tutor_payment_details,
  public.tutor_invoices, public.report_cycles, public.student_reports, public.expenses to authenticated;
revoke all on public.opportunities, public.opportunity_bids, public.tutor_applications, public.tutor_payment_details,
  public.tutor_invoices, public.report_cycles, public.student_reports, public.expenses from anon;

grant execute on function public.can_see_opportunity(public.opportunities), public.tutor_invoice_total(public.tutor_invoices),
  public.place_bid(uuid, text, text), public.withdraw_bid(uuid), public.award_opportunity(uuid),
  public.create_tutor_invoice(uuid, date), public.update_tutor_invoice(uuid, jsonb, text), public.submit_tutor_invoice(uuid),
  public.review_tutor_invoice(uuid, boolean, text), public.mark_tutor_invoice_paid(uuid, text),
  public.open_report_cycle(text, date, date), public.save_report(uuid, text, smallint, smallint, text, text, text, boolean),
  public.submit_report(uuid), public.set_report_status(uuid, text) to authenticated;
grant execute on function public.submit_tutor_application(text, text, text, text[], text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- File storage (Supabase Storage). Skipped where the storage schema doesn't exist (local tests).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('applications', 'applications', false), ('receipts', 'receipts', false)
    on conflict (id) do nothing;
    -- Applicants (not signed in) may upload a CV but nobody except admins can read them back.
    execute $p$create policy "upload cv" on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'applications' and (storage.foldername(name))[1] = 'cv')$p$;
    execute $p$create policy "admin reads cvs" on storage.objects for select to authenticated
      using (bucket_id = 'applications' and public.is_admin())$p$;
    execute $p$create policy "admin receipts" on storage.objects for all to authenticated
      using (bucket_id = 'receipts' and public.is_admin()) with check (bucket_id = 'receipts' and public.is_admin())$p$;
  end if;
end $$;
