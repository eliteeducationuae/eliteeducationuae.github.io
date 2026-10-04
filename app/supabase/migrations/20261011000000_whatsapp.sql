-- Elite Education — WhatsApp reminders: opt-in on profiles, a WhatsApp channel on the notification outbox, and daily reminder queueing.
-- Messages use pre-approved WhatsApp templates. Bodies never carry bank details; families pay through the app.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column whatsapp_opt_in boolean not null default false,
  add column whatsapp_number text check (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  add column whatsapp_opted_in_at timestamptz,
  add constraint profiles_whatsapp_needs_number check (not whatsapp_opt_in or whatsapp_number is not null);

alter table public.notification_outbox
  add column whatsapp boolean not null default false,
  add column whatsapp_to text,
  add column whatsapp_template text
    check (whatsapp_template in ('lesson_reminder', 'lesson_notes', 'invoice_sent', 'invoice_overdue', 'homework_due')),
  add column whatsapp_vars jsonb not null default '{}',
  add column whatsapp_status text check (whatsapp_status in ('pending', 'sent', 'skipped', 'failed')),
  add column whatsapp_sent_at timestamptz,
  add column whatsapp_sid text,
  add constraint outbox_whatsapp_complete
    check (not whatsapp or (whatsapp_to is not null and whatsapp_template is not null and whatsapp_status is not null));
create index notification_outbox_whatsapp_pending_idx on public.notification_outbox (created_at)
  where whatsapp and whatsapp_status = 'pending';

-- One reminder of each kind per lesson, invoice and piece of homework.
alter table public.lessons add column whatsapp_reminded_at timestamptz;
alter table public.invoices add column overdue_whatsapp_at timestamptz;
alter table public.homework add column due_whatsapp_at timestamptz;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

/** The approved body of each WhatsApp template; {{n}} placeholders are filled from the message variables. */
create function public.whatsapp_template_body(p_template text) returns text
language sql immutable set search_path = public as $$
  select case p_template
    when 'lesson_reminder' then
      'Dear {{1}}, this is a reminder that {{2}} has a lesson with {{3}} on {{4}} (UAE time). Elite Education | eliteeducation.me'
    when 'lesson_notes' then
      'Dear {{1}}, the lesson notes for {{2}} from {{3}} are now ready in the Elite Education app. Elite Education | eliteeducation.me'
    when 'invoice_sent' then
      'Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app and is due by {{4}}. Elite Education | eliteeducation.me'
    when 'invoice_overdue' then
      'Dear {{1}}, invoice {{2}} for {{3}} was due on {{4}} and remains unpaid. You may view and pay it in the Elite Education app. '
        || 'If you have already paid, please disregard this message. Elite Education | eliteeducation.me'
    when 'homework_due' then
      'Dear {{1}}, this is a reminder that {{2}} has homework due on {{3}}: {{4}}. Elite Education | eliteeducation.me'
  end
$$;

/**
 * WhatsApp variables must be single-line: whitespace runs (newlines, tabs) become one space, then trimmed.
 * Template braces are removed too, so a value such as a homework title can never introduce a placeholder of its own.
 */
create function public.whatsapp_clean(p_text text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(p_text, '\{\{|\}\}', '', 'g'), '\s+', ' ', 'g'))
$$;

/** House style for several names: 'Omar', 'Omar and Layla', 'Omar, Layla and Sami' (as joinNames in src/domain/greeting.ts). */
create function public.whatsapp_join_names(p_names text[]) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(cardinality(p_names), 0) = 0 then ''
    when cardinality(p_names) = 1 then p_names[1]
    else array_to_string(p_names[1:cardinality(p_names) - 1], ', ') || ' and ' || p_names[cardinality(p_names)]
  end
$$;

/** The first name to greet someone by: honorifics such as Mrs, Dr or Sheikha are set aside. Empty when there is no name. */
create function public.whatsapp_first_name(p_full_name text) returns text
language sql immutable set search_path = public as $$
  select split_part(regexp_replace(public.whatsapp_clean(coalesce(p_full_name, '')),
    '^((mr|mrs|ms|miss|mx|dr|prof|sheikh|sheikha|sheikhah)\.?\s+)+', '', 'i'), ' ', 1)
