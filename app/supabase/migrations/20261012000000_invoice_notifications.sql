-- Elite Education — invoice notifications after card payments and WhatsApp.
-- 1. Bank details never appear in any notification, email or WhatsApp message. They stay on the invoice in the app
--    (and its PDF) for families who prefer a bank transfer.
-- 2. A family with autopay on and a saved card is told the invoice will be paid automatically from that card
--    ("Visa ending 4242"), with no "pay it" call to action, by email, push and WhatsApp.
-- 3. WhatsApp reminders: an overdue chase never goes out while autopay is still charging the invoice, and the homework
--    reminder skips homework already handed in and links to the homework itself.

-- ---------------------------------------------------------------------------
-- Autopay wording
-- ---------------------------------------------------------------------------

/**
 * The saved card that will pay this invoice automatically, as "Visa ending 4242", or null when the family pays it
 * themselves. Only while autopay is charging the invoice (pending, processing or unknown) and a card is on file.
 */
create function public.invoice_autopay_card(inv public.invoices) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(b.card_brand), ''), 'Card') || ' ending ' || b.card_last4
  from public.family_billing b
  where b.family_id = inv.family_id and b.autopay and b.card_last4 is not null
    and inv.status = 'sent' and inv.autopay_status in ('pending', 'processing', 'unknown')
$$;

-- ---------------------------------------------------------------------------
-- New invoice: email and push (replaces the engagement version, which appended bank details)
-- ---------------------------------------------------------------------------

create or replace function public.on_invoice_sent() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.settings; total text; card text;
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    select * into s from public.settings where id = 1;
    total := 'AED ' || to_char(public.invoice_total(new), 'FM999,999,990.00');
    -- invoices_autopay (a before trigger) has already marked an autopay family's invoice as pending.
    card := public.invoice_autopay_card(new);
    if card is not null then
      perform public.notify_family(new.family_id,
        'Invoice ' || new.number || ' from ' || s.business_name,
        'A new invoice for ' || total || ' is ready in the Elite Education app. As autopay is on, it will be paid automatically from your saved '
          || card || '. There is nothing you need to do; we will let you know if the payment does not go through.',
        'New invoice ' || new.number, total || ' will be paid automatically from your ' || card,
        '/invoice/' || new.id, s.email_invoices);
    else
      perform public.notify_family(new.family_id,
        'Invoice ' || new.number || ' from ' || s.business_name,
        'A new invoice for ' || total || ' is due by ' || to_char(new.due_date, 'DD Mon YYYY')
          || '. You can view and pay it in the Elite Education app.',
        'New invoice ' || new.number, total || ' due ' || to_char(new.due_date, 'DD Mon'),
        '/invoice/' || new.id, s.email_invoices);
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- WhatsApp: an autopay variant of the new-invoice template
-- ---------------------------------------------------------------------------

alter table public.notification_outbox drop constraint notification_outbox_whatsapp_template_check;
alter table public.notification_outbox add constraint notification_outbox_whatsapp_template_check
  check (whatsapp_template in ('lesson_reminder', 'lesson_notes', 'invoice_sent', 'invoice_autopay', 'invoice_overdue', 'homework_due'));

-- Must match WHATSAPP_TEMPLATES in supabase/functions/_shared/whatsapp.ts and the approved Twilio templates.
create or replace function public.whatsapp_template_body(p_template text) returns text
language sql immutable set search_path = public as $$
  select case p_template
    when 'lesson_reminder' then
      'Dear {{1}}, this is a reminder of the lesson for {{2}} with {{3}} on {{4}} (UAE time). Elite Education | eliteeducation.me'
    when 'lesson_notes' then
      'Dear {{1}}, the lesson notes for {{2}} from {{3}} are now ready in the Elite Education app. Elite Education | eliteeducation.me'
    when 'invoice_sent' then
      'Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app and is due by {{4}}. Elite Education | eliteeducation.me'
    when 'invoice_autopay' then
      'Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app. As autopay is on, it will be paid automatically from your saved {{4}}. Elite Education | eliteeducation.me'
    when 'invoice_overdue' then
      'Dear {{1}}, invoice {{2}} for {{3}} was due on {{4}} and remains unpaid. You may view and pay it in the Elite Education app. '
        || 'If you have already paid, please disregard this message. Elite Education | eliteeducation.me'
    when 'homework_due' then
      'Dear {{1}}, this is a reminder that {{2}} has homework due on {{3}}: {{4}}. Elite Education | eliteeducation.me'
  end
$$;

/** The outbox subject for each WhatsApp template (what the office sees in the table editor). */
create function public.whatsapp_subject(p_template text) returns text
language sql immutable set search_path = public as $$
  select case p_template
    when 'lesson_reminder' then 'WhatsApp: lesson reminder'
    when 'lesson_notes' then 'WhatsApp: lesson notes'
    when 'invoice_sent' then 'WhatsApp: invoice sent'
    when 'invoice_autopay' then 'WhatsApp: invoice sent (autopay)'
    when 'invoice_overdue' then 'WhatsApp: invoice overdue'
    when 'homework_due' then 'WhatsApp: homework due'
  end
