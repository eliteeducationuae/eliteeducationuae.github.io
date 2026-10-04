-- Elite Education — smoother payments: saved cards, autopay and one-tap lesson top-ups.
-- Card details never touch this database: Stripe keeps the card, and we keep only the brand, the last four
-- digits and the expiry so the app can say "Visa ending 4242". Everything that moves money runs in the
-- Stripe Edge Functions with the service role; families can only switch autopay on or off.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Billing details per family, kept apart from families so tutors (who can see families) never see them.
create table public.family_billing (
  family_id uuid primary key references public.families(id) on delete cascade,
  stripe_customer_id text unique,
  autopay boolean not null default false,
  card_brand text,
  card_last4 text,
  card_expires text, -- 'MM/YY'
  updated_at timestamptz not null default now()
);

-- Lesson bundles parents can buy themselves from the Billing tab ("Buy more lessons").
create table public.package_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  service_id uuid references public.services(id) on delete set null,
  lessons int not null check (lessons between 1 and 200),
  price numeric(10,2) not null check (price > 0),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Autopay progress on each invoice: pending (waiting for charge-invoice) → processing → succeeded / failed.
alter table public.invoices
  add column autopay_status text check (autopay_status in ('pending', 'processing', 'succeeded', 'failed')),
  add column autopay_error text,
  add column autopay_attempts int not null default 0;
create index invoices_autopay_pending_idx on public.invoices (autopay_status) where autopay_status = 'pending';

-- A Stripe payment is recorded once, whichever webhook event (or the charge itself) reports it first.
alter table public.payments add column stripe_payment_intent text unique;
-- Card payments recorded before this change kept the payment intent only in reference, and their payment intents
-- carry the invoice id too: copy it across so a late payment_intent.succeeded cannot record them a second time.
update public.payments p set stripe_payment_intent = p.reference
 where p.method = 'card' and p.stripe_session_id is not null and p.reference like 'pi\_%'
   and p.stripe_payment_intent is null
   and not exists (select 1 from public.payments q where q.stripe_payment_intent = p.reference);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.family_billing enable row level security;
alter table public.package_offers enable row level security;

-- Families read their own billing details; only admins (and the Stripe functions) change them.
create policy "see family billing" on public.family_billing for select to authenticated
  using (public.is_admin() or family_id = public.my_family_id());
create policy "admin family billing" on public.family_billing for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "see package offers" on public.package_offers for select to authenticated
  using (active or public.is_admin());
create policy "admin package offers" on public.package_offers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.family_billing, public.package_offers to authenticated;
revoke all on public.family_billing, public.package_offers from anon;

-- ---------------------------------------------------------------------------
-- Autopay switch (families and admins)
-- ---------------------------------------------------------------------------