$$;

/** The message as the recipient will read it: the template body with each {{n}} replaced by p_vars->>n. */
create function public.whatsapp_preview(p_template text, p_vars jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare msg text := public.whatsapp_template_body(p_template); v record;
begin
  for v in select key, value from jsonb_each_text(coalesce(p_vars, '{}')) loop
    msg := replace(msg, '{{' || v.key || '}}', coalesce(v.value, ''));
  end loop;
  return msg;
end $$;

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

/**
 * Queue one WhatsApp message for a parent, tutor or admin who has opted in. Returns whether a message was queued.
 * {{1}} is always the recipient's first name. When the profile has no name, the family's or tutor's record is used if it is
 * clearly the same person; failing that nothing is queued, since a message without a name would be refused anyway.
 */
create function public.queue_whatsapp(p_profile_id uuid, p_template text, p_vars jsonb, p_url text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.profiles; vars jsonb; first_name text;
begin
  select * into p from public.profiles where id = p_profile_id;
  if p.id is null or p.role not in ('parent', 'tutor', 'admin') or not p.whatsapp_opt_in or p.whatsapp_number is null then
    return false;
  end if;
  first_name := nullif(public.whatsapp_first_name(p.full_name), '');
  if first_name is null and p.family_id is not null then
    select nullif(public.whatsapp_first_name(f.parent_name), '') into first_name
      from public.families f where f.id = p.family_id and lower(f.email) = lower(p.email);
  end if;
  if first_name is null and p.tutor_id is not null then
    select nullif(public.whatsapp_first_name(t.full_name), '') into first_name from public.tutors t where t.id = p.tutor_id;
  end if;
  if first_name is null then return false; end if;
  select coalesce(jsonb_object_agg(key, coalesce(public.whatsapp_clean(value), '')), '{}') into vars
    from jsonb_each_text(coalesce(p_vars, '{}') || jsonb_build_object('1', first_name));
  insert into public.notification_outbox (profile_id, email, subject, body, push_title, push_body, url, send_email,
    whatsapp, whatsapp_to, whatsapp_template, whatsapp_vars, whatsapp_status)
  values (p.id, null,
    case p_template
      when 'lesson_reminder' then 'WhatsApp: lesson reminder'
      when 'lesson_notes' then 'WhatsApp: lesson notes'
      when 'invoice_sent' then 'WhatsApp: invoice sent'
      when 'invoice_overdue' then 'WhatsApp: invoice overdue'
      when 'homework_due' then 'WhatsApp: homework due'
    end,
    public.whatsapp_preview(p_template, vars), null, null, p_url, false,
    true, p.whatsapp_number, p_template, vars, 'pending');
  return true;
end $$;

/** Queue a WhatsApp message for every opted-in parent of a family. Returns how many were queued. */
create function public.queue_whatsapp_family(p_family_id uuid, p_template text, p_vars jsonb, p_url text default null)
returns int language plpgsql security definer set search_path = public as $$
declare p record; n int := 0;
begin
  for p in select id from public.profiles where family_id = p_family_id and role = 'parent' order by id loop
    if public.queue_whatsapp(p.id, p_template, p_vars, p_url) then n := n + 1; end if;
  end loop;
  return n;
end $$;

/**
 * Variables shared by invoice_sent and invoice_overdue: number, amount and due date. Never bank details.
 * invoice_sent quotes the full total; the overdue chase (p_outstanding) quotes what is still owed after any part payments.
 */
create function public.whatsapp_invoice_vars(inv public.invoices, p_outstanding boolean default false) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('2', inv.number,
    '3', 'AED ' || to_char(greatest(public.invoice_total(inv)
      - case when p_outstanding then (select coalesce(sum(pm.amount), 0) from public.payments pm where pm.invoice_id = inv.id) else 0 end,
      0), 'FM999,999,990.00'),
    '4', to_char(inv.due_date, 'FMDD Mon YYYY'))
$$;

-- Invoices: a WhatsApp alongside the email when one is sent. Separate from on_invoice_sent on purpose.
create function public.on_invoice_sent_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.queue_whatsapp_family(new.family_id, 'invoice_sent', public.whatsapp_invoice_vars(new), '/invoice/' || new.id);
  end if;
  return new;
end $$;
create trigger invoices_whatsapp after insert or update of status on public.invoices
  for each row execute function public.on_invoice_sent_whatsapp();

-- Lesson notes: tell each family's opted-in parents once a completed lesson is written up.
create function public.on_lesson_notes_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare l public.lessons; fam uuid; names text;
begin
  select * into l from public.lessons where id = new.lesson_id;
  if l.id is null or l.status <> 'completed' then return new; end if;
  for fam in select distinct st.family_id from public.students st where st.id = any (l.student_ids) loop
    select public.whatsapp_join_names(array_agg(split_part(st.full_name, ' ', 1) order by array_position(l.student_ids, st.id))) into names
      from public.students st where st.id = any (l.student_ids) and st.family_id = fam;
    perform public.queue_whatsapp_family(fam, 'lesson_notes',
      jsonb_build_object('2', names, '3', to_char(l.start_at at time zone 'Asia/Dubai', 'FMDD Mon')), '/lesson/' || l.id);
  end loop;
  return new;
end $$;
create trigger lesson_notes_whatsapp after insert on public.lesson_notes
  for each row execute function public.on_lesson_notes_whatsapp();

/**
 * Reminders, called hourly by the send-reminders Edge Function with the service-role key:
 * lessons starting in 2–25 hours, invoices up to 30 days overdue, and homework due tomorrow (Dubai dates).
 * Quiet hours (UAE time): lesson reminders are queued only from 08:00 to 20:59, and overdue chases and homework
 * reminders only from 09:00 to 19:59, so nobody is messaged late at night. Items are marked only when they are
 * queued, so anything held back is picked up by the next run in the window.
 * Each item is reminded once. Returns the number of WhatsApp messages queued.
 */
create function public.queue_whatsapp_reminders(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := (p_now at time zone 'Asia/Dubai')::date;
  local_hour int := extract(hour from p_now at time zone 'Asia/Dubai')::int;
  n int := 0; l record; p record; fam uuid; names text; inv public.invoices; h record;
begin
  -- a. Lessons, 08:00 to 20:59
  if local_hour between 8 and 20 then
    for l in
      select ls.*, t.full_name as tutor_name from public.lessons ls join public.tutors t on t.id = ls.tutor_id
      where ls.status = 'scheduled' and ls.whatsapp_reminded_at is null
        and ls.start_at > p_now + interval '2 hours' and ls.start_at <= p_now + interval '25 hours'
      order by ls.start_at
      for update of ls
    loop
      select public.whatsapp_join_names(array_agg(split_part(st.full_name, ' ', 1) order by array_position(l.student_ids, st.id))) into names
        from public.students st where st.id = any (l.student_ids);
      for p in select id from public.profiles where tutor_id = l.tutor_id and role in ('tutor', 'admin') order by id loop
        if public.queue_whatsapp(p.id, 'lesson_reminder', jsonb_build_object('2', names, '3', 'you',
             '4', to_char(l.start_at at time zone 'Asia/Dubai', 'Dy FMDD Mon, HH24:MI')), '/lesson/' || l.id) then
          n := n + 1;
        end if;
      end loop;
      for fam in select distinct st.family_id from public.students st where st.id = any (l.student_ids) loop
        select public.whatsapp_join_names(array_agg(split_part(st.full_name, ' ', 1) order by array_position(l.student_ids, st.id))) into names
          from public.students st where st.id = any (l.student_ids) and st.family_id = fam;
        n := n + public.queue_whatsapp_family(fam, 'lesson_reminder', jsonb_build_object('2', names, '3', l.tutor_name,
          '4', to_char(l.start_at at time zone 'Asia/Dubai', 'Dy FMDD Mon, HH24:MI')), '/lesson/' || l.id);
      end loop;
      update public.lessons set whatsapp_reminded_at = p_now where id = l.id;
    end loop;
  end if;

  -- Overdue chases and homework reminders wait for the working day.
  if local_hour not between 9 and 19 then return n; end if;

  -- b. Overdue invoices (up to 30 days late), quoting the balance still owed
  for inv in
    select * from public.invoices
    where status = 'sent' and overdue_whatsapp_at is null and due_date < today and due_date >= today - 30
    order by due_date
    for update
  loop
    n := n + public.queue_whatsapp_family(inv.family_id, 'invoice_overdue', public.whatsapp_invoice_vars(inv, true), '/invoice/' || inv.id);
    update public.invoices set overdue_whatsapp_at = p_now where id = inv.id;
  end loop;

  -- c. Homework due tomorrow
  for h in
    select hw.id, hw.title, hw.due_date, st.family_id, st.full_name as student_name
    from public.homework hw join public.students st on st.id = hw.student_id
    where not hw.done and hw.due_whatsapp_at is null and hw.due_date = today + 1
    order by hw.id
    for update of hw
  loop
    n := n + public.queue_whatsapp_family(h.family_id, 'homework_due', jsonb_build_object('2', split_part(h.student_name, ' ', 1),
      '3', to_char(h.due_date, 'Dy FMDD Mon'), '4', h.title), null);
    update public.homework set due_whatsapp_at = p_now where id = h.id;
  end loop;

  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Self-service opt-in
-- ---------------------------------------------------------------------------

/** Parents and tutors turn WhatsApp reminders on or off for themselves. Opting out skips anything not yet sent. */
create function public.set_whatsapp(p_opt_in boolean, p_number text)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; num text := nullif(regexp_replace(coalesce(p_number, ''), '[\s().-]', '', 'g'), '');
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Your account is not set up yet.' using errcode = '42501'; end if;
  if me.role = 'student' then raise exception 'WhatsApp reminders are available to parents and tutors.'; end if;
  if num is not null and num !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Please enter your WhatsApp number with its country code, for example +971 50 123 4567.';
  end if;
  if coalesce(p_opt_in, false) and num is null then raise exception 'Please enter your WhatsApp number.'; end if;

  update public.profiles set
    whatsapp_opt_in = coalesce(p_opt_in, false),
    -- Opting out without a number keeps the saved one, so switching back on is one tap.
    whatsapp_number = case when num is null and not coalesce(p_opt_in, false) then me.whatsapp_number else num end,
    whatsapp_opted_in_at = case
      when not coalesce(p_opt_in, false) then null
      when me.whatsapp_opt_in and me.whatsapp_number = num and me.whatsapp_opted_in_at is not null then me.whatsapp_opted_in_at
      else now() end
  where id = me.id;

  if not coalesce(p_opt_in, false) then
    update public.notification_outbox set whatsapp_status = 'skipped'
    where profile_id = me.id and whatsapp and whatsapp_status = 'pending';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.whatsapp_template_body(text), public.whatsapp_clean(text), public.whatsapp_preview(text, jsonb),
  public.whatsapp_join_names(text[]), public.whatsapp_first_name(text),
  public.queue_whatsapp(uuid, text, jsonb, text), public.queue_whatsapp_family(uuid, text, jsonb, text),
  public.whatsapp_invoice_vars(public.invoices, boolean), public.queue_whatsapp_reminders(timestamptz),
  public.on_invoice_sent_whatsapp(), public.on_lesson_notes_whatsapp(), public.set_whatsapp(boolean, text)
  from public, anon, authenticated;
grant execute on function public.queue_whatsapp(uuid, text, jsonb, text), public.queue_whatsapp_reminders(timestamptz) to service_role;
grant execute on function public.set_whatsapp(boolean, text) to authenticated;