$$;

create or replace function public.queue_whatsapp(p_profile_id uuid, p_template text, p_vars jsonb, p_url text default null,
  p_now timestamptz default now())
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
    whatsapp, whatsapp_to, whatsapp_template, whatsapp_vars, whatsapp_status, whatsapp_not_before)
  values (p.id, null, public.whatsapp_subject(p_template),
    public.whatsapp_preview(p_template, vars), null, null, p_url, false,
    true, p.whatsapp_number, p_template, vars, 'pending', public.whatsapp_not_before(p_template, p_now));
  return true;
end $$;

-- Quiet hours: the autopay notice keeps the invoice window (09:00 to 19:59 UAE time), as whatsapp_not_before already
-- gives every template other than lesson reminders and notes.

create or replace function public.on_invoice_sent_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare card text;
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    card := public.invoice_autopay_card(new);
    if card is not null then
      perform public.queue_whatsapp_family(new.family_id, 'invoice_autopay',
        public.whatsapp_invoice_vars(new) || jsonb_build_object('4', card), '/invoice/' || new.id);
    else
      perform public.queue_whatsapp_family(new.family_id, 'invoice_sent', public.whatsapp_invoice_vars(new), '/invoice/' || new.id);
    end if;
  end if;
  return new;
end $$;

-- A held invoice message is dropped once the invoice is paid or voided, the autopay notice included.
create or replace function public.on_invoice_settled_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'sent' and new.status is distinct from 'sent' then
    update public.notification_outbox set whatsapp_status = 'skipped'
    where whatsapp and whatsapp_status = 'pending' and whatsapp_template in ('invoice_sent', 'invoice_autopay', 'invoice_overdue')
      and url = '/invoice/' || new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- WhatsApp reminders
-- ---------------------------------------------------------------------------

/**
 * As in 20261011000000_whatsapp.sql, with two changes:
 *  - an invoice autopay is still charging (pending, processing or unknown) is not chased: the family has nothing to pay
 *    by hand. Once autopay fails, or is switched off, the chase goes out as usual.
 *  - homework due tomorrow is skipped once a hand-in exists (homework_submissions), and the message links to it.
 */
create or replace function public.queue_whatsapp_reminders(p_now timestamptz default now())
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
             '4', to_char(l.start_at at time zone 'Asia/Dubai', 'Dy FMDD Mon, HH24:MI')), '/lesson/' || l.id, p_now) then
          n := n + 1;
        end if;
      end loop;
      for fam in select distinct st.family_id from public.students st where st.id = any (l.student_ids) loop
        select public.whatsapp_join_names(array_agg(split_part(st.full_name, ' ', 1) order by array_position(l.student_ids, st.id))) into names
          from public.students st where st.id = any (l.student_ids) and st.family_id = fam;
        n := n + public.queue_whatsapp_family(fam, 'lesson_reminder', jsonb_build_object('2', names, '3', l.tutor_name,
          '4', to_char(l.start_at at time zone 'Asia/Dubai', 'Dy FMDD Mon, HH24:MI')), '/lesson/' || l.id, p_now);
      end loop;
      update public.lessons set whatsapp_reminded_at = p_now where id = l.id;
    end loop;
  end if;

  -- Overdue chases and homework reminders wait for the working day.
  if local_hour not between 9 and 19 then return n; end if;

  -- b. Overdue invoices (up to 30 days late), quoting the balance still owed. Not while autopay is still charging.
  for inv in
    select * from public.invoices
    where status = 'sent' and overdue_whatsapp_at is null and due_date < today and due_date >= today - 30
      and coalesce(autopay_status, '') not in ('pending', 'processing', 'unknown')
    order by due_date
    for update
  loop
    n := n + public.queue_whatsapp_family(inv.family_id, 'invoice_overdue', public.whatsapp_invoice_vars(inv, true), '/invoice/' || inv.id, p_now);
    update public.invoices set overdue_whatsapp_at = p_now where id = inv.id;
  end loop;

  -- c. Homework due tomorrow that has not been handed in
  for h in
    select hw.id, hw.title, hw.due_date, st.family_id, st.full_name as student_name
    from public.homework hw join public.students st on st.id = hw.student_id
    where not hw.done and hw.due_whatsapp_at is null and hw.due_date = today + 1
      and not exists (select 1 from public.homework_submissions sb where sb.homework_id = hw.id)
    order by hw.id
    for update of hw
  loop
    n := n + public.queue_whatsapp_family(h.family_id, 'homework_due', jsonb_build_object('2', split_part(h.student_name, ' ', 1),
      '3', to_char(h.due_date, 'Dy FMDD Mon'), '4', h.title), '/homework/' || h.id, p_now);
    update public.homework set due_whatsapp_at = p_now where id = h.id;
  end loop;

  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges (create or replace keeps existing grants; the new functions start closed)
-- ---------------------------------------------------------------------------

revoke all on function public.invoice_autopay_card(public.invoices), public.whatsapp_subject(text)
  from public, anon, authenticated;
