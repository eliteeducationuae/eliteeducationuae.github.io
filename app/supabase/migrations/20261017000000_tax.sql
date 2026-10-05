-- Elite Education — UAE tax invoices, credit notes, refunds, VAT quarters and read-only accountant access.
--
-- 1. Tax invoices. Business settings carry the legal name, the 15-digit Tax Registration Number (TRN), the registered
--    address and the VAT quarter start month from the FTA certificate. When an invoice is issued (anything other than a
--    draft) the supplier and customer details and the date of supply are copied onto it, so changing the settings or a
--    family's billing details afterwards never changes an invoice that has already been issued.
-- 2. Issued invoices are locked. Invoice and credit note numbers run in sequence with no gaps; an issued invoice cannot
--    be edited, returned to draft or deleted, and a cancelled invoice cannot be reopened. Corrections are made with a
--    credit note. Cancelling (voiding) a sent or paid invoice issues a closing 'Invoice cancelled' credit note.
-- 3. Credit notes reduce what is owed on an invoice (invoice_balance). They are permanent and numbered CN-0001, CN-0002...
-- 4. Refunds of a payment: by card through Stripe (begin_card_refund, then the refund-payment Edge Function and the
--    Stripe webhook settle it) or recorded by hand for bank transfers and cash (record_manual_refund). A refund can carry
--    a credit note for the same amount. Every request carries a request key, so a retried request never refunds twice.
-- 5. The accountant role reads the books (invoices, payments, charges, packages, credit notes, refunds, expenses, tutor
--    invoices, families and receipts) and nothing about pupils, lessons or messages, and changes nothing.
--
-- Money rules (src/domain/tax.ts implements the same algorithm and must stay identical):
--   R = vat_rate, S = round(sum(quantity * unitPrice), 2), V = round(S * R, 2), T = S + V.
--   Cn / Cv = net / VAT already credited on the invoice.
--   A credit note for line nets n_i (each rounded to 2dp and > 0, N = sum n_i) needs Cn + N <= S, and per referenced
--   invoice line k, the net already credited on k plus this note's net on k <= round(quantity_k * unitPrice_k, 2).
--   Full credit (Cn + N = S): note VAT = V - Cv (never below 0). Otherwise note VAT = round(N * R, 2), never more than
--   V - Cv. Line VATs are round(n_i * R, 2); the difference to the note VAT goes to the first line with the largest net
--   (a negative difference is taken from the lines in that order without taking any line below 0). total = N + VAT.
--   From a gross amount G (refunds): remaining = T - Cn - Cv; G <= remaining; if G = remaining then net = S - Cn and
--   VAT = V - Cv, else net = round(G / (1 + R), 2) and VAT = G - net; one line with invoiceLine null.
--   invoice_balance = invoice_total - credited - payments + refunds that have not failed.
--
-- Overdue chases: queue_whatsapp_reminders (20261012000000) only chases invoices whose status is still 'sent'. A credit
-- note that clears the balance marks the invoice paid (issue_credit_note), so an invoice whose balance is nil because of
-- credits is never chased; the amount quoted comes from whatsapp_invoice_vars, which now uses invoice_balance.
-- autopay_failed (20261010000000) still computes its balance as total less payments; it only reports a failed charge
-- and never takes money, and charge-invoice now charges the credited balance.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.settings
  add column legal_name text,
  add column trn text check (trn is null or trn ~ '^[0-9]{15}$'),
  add column registered_address text,
  add column invoice_footer text,
  -- 1: quarters start in January, April, July and October; 2: February, May, August, November; 3: March, June, September, December.
  add column vat_quarter_start_month int not null default 1 check (vat_quarter_start_month in (1, 2, 3)),
  add column next_credit_note_number int not null default 1;

-- Kept on family_billing, not families, so tutors (who can read families) never see them.
alter table public.family_billing
  add column trn text check (trn is null or trn ~ '^[0-9]{15}$'),
  add column billing_address text;

-- Snapshots taken when the invoice is issued: {"name": text, "address": text|null, "trn": text|null, "email": text|null}.
alter table public.invoices
  add column supply_date date,
  add column supplier jsonb,
  add column customer jsonb;

-- ---------------------------------------------------------------------------
-- The accountant role
-- ---------------------------------------------------------------------------

-- Merge note: if another change also redefines this constraint, the role lists must be combined.
alter table public.profiles drop constraint if exists profiles_role_check,
  add constraint profiles_role_check check (role in ('admin', 'tutor', 'parent', 'student', 'accountant'));

create function public.is_accountant() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'accountant' from public.profiles where id = auth.uid()), false)
$$;

/** Admins and the accountant: the people who may read every invoice, credit note and refund. */
create function public.is_finance_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_accountant()
$$;

