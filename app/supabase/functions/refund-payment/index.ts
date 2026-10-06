// Refunds part or all of a card payment through Stripe. Signed-in admins only.
//   POST { paymentId, amount, reason, withCreditNote, requestKey }  ->  { refundId, status, message? }
//   status is 'pending' | 'succeeded' | 'failed'.
// The database (begin_card_refund) checks the caller is an admin, the amount against what can still be refunded, and
// whether a credit note is needed, and records the refund as pending before anything is sent to Stripe. The request is
// built only from that stored refund and sent with its own idempotency key, so a retry (the same requestKey) can never
// refund twice. A pending refund first created more than 23 hours ago (Stripe keeps idempotency keys for about a day)
// is looked up among the payment intent's refunds by metadata.refund_id before it is ever sent again. Stripe's answer settles it (settle_card_refund); the webhook settles it too if this function cannot.
// Secrets: STRIPE_SECRET_KEY. Never log request or response bodies here.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import {
  describeRefundFailure,
  findAppRefund,
  mapRefundStatus,
  refundAmountFils,
  refundForm,
  refundIdempotencyKey,
  refundListPath,
  refundNeedsLookup,
} from '../_shared/stripe.ts';
import { stripe, type StripeResult } from '../_shared/stripe-api.ts';
import { refuseViewAs } from '../_shared/view-as.ts';

const NO_KEY = 'Card payments are not set up yet (STRIPE_SECRET_KEY is missing).';
const UNREACHABLE = 'Stripe could not be reached. The refund will update automatically, or try again in a moment.';

type RefundRow = { id: string; invoice_id: string; payment_id: string; amount: number | string; status: string; created_at?: string };

/** A short sentence for a Stripe error response about a refund. Never includes Stripe ids or card numbers. */
function refundErrorMessage(res: StripeResult): string {
  const err = res.body?.error ?? {};
  if (err.code === 'charge_already_refunded') return 'This payment has already been refunded in full.';
  if (err.code === 'amount_too_large') return 'The refund is larger than what is left of this payment in Stripe.';
  if (err.code === 'charge_disputed') return describeRefundFailure('charge_for_pending_refund_disputed');
  if (res.status === 401 || res.status === 403) return 'Stripe did not accept the payment settings. Please check the Stripe key.';
  return 'Stripe could not make this refund.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const refused = await refuseViewAs(req);
    if (refused) return refused;
    if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: NO_KEY }, 500);
    const body = await req.json().catch(() => ({}));
    const paymentId = typeof body?.paymentId === 'string' ? body.paymentId : '';
    const requestKey = typeof body?.requestKey === 'string' ? body.requestKey.trim() : '';
    const amount = Number(body?.amount);
    if (!paymentId || !requestKey) return json({ error: 'Choose a payment to refund.' }, 400);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Enter an amount to refund.' }, 400);

    // Admin check, limits and the pending refund row, all in the database as the signed-in user.
    const { data, error } = await userClient(req).rpc('begin_card_refund', {
      p_payment_id: paymentId,
      p_amount: amount,
      p_reason: typeof body?.reason === 'string' ? body.reason : '',
      p_with_credit_note: body?.withCreditNote === true,
      p_request_key: requestKey,
    });
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 400);
    const row = (Array.isArray(data) ? data[0] : data) as RefundRow | null;
    if (!row?.id) return json({ error: 'The refund could not be started.' }, 500);
    // A retry of a refund Stripe has already answered.
    if (row.status === 'succeeded' || row.status === 'failed') return json({ refundId: row.id, status: row.status });

    const admin = adminClient();
    const { data: payment, error: payError } = await admin.from('payments').select('stripe_payment_intent').eq('id', row.payment_id).single();
    if (payError || !payment?.stripe_payment_intent) return json({ error: 'This payment was not taken by card through Stripe.' }, 400);

    let res: StripeResult | null = null;
    // A retry long after the first attempt: the idempotency key may have expired, so look for the refund first.
    if (refundNeedsLookup(row.created_at, Date.now())) {
      let list: StripeResult | null = null;
      try {
        list = await stripe(refundListPath(payment.stripe_payment_intent as string));
      } catch {
        list = null;
      }
      if (!list?.ok) return json({ refundId: row.id, status: 'pending', message: UNREACHABLE });
      const found = findAppRefund(list.body, row.id);
      if (found) res = { ok: true, status: 200, body: found };
    }
    try {
      if (!res) res = await stripe('/refunds', {
        form: refundForm({
          paymentIntent: payment.stripe_payment_intent as string,
          amountFils: refundAmountFils(row.amount),
          refundId: row.id,
          invoiceId: row.invoice_id,
        }),
        idempotencyKey: refundIdempotencyKey(row.id),
      });
    } catch {
      res = null;
    }
    // No answer at all: the refund may or may not have reached Stripe. It stays pending; the webhook (or a retry with
    // the same requestKey, which resends the same request with the same idempotency key, or after 23 hours looks the
    // refund up first) settles it.
    if (!res || (!res.ok && (res.status >= 500 || res.status === 429 || res.status === 409))) {
      return json({ refundId: row.id, status: 'pending', message: UNREACHABLE });
    }

    if (!res.ok) {
      const message = refundErrorMessage(res);
      const { error: settleError } = await admin.rpc('settle_card_refund', {
        p_refund_id: row.id,
        p_stripe_refund_id: null,
        p_status: 'failed',
        p_failure: message,
      });
      if (settleError) return json({ refundId: row.id, status: 'pending', message: UNREACHABLE });
      return json({ refundId: row.id, status: 'failed', message });
    }

    const status = mapRefundStatus(res.body?.status);
    const failure = status === 'failed' ? describeRefundFailure(res.body?.failure_reason) : null;
    const { error: settleError } = await admin.rpc('settle_card_refund', {
      p_refund_id: row.id,
      p_stripe_refund_id: typeof res.body?.id === 'string' ? res.body.id : null,
      p_status: typeof res.body?.status === 'string' ? res.body.status : 'pending',
      p_failure: failure,
    });
    // Stripe has the refund; the webhook records the outcome if the database could not be updated just now.
    if (settleError) return json({ refundId: row.id, status: 'pending', message: 'The refund was sent to Stripe and will update shortly.' });
    return json({ refundId: row.id, status, ...(failure ? { message: failure } : {}) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