create function public.set_autopay(p_family_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare b public.family_billing;
begin
  if not coalesce(public.is_admin() or p_family_id = public.my_family_id(), false) then
    raise exception 'Only the family or an admin can change autopay' using errcode = '42501';
  end if;
  select * into b from public.family_billing where family_id = p_family_id for update;
  if coalesce(p_enabled, false) and b.card_last4 is null then
    raise exception 'Save a card first: pay an invoice or buy lessons by card and it will be kept securely for next time.';
  end if;
  insert into public.family_billing (family_id, autopay, updated_at) values (p_family_id, coalesce(p_enabled, false), now())
  on conflict (family_id) do update set autopay = excluded.autopay, updated_at = now();
end $$;
revoke all on function public.set_autopay(uuid, boolean) from public, anon;
grant execute on function public.set_autopay(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Invoices: queue autopay when an invoice is sent to an autopay family
-- ---------------------------------------------------------------------------

create function public.mark_autopay_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    if exists (select 1 from public.family_billing b
               where b.family_id = new.family_id and b.autopay and b.card_last4 is not null) then
      new.autopay_status := 'pending';
      new.autopay_error := null;
    end if;
  elsif new.status = 'void' and new.autopay_status in ('pending', 'failed') then
    -- A voided invoice must never be charged.
    new.autopay_status := null;
  end if;
  return new;
end $$;
create trigger invoices_autopay before insert or update of status on public.invoices
  for each row execute function public.mark_autopay_pending();

-- ---------------------------------------------------------------------------
-- Stripe functions (service role only: called by the Stripe Edge Functions)
-- ---------------------------------------------------------------------------

/** Record a card payment against an invoice. Safe to call again for the same payment intent or session. */
create function public.record_stripe_payment(p_invoice_id uuid, p_amount numeric, p_payment_intent text, p_session_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- No conflict target, so either unique column (payment intent or checkout session) stops a duplicate.
  insert into public.payments (invoice_id, amount, method, reference, stripe_session_id, stripe_payment_intent)
  values (p_invoice_id, p_amount, 'card', p_payment_intent, p_session_id, p_payment_intent)
  on conflict do nothing;
  update public.invoices set autopay_status = 'succeeded', autopay_error = null
   where id = p_invoice_id and autopay_status is not null;
end $$;

/** A parent paid for a lesson bundle: create the package, a paid invoice as the receipt, and the payment. Idempotent. */
create function public.fulfil_package_offer(
  p_family_id uuid, p_offer_id uuid, p_amount numeric, p_payment_intent text, p_session_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.package_offers;
  fam public.families;
  s public.settings;
  pkg public.packages;
  inv_id uuid;
begin
  if p_payment_intent is null then raise exception 'A payment intent is required'; end if;
  -- Stripe reports a top-up twice (checkout.session.completed and payment_intent.succeeded), possibly at once.
  perform pg_advisory_xact_lock(hashtext(p_payment_intent));
  select invoice_id into inv_id from public.payments where stripe_payment_intent = p_payment_intent;
  if inv_id is not null then return inv_id; end if;

  select * into o from public.package_offers where id = p_offer_id;
  if o.id is null then raise exception 'Lesson offer not found'; end if;
  if not o.active then raise exception 'This lesson offer is no longer available'; end if;
  select * into fam from public.families where id = p_family_id;
  if fam.id is null then raise exception 'Family not found'; end if;
  select * into s from public.settings where id = 1;

  insert into public.packages (family_id, name, service_id, lessons_total, price)
  values (fam.id, o.name, o.service_id, o.lessons, o.price) returning * into pkg;
  -- Created as paid, so the "new invoice due" message never goes out for a receipt.
  insert into public.invoices (number, family_id, issue_date, due_date, status, items, vat_rate)
  values (public.next_invoice_number(), fam.id, current_date, current_date, 'paid',
          jsonb_build_array(jsonb_build_object('description', o.name || ' (' || o.lessons || ' lessons)',
                                               'quantity', 1, 'unitPrice', o.price, 'packageId', pkg.id)),
          s.vat_rate)
  returning id into inv_id;
  insert into public.payments (invoice_id, amount, method, reference, stripe_session_id, stripe_payment_intent)
  values (inv_id, p_amount, 'card', p_payment_intent, p_session_id, p_payment_intent);

  perform public.notify_family(fam.id,
    'Thank you: ' || o.lessons || ' lessons added',
    'Your payment of AED ' || to_char(p_amount, 'FM999,999,990.00') || ' has been received and ' || o.lessons
      || ' lessons have been added to your account. Your receipt is in the Billing tab of the Elite Education app.',
    'Lessons added', o.lessons || ' lessons added to your account', '/parent/billing');
  perform public.notify_admins('Lessons bought: ' || fam.name,
    'The ' || fam.name || ' family bought ' || o.name || ' (' || o.lessons || ' lessons) for AED '
      || to_char(p_amount, 'FM999,999,990.00') || ' by card. The package has been added to their account.',
    'Lessons bought', fam.name || ': ' || o.lessons || ' lessons', '/invoice/' || inv_id);
  return inv_id;
end $$;

/** An autopay charge did not go through: tell the family and the office once, and keep the latest reason. */
create function public.autopay_failed(p_invoice_id uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invoices; fam public.families; balance numeric; amount text; reason text;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.autopay_status = 'failed' then
    update public.invoices set autopay_error = left(p_message, 300) where id = inv.id;
    return;
  end if;
  update public.invoices set autopay_status = 'failed', autopay_error = left(p_message, 300) where id = inv.id;

  select * into fam from public.families where id = inv.family_id;
  -- "…did not go through: your card has expired." reads as one sentence.
  reason := coalesce(nullif(trim(trailing '.' from trim(p_message)), ''), 'the card was declined');
  reason := lower(left(reason, 1)) || substr(reason, 2);
  balance := public.invoice_total(inv) - (select coalesce(sum(p.amount), 0) from public.payments p where p.invoice_id = inv.id);
  amount := 'AED ' || to_char(greatest(balance, 0), 'FM999,999,990.00');
  perform public.notify_family(inv.family_id,
    'We could not take payment for invoice ' || inv.number,
    'We tried to take ' || amount || ' for invoice ' || inv.number || ' using your saved card, but the payment did not go through: '
      || reason || '. Please update your card with Manage cards in the Billing tab, or pay the invoice in the Elite Education app.',
    'Payment not taken', 'Invoice ' || inv.number || ': ' || amount || ' could not be charged', '/invoice/' || inv.id);
  perform public.notify_admins('Autopay failed: ' || inv.number || ' (' || fam.name || ')',
    'Autopay could not take ' || amount || ' for invoice ' || inv.number || ' from the ' || fam.name || ' family: '
      || reason || '. The family has been asked to update their card or pay in the app.',
    'Autopay failed', inv.number || ' (' || fam.name || ')', '/invoice/' || inv.id);
end $$;

/** Keep the saved-card summary in step with Stripe. No card left means autopay switches off. */
create function public.set_family_card(p_customer_id text, p_brand text, p_last4 text, p_expires text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_last4 is null then
    update public.family_billing set card_brand = null, card_last4 = null, card_expires = null, autopay = false, updated_at = now()
     where stripe_customer_id = p_customer_id;
  else
    update public.family_billing set card_brand = p_brand, card_last4 = p_last4, card_expires = p_expires, updated_at = now()
     where stripe_customer_id = p_customer_id;
  end if;
end $$;

/** Remember the Stripe customer for a family. Never replaces a customer that is already linked. */
create function public.link_stripe_customer(p_family_id uuid, p_customer_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.family_billing (family_id, stripe_customer_id) values (p_family_id, p_customer_id)
  on conflict (family_id) do update
    set stripe_customer_id = coalesce(family_billing.stripe_customer_id, excluded.stripe_customer_id), updated_at = now();
end $$;

revoke all on function public.record_stripe_payment(uuid, numeric, text, text),
  public.fulfil_package_offer(uuid, uuid, numeric, text, text),
  public.autopay_failed(uuid, text),
  public.set_family_card(text, text, text, text),
  public.link_stripe_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(uuid, numeric, text, text),
  public.fulfil_package_offer(uuid, uuid, numeric, text, text),
  public.autopay_failed(uuid, text),
  public.set_family_card(text, text, text, text),
  public.link_stripe_customer(uuid, text) to service_role;