grant execute on function public.is_accountant(), public.is_finance_reader() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  invoice_id uuid not null constraint credit_notes_invoice_id_fkey references public.invoices(id) on delete restrict,
  family_id uuid not null constraint credit_notes_family_id_fkey references public.families(id),
  issue_date date not null default current_date,
  reason text not null check (length(trim(reason)) between 1 and 500),
  vat_rate numeric(5,4) not null,
  -- [{ description, invoiceLine (0-based index into invoices.items, or null), net, vat }]
  lines jsonb not null,
  subtotal numeric(10,2) not null check (subtotal > 0),
  vat numeric(10,2) not null check (vat >= 0),
  total numeric(10,2) not null,
  -- True when the credited lessons were released to be invoiced again (a billing correction, not a lower price).
  rebilled boolean not null default false,
  supplier jsonb,
  customer jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null constraint refunds_invoice_id_fkey references public.invoices(id),
  family_id uuid not null constraint refunds_family_id_fkey references public.families(id),
  payment_id uuid not null constraint refunds_payment_id_fkey references public.payments(id),
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('card', 'bank-transfer', 'cash')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  reason text not null check (length(trim(reason)) between 1 and 500),
  reference text,
  request_key text not null unique,
  stripe_refund_id text unique,
  credit_note_id uuid constraint refunds_credit_note_id_fkey references public.credit_notes(id),
  failure_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index refunds_invoice_idx on public.refunds (invoice_id);
create index refunds_payment_idx on public.refunds (payment_id);

create table public.accountant_invites (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  full_name text,
  invited_at timestamptz not null default now(),
  invited_by uuid,
  accepted_at timestamptz
);

alter table public.credit_notes enable row level security;
alter table public.refunds enable row level security;
alter table public.accountant_invites enable row level security;

-- Credit notes and refunds are written only by the security-definer functions below.
revoke all on public.credit_notes, public.refunds, public.accountant_invites from public, anon;
grant select on public.credit_notes, public.refunds to authenticated;
revoke insert, update, delete on public.credit_notes, public.refunds from authenticated;
grant select, insert, update, delete on public.accountant_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Money helpers
-- ---------------------------------------------------------------------------

/** Everything credited on an invoice (net plus VAT). */
create function public.invoice_credited(inv public.invoices) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(c.total), 0) from public.credit_notes c where c.invoice_id = inv.id
$$;

/** Refunds on an invoice that have not failed. A pending refund counts, so it can never be started twice. */
create function public.invoice_refunded(inv public.invoices) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(r.amount), 0) from public.refunds r where r.invoice_id = inv.id and r.status <> 'failed'
$$;

/** What is still owed on an invoice: total less credit notes and payments, plus refunds. Negative when overpaid. */
create function public.invoice_balance(inv public.invoices) returns numeric
language sql stable set search_path = public as $$
  select public.invoice_total(inv) - public.invoice_credited(inv)
    - coalesce((select sum(p.amount) from public.payments p where p.invoice_id = inv.id), 0)
    + public.invoice_refunded(inv)
$$;

grant execute on function public.invoice_credited(public.invoices), public.invoice_refunded(public.invoices),
  public.invoice_balance(public.invoices) to authenticated;

/** 'AED 1,234.50' */
create function public._tax_aed(p_amount numeric) returns text
language sql immutable set search_path = public as $$
  select 'AED ' || to_char(coalesce(p_amount, 0), 'FM999,999,990.00')
$$;

/** The supplier as it stands in Business settings. */
create function public._tax_supplier() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', coalesce(nullif(trim(s.legal_name), ''), s.business_name),
    'address', nullif(trim(s.registered_address), ''), 'trn', s.trn, 'email', s.notify_email)
  from public.settings s where s.id = 1
$$;

/** The customer (the paying parent or company) as it stands now. */
create function public._tax_customer(p_family_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', f.parent_name, 'address', nullif(trim(b.billing_address), ''), 'trn', b.trn, 'email', f.email)
  from public.families f left join public.family_billing b on b.family_id = f.id
  where f.id = p_family_id
$$;

/** Subtotal (S) of an invoice: round(sum(quantity * unitPrice), 2). */
create function public._tax_subtotal(inv public.invoices) returns numeric
language sql stable set search_path = public as $$
  select round(coalesce(sum((i->>'quantity')::numeric * (i->>'unitPrice')::numeric), 0), 2)
  from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) i
$$;

/** Net already credited on one invoice line (0-based). */
create function public._tax_line_credited(p_invoice_id uuid, p_line int) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum((l->>'net')::numeric), 0)
  from public.credit_notes c, jsonb_array_elements(c.lines) l
  where c.invoice_id = p_invoice_id and jsonb_typeof(l->'invoiceLine') = 'number' and (l->>'invoiceLine')::int = p_line
$$;

-- ---------------------------------------------------------------------------
-- Gap-free numbering
-- ---------------------------------------------------------------------------

-- As in 20261002000000_init.sql, but marks the change as the numbering itself so settings_guard_numbers allows it.
-- The number comes from an update of the single settings row, so a creation that fails rolls the number back too.
create or replace function public.next_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('elite.numbering', 'on', true);
  update public.settings set next_invoice_number = next_invoice_number + 1 where id = 1
  returning next_invoice_number - 1 into n;
  perform set_config('elite.numbering', '', true);
  return 'INV-' || lpad(n::text, 4, '0');
end $$;

create function public.next_credit_note_number() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('elite.numbering', 'on', true);
  update public.settings set next_credit_note_number = next_credit_note_number + 1 where id = 1
  returning next_credit_note_number - 1 into n;
  perform set_config('elite.numbering', '', true);
  return 'CN-' || lpad(n::text, 4, '0');
end $$;
revoke all on function public.next_credit_note_number() from public, anon, authenticated;

