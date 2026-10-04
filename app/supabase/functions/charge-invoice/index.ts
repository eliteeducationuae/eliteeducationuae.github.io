// Autopay: charges a family's saved card for invoices queued by the database (autopay_status = 'pending').
//   Schedule (every 15 minutes): Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>, body {}: every pending invoice, and
//     every charge whose outcome is not known yet ('unknown', or 'processing' for more than 30 minutes).
//   Admin: a signed-in admin, body { invoiceId }: charges that invoice when it is pending or failed, or asks Stripe
//     for the outcome of its last charge when that is unknown (never a second charge).
// Returns { results: { invoiceId, status: 'succeeded' | 'processing' | 'unknown' | 'pending' | 'failed' | 'skipped', error? }[] }.
// Secrets: STRIPE_SECRET_KEY. Never log card or payment details here.
//
// Never charging twice: each attempt has its own idempotency key, and exactly what was sent is kept in autopay_requests.
// When Stripe cannot be reached mid-charge the invoice becomes 'unknown' (still held from the family), and the next run
// resends that same request with that same key: Stripe answers with the original result, or makes the charge once if
// the first request never arrived. It is resent only while the invoice still wants exactly that charge (still sent,
// autopay still on, the balance still at least that amount, the key under 23 hours old: autopayReplayAllowed);
// otherwise the payment intent is only looked up, never charged again. Only an answer about the card counts as a
// decline (classifyAutopayResponse); any other error keeps the invoice 'unknown' and held from the family.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import {
  autopayIdempotencyKey,
  autopayIntentListPath,
  autopayReplayAllowed,
  classifyAutopayResponse,
  findAutopayIntent,
  invoiceBalanceFils,
  offSessionIntentForm,
} from '../_shared/stripe.ts';
import { defaultCard, stripe, type StripeResult } from '../_shared/stripe-api.ts';

type Status = 'succeeded' | 'processing' | 'unknown' | 'pending' | 'failed' | 'skipped';
type Result = { invoiceId: string; status: Status; error?: string };
type Db = ReturnType<typeof adminClient>;

/** Invoices per run, and the time after which a run stops starting new charges (Edge Functions have a wall-clock limit). */
const BATCH = 20;
const TIME_BUDGET_MS = 90_000;
/** A charge still 'processing' after this long is checked again with Stripe (a missed webhook, or a run that stopped). */
const STALE_MINUTES = 30;
/** Wait before resending after a network error, so a request still running at Stripe has usually finished. */
const RETRY_DELAY_MS = 2_000;
/** A request this recent may still be running at Stripe, so not finding its payment intent proves nothing yet. */
const SETTLE_MINUTES = 10;
/** Pages of a customer's payment intents read when looking an attempt up (100 each). */
const LOOKUP_PAGES = 5;

const NO_CARD = 'No saved card is available';
/** Stripe could not be reached during a charge. */
const UNREACHABLE = 'The card processor could not be reached, so it is not yet known whether the payment went through.';
const OFFLINE = 'The card processor could not be reached. Nothing was charged; autopay will try again shortly.';

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 'schedule' for the service role key, 'admin' for a signed-in admin, otherwise null. */
async function caller(req: Request): Promise<'schedule' | 'admin' | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (sameSecret(token, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return 'schedule';
  if (!token) return null;
  const supabase = userClient(req);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  return profile?.role === 'admin' ? 'admin' : null;
}

/** A real decline: the invoice is marked failed and the family and the office are told (once). */
async function failed(db: Db, invoiceId: string, attempt: number, message: string): Promise<Result> {
  const { error } = await db.rpc('autopay_failed', { p_invoice_id: invoiceId, p_message: message, p_attempt: attempt, p_tell_family: true });
  return { invoiceId, status: 'failed', error: error ? error.message : message };
}

/**
 * The card may or may not have been charged. The invoice is marked 'unknown': it stays held from the family (no Pay
 * button, no bank details), the office is asked to check (once), and the next run asks Stripe again.
 */
async function unknown(db: Db, invoiceId: string, attempt: number): Promise<Result> {
  const { error } = await db.rpc('autopay_failed', { p_invoice_id: invoiceId, p_message: UNREACHABLE, p_attempt: attempt, p_tell_family: false });
  return { invoiceId, status: 'unknown', error: error ? error.message : UNREACHABLE };
}

/** Nothing reached Stripe: hand the attempt back as it was, to be tried again. */
async function release(db: Db, invoiceId: string, attempt: number, to: 'pending' | 'failed', message: string): Promise<Result> {
  await db.from('invoices').update({ autopay_status: to }).eq('id', invoiceId).eq('autopay_attempts', attempt).in('autopay_status', ['processing', 'unknown']);
  return { invoiceId, status: to === 'pending' ? 'pending' : 'failed', error: message };
}

/** Sends an autopay request. A network error is retried once with the same key; null means Stripe could not be reached. */
async function send(form: URLSearchParams, idempotencyKey: string): Promise<StripeResult | null> {
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      return await stripe('/payment_intents', { form, idempotencyKey });
    } catch {
      // The request may or may not have reached Stripe; the same key makes trying again safe.
    }
  }
  return null;
}

