// Autopay: charges a family's saved card for invoices queued by the database (autopay_status = 'pending').
//   Schedule (every 15 minutes): Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>, body {}: every pending invoice.
//   Admin "Try again": a signed-in admin, body { invoiceId }: that invoice, when it is pending or failed.
// Returns { results: { invoiceId, status: 'succeeded' | 'processing' | 'failed' | 'skipped', error? }[] }.
// Secrets: STRIPE_SECRET_KEY. Never log card or payment details here.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { autopayIdempotencyKey, describeStripeError, invoiceBalanceFils, offSessionIntentForm } from '../_shared/stripe.ts';
import { defaultCard, stripe } from '../_shared/stripe-api.ts';

type Result = { invoiceId: string; status: 'succeeded' | 'processing' | 'failed' | 'skipped'; error?: string };
type Db = ReturnType<typeof adminClient>;

const BATCH = 50;
const NO_CARD = 'No saved card is available';

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

async function failed(db: Db, invoiceId: string, message: string): Promise<Result> {
  const { error } = await db.rpc('autopay_failed', { p_invoice_id: invoiceId, p_message: message });
  return { invoiceId, status: 'failed', error: error ? error.message : message };
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
  const { data: claimed } = await db
    .from('invoices')
    .update({ autopay_status: 'processing', autopay_attempts: (inv.autopay_attempts ?? 0) + 1 })
    .eq('id', id)
    .eq('autopay_attempts', inv.autopay_attempts ?? 0)
    .in('autopay_status', ['pending', 'failed'])
    .select('autopay_attempts')
    .maybeSingle();
  if (!claimed) return { invoiceId: id, status: 'skipped', error: 'This invoice is already being charged.' };

  if (!billing.stripe_customer_id) return await failed(db, id, NO_CARD);
  let card: { id: string } | null;
  try {
    card = await defaultCard(billing.stripe_customer_id);
  } catch {
    return await failed(db, id, describeStripeError(null));
  }
  if (!card) return await failed(db, id, NO_CARD);

  let res;
  try {
    res = await stripe('/payment_intents', {
      form: offSessionIntentForm({
        invoiceId: id,
        invoiceNumber: inv.number,
        familyId: inv.family_id,
        amountFils: balance,
        customerId: billing.stripe_customer_id,
        paymentMethodId: card.id,
      }),
      idempotencyKey: autopayIdempotencyKey(id, claimed.autopay_attempts),
    });
  } catch {
    // If Stripe did take the payment after all, the webhook records it and marks the invoice paid.
    return await failed(db, id, describeStripeError(null));
  }

  const pi = res.ok ? res.body : res.body?.error?.payment_intent;
  if (res.ok && pi?.status === 'succeeded') {
    const { error } = await db.rpc('record_stripe_payment', {
      p_invoice_id: id,
      p_amount: Number(pi.amount_received ?? pi.amount ?? balance) / 100,
      p_payment_intent: pi.id,
      p_session_id: null,
    });
    // The webhook (payment_intent.succeeded) records it too, so a database hiccup here is not lost.
    return error ? { invoiceId: id, status: 'processing', error: error.message } : { invoiceId: id, status: 'succeeded' };
  }
  if (res.ok && pi?.status === 'processing') return { invoiceId: id, status: 'processing' };
  if (res.ok && pi?.status === 'requires_action') return await failed(db, id, describeStripeError({ code: 'authentication_required' }));
  return await failed(db, id, describeStripeError(res.ok ? pi?.last_payment_error : res.body?.error));
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
    let query = db.from('invoices').select('id, number, status, family_id, items, vat_rate, autopay_status, autopay_attempts, payments(amount)');
    if (who === 'admin') query = query.eq('id', invoiceId!).in('autopay_status', ['pending', 'failed']);
    else {
      query = query.eq('autopay_status', 'pending');
      if (invoiceId) query = query.eq('id', invoiceId);
    }
    const { data: invoices, error } = await query.order('issue_date').limit(BATCH);
    if (error) return json({ error: error.message }, 500);
    if (who === 'admin' && !invoices?.length) return json({ error: 'This invoice is not waiting for autopay.' }, 400);

    const results: Result[] = [];
    for (const inv of invoices ?? []) {
      try {
        results.push(await charge(db, inv));
      } catch (e) {
        results.push({ invoiceId: inv.id, status: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