create function public.settings_guard_numbers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('elite.numbering', true), '') <> 'on' then
    if new.next_invoice_number is distinct from old.next_invoice_number and exists (select 1 from public.invoices) then
      raise exception 'Invoice numbers run in sequence and cannot be changed once invoices have been issued.';
    end if;
    if new.next_credit_note_number is distinct from old.next_credit_note_number and exists (select 1 from public.credit_notes) then
      raise exception 'Credit note numbers run in sequence and cannot be changed once credit notes have been issued.';
    end if;
  end if;
  return new;
end $$;
create trigger settings_guard_numbers before update on public.settings
  for each row execute function public.settings_guard_numbers();

-- The app only creates invoices through security-definer functions (invoice_unbilled, sell_package and the Stripe
-- functions), and invoices are never deleted: they are kept for tax records.
revoke insert, delete on public.invoices from authenticated;

create function public.invoices_guard_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Invoices are kept for tax records. Cancel it with a credit note instead.';
end $$;
create trigger invoices_guard_delete before delete on public.invoices
  for each row execute function public.invoices_guard_delete();

create function public.credit_notes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Credit notes are permanent tax records and cannot be changed or deleted.';
end $$;
create trigger credit_notes_guard before update or delete on public.credit_notes
  for each row execute function public.credit_notes_guard();

-- ---------------------------------------------------------------------------
-- Issued invoices: snapshot and lock
-- ---------------------------------------------------------------------------

-- Invoices already issued before this change take today's details once.
update public.invoices i set
  supplier = public._tax_supplier(),
  customer = public._tax_customer(i.family_id),
  supply_date = coalesce(i.supply_date,
    (select max((c.date at time zone 'Asia/Dubai')::date) from public.charges c
      where c.id::text in (select it->>'chargeId' from jsonb_array_elements(i.items) it)),
    i.issue_date)
where i.status <> 'draft' and i.supplier is null;

/** Fill the supplier, customer and date of supply when an invoice is issued. */
create function public.invoices_snapshot_tax() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'draft' and new.supplier is null then
    new.supplier := public._tax_supplier();
    new.customer := coalesce(new.customer, public._tax_customer(new.family_id));
    new.supply_date := coalesce(new.supply_date,
      (select max((c.date at time zone 'Asia/Dubai')::date) from public.charges c
        where c.id::text in (select it->>'chargeId' from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) it)),
      new.issue_date);
  end if;
  return new;
end $$;
create trigger invoices_snapshot_tax before insert or update of status on public.invoices
  for each row execute function public.invoices_snapshot_tax();

/**
 * An issued tax invoice cannot be changed. Allowed after issue: sent to paid (and back), sent or paid to void, and
 * the due date, notes, autopay and reminder columns. The snapshot columns may be filled once when still empty.
 */
create function public.invoices_guard_issued() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'draft' then return new; end if;
  if old.status = 'void' and new.status is distinct from 'void' then
    raise exception 'A cancelled invoice cannot be reopened.';
  end if;
  if new.status = 'draft' then
    raise exception 'An issued tax invoice cannot be returned to draft. Issue a credit note instead.';
  end if;
  if new.number is distinct from old.number or new.family_id is distinct from old.family_id
     or new.issue_date is distinct from old.issue_date or new.items is distinct from old.items
     or new.vat_rate is distinct from old.vat_rate
     or (old.supply_date is not null and new.supply_date is distinct from old.supply_date)
     or (old.supplier is not null and new.supplier is distinct from old.supplier)
     or (old.customer is not null and new.customer is distinct from old.customer) then
    raise exception 'An issued tax invoice cannot be changed. Issue a credit note instead.';
  end if;
  return new;
end $$;
create trigger invoices_guard_issued before update on public.invoices
  for each row execute function public.invoices_guard_issued();

-- ---------------------------------------------------------------------------
-- Credit notes
-- ---------------------------------------------------------------------------

/**
 * Validates and inserts a credit note against a locked invoice (the caller holds it for update). p_lines is
 * [{ description, invoiceLine (int or null), net }]. p_vat overrides the note's VAT (used for refunds from a gross
 * amount). Not granted to anyone.
 */
create function public._make_credit_note(inv public.invoices, p_reason text, p_lines jsonb, p_rebilled boolean, p_vat numeric default null)
returns public.credit_notes language plpgsql security definer set search_path = public as $$
declare
  r numeric := coalesce(inv.vat_rate, 0);
  items jsonb := coalesce(inv.items, '[]'::jsonb);
  n_items int := jsonb_array_length(coalesce(inv.items, '[]'::jsonb));
  v_reason text := trim(coalesce(p_reason, ''));
  s numeric; v numeric; cn numeric; cv numeric;
  el jsonb; k int; net numeric; descr text;
  nets numeric[] := '{}'; vats numeric[] := '{}'; descs text[] := '{}'; refs int[] := '{}';
  big_n numeric := 0; note_vat numeric; diff numeric; take numeric; cap numeric; prev numeric; this_k numeric;
  ord int[]; i int; out_lines jsonb := '[]'::jsonb;
  note public.credit_notes;