/** Turns Stripe's answer for an attempt into the invoice's new state. Only an answer about the card is a decline. */
async function settle(db: Db, id: string, attempt: number, res: StripeResult | null, balanceFils: number): Promise<Result> {
  const answer = classifyAutopayResponse(res);
  if (answer.outcome === 'unknown') return await unknown(db, id, attempt);
  if (answer.outcome === 'declined') return await failed(db, id, attempt, answer.message);
  const pi = answer.intent;
  if (answer.outcome === 'processing') {
    // Stripe has answered: the charge is under way, no longer unknown. The webhook settles it; a stale one is checked again.
    await db
      .from('invoices')
      .update({ autopay_status: 'processing', autopay_error: null, autopay_claimed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('autopay_attempts', attempt)
      .eq('autopay_status', 'unknown');
    return { invoiceId: id, status: 'processing' };
  }
  const { error } = await db.rpc('record_stripe_payment', {
    p_invoice_id: id,
    p_amount: Number(pi.amount_received ?? pi.amount ?? balanceFils) / 100,
    p_payment_intent: pi.id,
    p_session_id: null,
    p_autopay: true,
  });
  // The webhook (payment_intent.succeeded) records it too, so a database hiccup here is not lost.
  return error ? { invoiceId: id, status: 'processing', error: error.message } : { invoiceId: id, status: 'succeeded' };
}

/**
 * Finds the payment intent of one attempt among the customer's payment intents created since it was sent. The list
 * endpoint is strongly consistent, so null means the request never reached Stripe. Throws when Stripe cannot answer.
 */
async function lookUp(customerId: string, invoiceId: string, attempt: number, sentAt: string): Promise<Record<string, unknown> | null> {
  let after: string | undefined;
  for (let page = 0; page < LOOKUP_PAGES; page++) {
    const res = await stripe(autopayIntentListPath(customerId, sentAt, after));
    if (!res.ok) throw new Error(`Stripe could not list payment intents (${res.status})`);
    const pi = findAutopayIntent(res.body, invoiceId, attempt);
    if (pi) return pi;
    const data = Array.isArray(res.body?.data) ? res.body.data : [];
    if (!res.body?.has_more || !data.length) return null;
    after = data[data.length - 1]?.id;
  }
  // More payment intents than expected for one family: do not guess.
  throw new Error('Too many payment intents to search');
}

/** The payment intent as it is now (a replayed request returns it as it was then). Falls back to what was given. */
async function latest(res: StripeResult): Promise<StripeResult> {
  const id = res.ok ? res.body?.id : null;
  if (typeof id !== 'string' || res.body?.status === 'succeeded') return res;
  try {
    const now = await stripe(`/payment_intents/${encodeURIComponent(id)}`);
    return now.ok ? now : res;
  } catch {
    return res;
  }
}

// deno-lint-ignore no-explicit-any
async function charge(db: Db, inv: any): Promise<Result> {
  const id: string = inv.id;
  if (inv.status !== 'sent') {
    // Paid another way, or voided: nothing to charge.
    await db.from('invoices').update({ autopay_status: null }).eq('id', id).in('autopay_status', ['pending', 'failed']);
    return { invoiceId: id, status: 'skipped', error: 'This invoice is no longer awaiting payment.' };
  }
  const { data: billing } = await db.from('family_billing').select('stripe_customer_id, autopay').eq('family_id', inv.family_id).maybeSingle();
  if (!billing?.autopay) {
    await db.from('invoices').update({ autopay_status: null }).eq('id', id).in('autopay_status', ['pending', 'failed']);
    return { invoiceId: id, status: 'skipped', error: 'Autopay is switched off for this family.' };
  }

  const balance = invoiceBalanceFils(inv.items, inv.vat_rate, inv.payments ?? []);
  if (balance <= 0) {
    await db.from('invoices').update({ autopay_status: 'succeeded', autopay_error: null }).eq('id', id);
    return { invoiceId: id, status: 'skipped' };
  }

  // Claim the invoice so two runs (or a run and an admin retry) never charge it twice.
  const previous: 'pending' | 'failed' = inv.autopay_status === 'failed' ? 'failed' : 'pending';
  const { data: claimed } = await db
    .from('invoices')
    .update({ autopay_status: 'processing', autopay_attempts: (inv.autopay_attempts ?? 0) + 1, autopay_claimed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('autopay_attempts', inv.autopay_attempts ?? 0)
    .in('autopay_status', ['pending', 'failed'])
    .select('autopay_attempts')
    .maybeSingle();
  if (!claimed) return { invoiceId: id, status: 'skipped', error: 'This invoice is already being charged.' };

  const attempt: number = claimed.autopay_attempts;
  if (!billing.stripe_customer_id) return await failed(db, id, attempt, NO_CARD);
  let card: { id: string } | null;
  try {
    card = await defaultCard(billing.stripe_customer_id);
  } catch {
    // Nothing has been sent yet, so nothing was charged: put the invoice back and try again on the next run.
    return await release(db, id, attempt, previous, OFFLINE);
  }
  if (!card) return await failed(db, id, attempt, NO_CARD);

  const form = offSessionIntentForm({
    invoiceId: id,
    invoiceNumber: inv.number,
    familyId: inv.family_id,
    amountFils: balance,
    customerId: billing.stripe_customer_id,
    paymentMethodId: card.id,
    attempt,
  });
  // Keep the exact request first, so an unknown outcome can always be settled by sending it again.
  const kept = await db.from('autopay_requests').insert({ invoice_id: id, attempt, request: Object.fromEntries(form) });
  if (kept.error) return await release(db, id, attempt, previous, kept.error.message);

  return await settle(db, id, attempt, await send(form, autopayIdempotencyKey(id, attempt)), balance);
}

/** Learns what happened to a charge whose outcome is unknown, without ever charging twice. */
// deno-lint-ignore no-explicit-any
async function resolve(db: Db, inv: any): Promise<Result> {
  const id: string = inv.id;
  const attempt: number = inv.autopay_attempts ?? 0;
  const startedAt: number = inv.autopay_claimed_at ? Date.parse(inv.autopay_claimed_at) : 0;
  if (inv.autopay_status === 'processing' && Date.now() - startedAt < STALE_MINUTES * 60_000) {
    return { invoiceId: id, status: 'skipped', error: 'This invoice is already being charged.' };
  }
  // Take this check for ourselves (claimed_at changes), so two runs never settle the same attempt at once.
  let take = db
    .from('invoices')
    .update({ autopay_claimed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('autopay_attempts', attempt)
    .eq('autopay_status', inv.autopay_status);
  take = inv.autopay_claimed_at ? take.eq('autopay_claimed_at', inv.autopay_claimed_at) : take.is('autopay_claimed_at', null);
  const { data: taken } = await take.select('id').maybeSingle();
  if (!taken) return { invoiceId: id, status: 'skipped', error: 'This invoice is already being checked.' };

  const { data: sent } = await db.from('autopay_requests').select('request, sent_at').eq('invoice_id', id).eq('attempt', attempt).maybeSingle();
  if (!sent) {
    // The run stopped before anything was sent to Stripe, so nothing was charged: queue a fresh attempt (charge()
    // checks the invoice and autopay again before it charges anything).
    return await release(db, id, attempt, 'pending', 'Nothing was sent to the card processor; autopay will try again shortly.');
  }
  const amount = Number(sent.request?.amount ?? 0);

  // The invoice as it is now: the office may have voided it or recorded a payment, or the family switched autopay off,
  // since the charge was sent. Resending is only safe while it still wants exactly that charge.
  const { data: now } = await db.from('invoices').select('status, family_id, items, vat_rate, payments(amount)').eq('id', id).maybeSingle();
  if (!now) return { invoiceId: id, status: 'skipped', error: 'This invoice no longer exists.' };
  const { data: billing } = await db.from('family_billing').select('stripe_customer_id, autopay').eq('family_id', now.family_id).maybeSingle();
  const chargeable = now.status === 'sent' && billing?.autopay === true;
  const replay = autopayReplayAllowed({
    invoiceStatus: now.status,
    autopay: billing?.autopay,
    balanceFils: invoiceBalanceFils(now.items, now.vat_rate, now.payments ?? []),
    requestAmountFils: amount,
    sentAt: sent.sent_at,
    now: Date.now(),
  });
  if (replay) {
    const res = await send(new URLSearchParams(sent.request), autopayIdempotencyKey(id, attempt));
    return await settle(db, id, attempt, res && (await latest(res)), amount);
  }

  // Look the payment up only; never send the charge again.
  const customer = typeof sent.request?.customer === 'string' ? sent.request.customer : billing?.stripe_customer_id;
  if (!customer) return await unknown(db, id, attempt);
  let pi: Record<string, unknown> | null;
  try {
    pi = await lookUp(customer, id, attempt, sent.sent_at);
  } catch {
    return await unknown(db, id, attempt);
  }
  if (pi) return await settle(db, id, attempt, { ok: true, status: 200, body: pi }, amount);
  if (Date.now() - Date.parse(sent.sent_at) < SETTLE_MINUTES * 60_000) return await unknown(db, id, attempt);
  if (chargeable) {
    // Never charged, and the invoice still wants paying: a fresh attempt charges the balance as it is now.
    return await release(db, id, attempt, 'pending', 'The earlier charge never reached the card processor; autopay will try again shortly.');
  }
  // Never charged, and the invoice no longer wants autopay (voided, paid another way, or autopay switched off).
  await db
    .from('invoices')
    .update({ autopay_status: null, autopay_error: null })
    .eq('id', id)
    .eq('autopay_attempts', attempt)
    .in('autopay_status', ['processing', 'unknown']);
  return { invoiceId: id, status: 'skipped', error: 'No charge was made, and this invoice no longer needs autopay.' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const who = await caller(req);
    if (!who) return json({ error: 'Only the schedule or an admin can run autopay.' }, 403);
    if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'Card payments are not set up yet (STRIPE_SECRET_KEY is missing).' }, 500);
    const body = await req.json().catch(() => ({}));
    const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : null;
    if (who === 'admin' && !invoiceId) return json({ error: 'Choose an invoice to charge.' }, 400);

    const db = adminClient();
    let query = db
      .from('invoices')
      .select('id, number, status, family_id, items, vat_rate, autopay_status, autopay_attempts, autopay_claimed_at, payments(amount)');
    if (who === 'admin') query = query.eq('id', invoiceId!).in('autopay_status', ['pending', 'failed', 'unknown', 'processing']);
    else {
      const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
      query = query.or(
        `autopay_status.in.(pending,unknown),and(autopay_status.eq.processing,autopay_claimed_at.lt.${stale}),` +
          'and(autopay_status.eq.processing,autopay_claimed_at.is.null)',
      );
      if (invoiceId) query = query.eq('id', invoiceId);
    }
    const { data: invoices, error } = await query.order('issue_date').limit(BATCH);
    if (error) return json({ error: error.message }, 500);
    if (who === 'admin' && !invoices?.length) return json({ error: 'This invoice is not waiting for autopay.' }, 400);

    const results: Result[] = [];
    const started = Date.now();
    for (const inv of invoices ?? []) {
      // Whatever is left waits for the next run (every 15 minutes) rather than risk the function being stopped mid-charge.
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        const open = inv.autopay_status === 'unknown' || inv.autopay_status === 'processing';
        results.push(await (open ? resolve(db, inv) : charge(db, inv)));
      } catch (e) {
        results.push({ invoiceId: inv.id, status: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