begin
  if v_reason = '' then raise exception 'Please give a reason for the credit note.'; end if;
  if length(v_reason) > 500 then raise exception 'Please keep the reason to 500 characters or fewer.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter an amount to credit.';
  end if;

  s := public._tax_subtotal(inv);
  v := round(s * r, 2);
  select coalesce(sum(c.subtotal), 0), coalesce(sum(c.vat), 0) into cn, cv from public.credit_notes c where c.invoice_id = inv.id;

  for el in select * from jsonb_array_elements(p_lines) loop
    net := case when jsonb_typeof(el->'net') in ('number', 'string') then round(nullif(el->>'net', '')::numeric, 2) end;
    if net is null or net <= 0 then raise exception 'Enter an amount to credit.'; end if;
    k := case when jsonb_typeof(el->'invoiceLine') = 'number' then (el->>'invoiceLine')::int end;
    if k is not null and (k < 0 or k >= n_items) then raise exception 'Choose a line on this invoice to credit.'; end if;
    descr := coalesce(nullif(trim(el->>'description'), ''), case when k is not null then nullif(trim(items->k->>'description'), '') end, 'Credit');
    nets := array_append(nets, net);
    refs := array_append(refs, k);
    descs := array_append(descs, left(descr, 500));
    big_n := big_n + net;
  end loop;

  -- Per invoice line: never more than the line's net.
  for k in select distinct x from unnest(refs) x where x is not null order by 1 loop
    cap := round((items->k->>'quantity')::numeric * (items->k->>'unitPrice')::numeric, 2);
    prev := public._tax_line_credited(inv.id, k);
    select coalesce(sum(nets[j]), 0) into this_k from generate_subscripts(nets, 1) j where refs[j] = k;
    if prev + this_k > cap then
      raise exception 'Line % has only % left to credit.', k + 1, public._tax_aed(greatest(cap - prev, 0));
    end if;
  end loop;
  if cn + big_n > s then
    raise exception 'Only % is left to credit on this invoice.', public._tax_aed(greatest(s - cn, 0));
  end if;

  if p_vat is not null then note_vat := p_vat;
  elsif cn + big_n = s then note_vat := greatest(v - cv, 0);
  else note_vat := least(round(big_n * r, 2), greatest(v - cv, 0));
  end if;

  for i in 1 .. array_length(nets, 1) loop vats := array_append(vats, round(nets[i] * r, 2)); end loop;
  diff := note_vat - (select sum(x) from unnest(vats) x);
  select array_agg(j order by nets[j] desc, j) into ord from generate_subscripts(nets, 1) j;
  if diff > 0 then
    vats[ord[1]] := vats[ord[1]] + diff;
  elsif diff < 0 then
    foreach i in array ord loop
      exit when diff = 0;
      take := least(vats[i], -diff);
      vats[i] := vats[i] - take;
      diff := diff + take;
    end loop;
  end if;

  for i in 1 .. array_length(nets, 1) loop
    out_lines := out_lines || jsonb_build_array(jsonb_build_object('description', descs[i], 'invoiceLine', refs[i], 'net', nets[i], 'vat', vats[i]));
  end loop;

  insert into public.credit_notes (number, invoice_id, family_id, reason, vat_rate, lines, subtotal, vat, total, rebilled,
                                   supplier, customer, created_by)
  values (public.next_credit_note_number(), inv.id, inv.family_id, v_reason, r, out_lines, big_n, note_vat, big_n + note_vat,
          coalesce(p_rebilled, false), coalesce(inv.supplier, public._tax_supplier()),
          coalesce(inv.customer, public._tax_customer(inv.family_id)), auth.uid())
  returning * into note;
  return note;
end $$;

/** The lines of a closing credit note: the net still uncredited on each line (in order), up to S - Cn in all. */
create function public._tax_remaining_lines(inv public.invoices) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  target numeric := public._tax_subtotal(inv) - (select coalesce(sum(subtotal), 0) from public.credit_notes where invoice_id = inv.id);
  taken numeric := 0; out_lines jsonb := '[]'::jsonb; rem numeric; it jsonb; k int := 0;
begin
  for it in select * from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) loop
    rem := least(round((it->>'quantity')::numeric * (it->>'unitPrice')::numeric, 2) - public._tax_line_credited(inv.id, k), target - taken);
    if rem > 0 then
      out_lines := out_lines || jsonb_build_array(jsonb_build_object('description', it->>'description', 'invoiceLine', k, 'net', rem));
      taken := taken + rem;
    end if;
    k := k + 1;
  end loop;
  if target - taken > 0 then
    out_lines := out_lines || jsonb_build_array(jsonb_build_object('description', 'Invoice cancelled', 'invoiceLine', null, 'net', target - taken));
  end if;
  return out_lines;
end $$;

/** After a credit note or refund: a fully credited invoice is cancelled; a sent invoice with nothing left to pay is paid. */
create function public._tax_settle_invoice(p_invoice_id uuid, p_release_charges boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.status in ('sent', 'paid') and public._tax_subtotal(inv) > 0
     and (select coalesce(sum(subtotal), 0) from public.credit_notes where invoice_id = inv.id) >= public._tax_subtotal(inv) then
    if not coalesce(p_release_charges, false) then perform set_config('elite.keep_charges', 'on', true); end if;
    update public.invoices set status = 'void' where id = inv.id;
    perform set_config('elite.keep_charges', '', true);
  elsif inv.status = 'sent' and public.invoice_balance(inv) <= 0 then
    update public.invoices set status = 'paid' where id = inv.id;
  end if;
end $$;

/** Admin: issue a credit note against a sent or paid invoice. */
create function public.issue_credit_note(p_invoice_id uuid, p_reason text, p_lines jsonb, p_release_charges boolean default false)
returns public.credit_notes language plpgsql security definer set search_path = public as $$
declare inv public.invoices; note public.credit_notes; s public.settings; it jsonb; k int := 0; release boolean := coalesce(p_release_charges, false);
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  -- Locking the invoice serialises credit notes, refunds and cancellations on it.
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found.'; end if;
  if inv.status = 'draft' then raise exception 'Draft invoices can be edited; only issued invoices take credit notes.'; end if;
  if inv.status = 'void' then raise exception 'This invoice has already been cancelled.'; end if;
  if inv.autopay_status in ('processing', 'unknown') then
    raise exception 'Autopay is charging this invoice at the moment. Please wait for it to finish before issuing a credit note.';
  end if;

  note := public._make_credit_note(inv, p_reason, p_lines, release);

  if release then
    -- Lessons on lines that are now fully credited go back to be invoiced again.
    for it in select * from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) loop
      if it ? 'chargeId' and public._tax_line_credited(inv.id, k) >= round((it->>'quantity')::numeric * (it->>'unitPrice')::numeric, 2) then
        update public.charges set status = 'unbilled', invoice_id = null where id::text = it->>'chargeId' and invoice_id = inv.id;
      end if;
      k := k + 1;
    end loop;
  end if;
  perform public._tax_settle_invoice(inv.id, release);

  select * into s from public.settings where id = 1;
  perform public.notify_family(inv.family_id,
    'Credit note ' || note.number || ' from ' || s.business_name,
    'A credit note for ' || public._tax_aed(note.total) || ' has been issued against invoice ' || inv.number
      || '. You can view it in the Elite Education app.',
    'Credit note ' || note.number, public._tax_aed(note.total) || ' credited against invoice ' || inv.number,
    '/credit-note/' || note.id, s.email_invoices);
  return note;
end $$;

/** A credit note for a gross amount (net plus VAT), used with refunds. Not granted to anyone. */
create function public._issue_credit_from_gross(inv public.invoices, p_gross numeric, p_reason text)
returns public.credit_notes language plpgsql security definer set search_path = public as $$
declare
  r numeric := coalesce(inv.vat_rate, 0);
  g numeric := round(p_gross, 2);
  s numeric; v numeric; cn numeric; cv numeric; remaining numeric; net numeric; vat numeric;
begin
  if g is null or g <= 0 then raise exception 'Enter an amount to credit.'; end if;
  s := public._tax_subtotal(inv);
  v := round(s * r, 2);
  select coalesce(sum(c.subtotal), 0), coalesce(sum(c.vat), 0) into cn, cv from public.credit_notes c where c.invoice_id = inv.id;
  remaining := (s + v) - cn - cv;
  if g > remaining then
    raise exception 'Only % is left to credit on this invoice.', public._tax_aed(greatest(remaining, 0));
  end if;
  if g = remaining then
    vat := greatest(v - cv, 0);
    net := g - vat;
  else
    net := round(g / (1 + r), 2);
    if cn + net > s then net := s - cn; end if;
    vat := g - net;
  end if;
  if net <= 0 then raise exception 'Enter an amount to credit.'; end if;
  return public._make_credit_note(inv, p_reason,
    jsonb_build_array(jsonb_build_object('description', 'Refund: ' || trim(coalesce(p_reason, '')), 'invoiceLine', null, 'net', net)),
    false, vat);
end $$;

-- Cancelling a sent or paid invoice issues a closing credit note for whatever is not yet credited. The credited
-- lessons are released to be invoiced again (rebilled), as voiding has always done, unless elite.keep_charges is on.
-- The family is told when they had paid something towards it (they may be owed a refund); for an unpaid invoice the
-- credit note simply appears with the cancelled invoice in the app.
create function public.invoices_cancel_with_credit_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare note public.credit_notes; lines jsonb; s public.settings;
begin
  if old.status in ('sent', 'paid') and new.status = 'void'
     and (select coalesce(sum(subtotal), 0) from public.credit_notes where invoice_id = new.id) < public._tax_subtotal(new) then
    lines := public._tax_remaining_lines(new);
    if jsonb_array_length(lines) = 0 then return null; end if;
    note := public._make_credit_note(new, 'Invoice cancelled', lines,
      coalesce(current_setting('elite.keep_charges', true), '') <> 'on');
    if exists (select 1 from public.payments where invoice_id = new.id) then
      select * into s from public.settings where id = 1;
      perform public.notify_family(new.family_id,
        'Invoice ' || new.number || ' has been cancelled',
        'Invoice ' || new.number || ' has been cancelled and credit note ' || note.number || ' for ' || public._tax_aed(note.total)
          || ' has been issued. You can view both in the Elite Education app.',
        'Invoice ' || new.number || ' cancelled', 'Credit note ' || note.number || ' issued',
        '/credit-note/' || note.id, s.email_invoices);
    end if;
  end if;
  return null;
end $$;
create trigger invoices_cancel_with_credit_note after update of status on public.invoices
  for each row execute function public.invoices_cancel_with_credit_note();

-- As in 20261002000000_init.sql, but a cancellation that keeps its lessons billed (elite.keep_charges) releases nothing.
create or replace function public.release_voided_charges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'void' and old.status <> 'void' and coalesce(current_setting('elite.keep_charges', true), '') <> 'on' then
    update public.charges set status = 'unbilled', invoice_id = null where invoice_id = new.id;
  end if;
  return new;
end $$;

-- Mark an invoice paid once payments and credit notes cover it.
create or replace function public.refresh_invoice_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = new.invoice_id;
  if inv.status = 'sent' and public.invoice_balance(inv) <= 0 then
    update public.invoices set status = 'paid' where id = inv.id;
  end if;
  return new;
end $$;

-- As in 20261011000000_whatsapp.sql; the outstanding amount now allows for credit notes and refunds. Never bank details.
create or replace function public.whatsapp_invoice_vars(inv public.invoices, p_outstanding boolean default false) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('2', inv.number,
    '3', 'AED ' || to_char(case when p_outstanding then greatest(public.invoice_balance(inv), 0)
                                else greatest(public.invoice_total(inv), 0) end, 'FM999,999,999,990.00'),
    '4', to_char(inv.due_date, 'FMDD Mon YYYY'))
$$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

create function public._map_refund_status(p_status text) returns text
language sql immutable set search_path = public as $$
  select case lower(coalesce(p_status, ''))
    when 'succeeded' then 'succeeded'
    when 'failed' then 'failed'
    when 'canceled' then 'failed'
    when 'cancelled' then 'failed'
    else 'pending' end
$$;

/** Shared by begin_card_refund and record_manual_refund. Not granted to anyone. */
create function public._create_refund(
  p_payment_id uuid, p_amount numeric, p_reason text, p_with_credit_note boolean, p_request_key text, p_card boolean, p_reference text
) returns public.refunds language plpgsql security definer set search_path = public as $$
declare
  pay public.payments; inv public.invoices; existing public.refunds; note public.credit_notes; v_row public.refunds;
  amt numeric := round(p_amount, 2);
  v_reason text := trim(coalesce(p_reason, ''));
  v_key text := trim(coalesce(p_request_key, ''));
  refundable numeric; bal_before numeric; bal_after numeric; s public.settings;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if v_key = '' then raise exception 'A request key is required.'; end if;
  select * into pay from public.payments where id = p_payment_id;
  if pay.id is null then raise exception 'Payment not found.'; end if;
  select * into inv from public.invoices where id = pay.invoice_id for update;

  -- The same request again (a retry) returns what it made the first time.
  select * into existing from public.refunds where request_key = v_key;
  if existing.id is not null then
    if existing.payment_id = p_payment_id and existing.amount = amt then return existing; end if;
    raise exception 'This refund request was already used for a different amount.';
  end if;

  if p_card and pay.stripe_payment_intent is null then
    raise exception 'This payment was not taken by card through Stripe; record the refund manually.';
  end if;
  if v_reason = '' then raise exception 'Please give a reason for the refund.'; end if;
  if length(v_reason) > 500 then raise exception 'Please keep the reason to 500 characters or fewer.'; end if;
  if amt is null or amt <= 0 then raise exception 'Enter an amount to refund.'; end if;
  refundable := pay.amount - (select coalesce(sum(amount), 0) from public.refunds where payment_id = pay.id and status <> 'failed');
  if amt > refundable then
    raise exception 'Only % of this payment can still be refunded.', public._tax_aed(greatest(refundable, 0));
  end if;

  bal_before := public.invoice_balance(inv);
  if coalesce(p_with_credit_note, false) then
    note := public._issue_credit_from_gross(inv, amt, v_reason);
  end if;
  if inv.status in ('paid', 'void') then
    bal_after := bal_before - coalesce(note.total, 0) + amt;
    if bal_after > 0.005 then
      raise exception 'Issue a credit note with this refund, or refund no more than the % the family has overpaid.',
        public._tax_aed(greatest(-bal_before, 0));
    end if;
  end if;

  insert into public.refunds (invoice_id, family_id, payment_id, amount, method, status, reason, reference, request_key,
                              credit_note_id, created_by, settled_at)
  values (inv.id, inv.family_id, pay.id, amt, case when p_card then 'card' else pay.method end,
          case when p_card then 'pending' else 'succeeded' end, v_reason, nullif(trim(coalesce(p_reference, '')), ''), v_key,
          note.id, auth.uid(), case when p_card then null else now() end)
  returning * into v_row;
  perform public._tax_settle_invoice(inv.id, false);

  if not p_card then
    select * into s from public.settings where id = 1;
    perform public.notify_family(inv.family_id,
      'Refund for invoice ' || inv.number,
      'A refund of ' || public._tax_aed(amt) || ' has been recorded against invoice ' || inv.number
        || '. You can view the details in the Elite Education app.',
      'Refund recorded', public._tax_aed(amt) || ' refunded for invoice ' || inv.number,
      '/invoice/' || inv.id, s.email_invoices);
  end if;
  return v_row;
end $$;

/** Admin: start a card refund. The refund-payment Edge Function then sends it to Stripe and settles it. */
create function public.begin_card_refund(
  p_payment_id uuid, p_amount numeric, p_reason text, p_with_credit_note boolean, p_request_key text
) returns public.refunds language plpgsql security definer set search_path = public as $$
begin
  return public._create_refund(p_payment_id, p_amount, p_reason, p_with_credit_note, p_request_key, true, null);
end $$;

/** Admin: record a refund made by bank transfer, cash or outside the app. */
create function public.record_manual_refund(
  p_payment_id uuid, p_amount numeric, p_reason text, p_reference text, p_with_credit_note boolean, p_request_key text
) returns public.refunds language plpgsql security definer set search_path = public as $$
begin
  return public._create_refund(p_payment_id, p_amount, p_reason, p_with_credit_note, p_request_key, false, p_reference);
end $$;

/**
 * Service role: Stripe's answer for a card refund. Safe to repeat. pending becomes succeeded or failed; a succeeded
 * refund can still fail later (Stripe reports it); failed is final.
 */
create function public.settle_card_refund(p_refund_id uuid, p_stripe_refund_id text, p_status text, p_failure text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  rf public.refunds; inv public.invoices; fam public.families; s public.settings;
  next_status text := public._map_refund_status(p_status);
  v_failure text;
begin
  select * into rf from public.refunds where id = p_refund_id for update;
  if rf.id is null then return; end if;
  if rf.stripe_refund_id is null and nullif(p_stripe_refund_id, '') is not null
     and not exists (select 1 from public.refunds where stripe_refund_id = p_stripe_refund_id) then
    update public.refunds set stripe_refund_id = p_stripe_refund_id where id = rf.id;
  end if;
  if rf.status = 'failed' or next_status = rf.status or next_status = 'pending' then return; end if;

  select * into inv from public.invoices where id = rf.invoice_id;
  select * into fam from public.families where id = rf.family_id;
  if next_status = 'succeeded' then
    update public.refunds set status = 'succeeded', settled_at = now(), failure_reason = null where id = rf.id;
    select * into s from public.settings where id = 1;
    perform public.notify_family(rf.family_id,
      'Your refund for invoice ' || inv.number,
      'Your refund of ' || public._tax_aed(rf.amount) || ' for invoice ' || inv.number
        || ' is on its way to your card. It usually arrives within 5-10 working days.',
      'Refund on its way', public._tax_aed(rf.amount) || ' for invoice ' || inv.number,
      '/invoice/' || inv.id, s.email_invoices);
  else
    v_failure := coalesce(nullif(trim(p_failure), ''), 'the card issuer did not accept it');
    update public.refunds set status = 'failed', settled_at = now(), failure_reason = left(v_failure, 300) where id = rf.id;
    perform public.notify_admins('Refund failed: ' || inv.number || ' (' || fam.name || ')',
      'The card refund of ' || public._tax_aed(rf.amount) || ' for invoice ' || inv.number || ' to the ' || fam.name
        || ' family did not go through: ' || v_failure || '. Please refund the family another way and record it in the app.'
        || case when rf.credit_note_id is not null then ' The credit note issued with it remains in place.' else '' end,
      'Refund failed', inv.number || ' (' || fam.name || ')', '/invoice/' || inv.id);
  end if;
  perform public._tax_settle_invoice(inv.id, false);
end $$;

/**
 * Service role: a refund Stripe reports that the app did not start (made in the Stripe Dashboard). It is recorded
 * once against the payment, and the office is asked whether a credit note is needed. Unknown payments are ignored.
 */
create function public.record_external_stripe_refund(p_payment_intent text, p_stripe_refund_id text, p_amount numeric, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare rf public.refunds; pay public.payments; inv public.invoices; fam public.families; st text := public._map_refund_status(p_status);
begin
  if nullif(p_stripe_refund_id, '') is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('refund:' || p_stripe_refund_id));
  select * into rf from public.refunds where stripe_refund_id = p_stripe_refund_id;
  if rf.id is not null then
    perform public.settle_card_refund(rf.id, p_stripe_refund_id, p_status, null);
    return;
  end if;
  if p_payment_intent is null or not (round(p_amount, 2) > 0) then return; end if;
  select * into pay from public.payments where stripe_payment_intent = p_payment_intent;
  if pay.id is null then return; end if;
  select * into inv from public.invoices where id = pay.invoice_id for update;
  select * into fam from public.families where id = inv.family_id;
  insert into public.refunds (invoice_id, family_id, payment_id, amount, method, status, reason, request_key, stripe_refund_id, settled_at)
  values (inv.id, inv.family_id, pay.id, round(p_amount, 2), 'card', st, 'Refunded in Stripe', 'stripe:' || p_stripe_refund_id,
          p_stripe_refund_id, case when st <> 'pending' then now() end)
  on conflict do nothing;
  if not found then return; end if;
  perform public.notify_admins('Refund made in Stripe: ' || inv.number || ' (' || fam.name || ')',
    'A card refund of ' || public._tax_aed(round(p_amount, 2)) || ' for invoice ' || inv.number || ' to the ' || fam.name
      || ' family was made in the Stripe Dashboard and has been recorded in the app. If it reduces what the family owes, please issue a credit note against the invoice.',
    'Refund recorded', inv.number || ': ' || public._tax_aed(round(p_amount, 2)) || ' refunded in Stripe', '/invoice/' || inv.id);
  perform public._tax_settle_invoice(inv.id, false);
end $$;

-- ---------------------------------------------------------------------------
-- Accountant access
-- ---------------------------------------------------------------------------

/** Admin: give an accountant read-only access. Returns 'linked' (they can sign in now) or 'invited' (email to send). */
create function public.invite_accountant(p_email text, p_full_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  p public.profiles; u record;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'Please enter the accountant''s email address.'; end if;

  select * into p from public.profiles where lower(email) = v_email limit 1;
  if p.id is null then
    select * into p from public.profiles where id in (select id from auth.users where lower(email) = v_email) limit 1;
  end if;
  if p.id is not null and p.role <> 'accountant' then
    raise exception 'This email address already signs in as %. Please use a different address for the accountant.',
      case p.role when 'admin' then 'an administrator' else 'a ' || p.role end;
  end if;
  if p.id is null and (exists (select 1 from public.tutors where lower(email) = v_email)
                       or exists (select 1 from public.families where lower(email) = v_email)) then
    raise exception 'This email address belongs to a tutor or a family. Please use a different address for the accountant.';
  end if;

  insert into public.accountant_invites (email, full_name, invited_by)
  values (v_email, v_name, auth.uid())
  on conflict (email) do update set full_name = coalesce(excluded.full_name, accountant_invites.full_name),
    invited_by = excluded.invited_by, invited_at = now();

  if p.id is not null then
    update public.accountant_invites set accepted_at = coalesce(accepted_at, now()) where email = v_email;
    return 'linked';
  end if;

  select id, email, raw_user_meta_data into u from auth.users
   where lower(email) = v_email and email_confirmed_at is not null limit 1;
  if u.id is not null then
    insert into public.profiles (id, role, full_name, email)
    values (u.id, 'accountant',
            coalesce(v_name, nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                     initcap(regexp_replace(split_part(v_email, '@', 1), '[._-]+', ' ', 'g'))),
            v_email);
    update public.accountant_invites set accepted_at = now() where email = v_email;
    return 'linked';
  end if;
  return 'invited';
end $$;

/** Admin: withdraw an invitation and remove the accountant's access. */
create function public.remove_accountant(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  delete from public.accountant_invites where email = v_email;
  delete from public.profiles where role = 'accountant' and lower(email) = v_email;
end $$;

/**
 * When an invited accountant confirms their email, they get an accountant profile. Postgres fires triggers in name
 * order, so link_accountant_on_signup runs before link_login_on_signup, which then finds the profile and does nothing
 * (an accountant is never given a prospect family).
 */
create function public.link_accountant_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.accountant_invites;
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
  select * into inv from public.accountant_invites where email = lower(trim(new.email));
  if inv.email is null or exists (select 1 from public.profiles where id = new.id) then return new; end if;
  insert into public.profiles (id, role, full_name, email)
  values (new.id, 'accountant',
          coalesce(nullif(trim(inv.full_name), ''), nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                   initcap(regexp_replace(split_part(inv.email, '@', 1), '[._-]+', ' ', 'g'))),
          new.email);
  update public.accountant_invites set accepted_at = now() where email = inv.email;
  return new;
end $$;
create trigger link_accountant_on_signup
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.link_accountant_login();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

create policy "see credit notes" on public.credit_notes for select to authenticated
  using (public.is_finance_reader() or family_id = public.my_family_id());
create policy "see refunds" on public.refunds for select to authenticated
  using (public.is_finance_reader() or family_id = public.my_family_id());
create policy "admin accountant invites" on public.accountant_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The accountant reads the books. Lessons stay hidden (they carry meeting links and home addresses), as do pupils,
-- notes, homework, messages, enquiries, family billing and tutor bank details; tutor pay comes from tutor invoices.
create policy "accountant reads invoices" on public.invoices for select to authenticated using (public.is_accountant());
create policy "accountant reads payments" on public.payments for select to authenticated using (public.is_accountant());
create policy "accountant reads charges" on public.charges for select to authenticated using (public.is_accountant());
create policy "accountant reads packages" on public.packages for select to authenticated using (public.is_accountant());
create policy "accountant reads expenses" on public.expenses for select to authenticated using (public.is_accountant());
create policy "accountant reads tutor invoices" on public.tutor_invoices for select to authenticated using (public.is_accountant());
create policy "accountant reads families" on public.families for select to authenticated using (public.is_accountant());

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $p$create policy "accountant reads receipts" on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and public.is_accountant())$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public._tax_aed(numeric), public._tax_supplier(), public._tax_customer(uuid),
  public._tax_subtotal(public.invoices), public._tax_line_credited(uuid, int),
  public._make_credit_note(public.invoices, text, jsonb, boolean, numeric), public._tax_remaining_lines(public.invoices),
  public._tax_settle_invoice(uuid, boolean), public._issue_credit_from_gross(public.invoices, numeric, text),
  public._map_refund_status(text), public._create_refund(uuid, numeric, text, boolean, text, boolean, text),
  public.settings_guard_numbers(), public.invoices_guard_delete(), public.credit_notes_guard(),
  public.invoices_snapshot_tax(), public.invoices_guard_issued(), public.invoices_cancel_with_credit_note(),
  public.link_accountant_login()
  from public, anon, authenticated;
revoke all on function public.issue_credit_note(uuid, text, jsonb, boolean),
  public.begin_card_refund(uuid, numeric, text, boolean, text),
  public.record_manual_refund(uuid, numeric, text, text, boolean, text),
  public.invite_accountant(text, text), public.remove_accountant(text),
  public.settle_card_refund(uuid, text, text, text), public.record_external_stripe_refund(text, text, numeric, text)
  from public, anon;
grant execute on function public.issue_credit_note(uuid, text, jsonb, boolean),
  public.begin_card_refund(uuid, numeric, text, boolean, text),
  public.record_manual_refund(uuid, numeric, text, text, boolean, text),
  public.invite_accountant(text, text), public.remove_accountant(text) to authenticated;
revoke all on function public.settle_card_refund(uuid, text, text, text), public.record_external_stripe_refund(text, text, numeric, text)
  from authenticated;
grant execute on function public.settle_card_refund(uuid, text, text, text), public.record_external_stripe_refund(text, text, numeric, text)
  to service_role;
