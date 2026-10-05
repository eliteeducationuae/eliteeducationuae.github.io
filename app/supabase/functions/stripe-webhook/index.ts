// Records card payments and keeps saved cards in step with Stripe. Point a Stripe webhook here for:
//   checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed,
//   payment_method.attached, payment_method.detached, customer.updated
// Deploy with --no-verify-jwt (Stripe cannot send a Supabase login; the signature check below protects it).
// Secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY.
// Every handler is safe to repeat: Stripe retries on any non-2xx response and may send events more than once.
// Permanent data errors (a deleted invoice or family) are acknowledged with 200 and logged, so Stripe does not retry them.
// When that happens to money already taken (invoice-paid, offer-paid), the office is alerted so it can be reconciled by hand.
import { adminClient } from '../_shared/supabase.ts';
import { classifyEvent, isPermanentWebhookError, verifyStripeSignature } from '../_shared/stripe.ts';
import { refreshCard, setDefaultCard } from '../_shared/stripe-api.ts';

/** After a card payment, make that card the default for autopay and update the card shown in the app. */
async function rememberCard(customerId?: string, paymentMethodId?: string) {
  if (!customerId || !paymentMethodId) return;
  try {
    await setDefaultCard(customerId, paymentMethodId);
    await refreshCard(adminClient(), customerId);
  } catch (e) {
    // The payment is already recorded; the card summary catches up on the next card event.
    console.error('Could not refresh the saved card', e instanceof Error ? e.message : String(e));
  }
}

/**
 * The response for a failed database call: 500 so Stripe retries a transient error, but 200 for a permanent one
 * (for example the invoice has been deleted), which would only fail again for days. Both are logged. A permanent
 * failure on a payment that has already been taken also alerts the office, since Stripe will no longer report it.
 */
async function rpcFailure(
  db: ReturnType<typeof adminClient>,
  event: { kind: string; paymentIntent?: string; amount?: number },
  error: { code?: string | null; message: string },
): Promise<Response> {
  const permanent = isPermanentWebhookError(error);
  console.error(`Stripe webhook ${event.kind} failed${permanent ? ' permanently; acknowledged without retry' : ''}`, error.code ?? '', error.message);
  if (permanent && (event.kind === 'invoice-paid' || event.kind === 'offer-paid')) {
    const { error: alertError } = await db.rpc('alert_unrecorded_payment', {
      p_kind: event.kind,
      p_payment_intent: event.paymentIntent ?? null,
      p_amount: event.amount ?? null,
      p_error: error.message,
    });
    // Without the alert nobody would know about the payment, so let Stripe keep retrying (and emailing the owner).
    if (alertError) {
      console.error('Could not alert the office about an unrecorded payment', alertError.message);
      return new Response(error.message, { status: 500 });
    }
  }
  return new Response(error.message, { status: permanent ? 200 : 500 });
}

Deno.serve(async (req) => {
  const payload = await req.text();
  const ok = await verifyStripeSignature(payload, req.headers.get('stripe-signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET'), Date.now() / 1000);
  if (!ok) return new Response('Invalid signature', { status: 400 });

  const event = classifyEvent(JSON.parse(payload));
  const db = adminClient();
  try {
    switch (event.kind) {
      case 'invoice-paid': {
        const { error } = await db.rpc('record_stripe_payment', {
          p_invoice_id: event.invoiceId,
          p_amount: event.amount,
          p_payment_intent: event.paymentIntent,
          p_session_id: event.sessionId ?? null,
          p_autopay: event.autopay,
        });
        if (error) return await rpcFailure(db, event, error);
        await rememberCard(event.customerId, event.paymentMethodId);
        break;
      }
      case 'offer-paid': {
        // Fulfilled from what the parent was shown at Checkout, even if the offer has since been hidden or deleted.
        const { error } = await db.rpc('fulfil_package_offer', {
          p_family_id: event.familyId,
          p_offer_id: event.offerId,
          p_amount: event.amount,
          p_payment_intent: event.paymentIntent,
          p_session_id: event.sessionId ?? null,
          p_name: event.snapshot?.name ?? null,
          p_lessons: event.snapshot?.lessons ?? null,
          p_price: event.snapshot?.price ?? null,
          p_service_id: event.snapshot?.serviceId ?? null,
          p_vat_rate: event.snapshot?.vatRate ?? null,
        });
        if (error) return await rpcFailure(db, event, error);
        await rememberCard(event.customerId, event.paymentMethodId);
        break;
      }
      case 'payment-failed': {
        // Declines inside Checkout are shown to the parent there and they can try again, so only autopay is reported.
        if (!event.autopay) break;
        // The database ignores failures that arrive late: for an earlier attempt, or once the invoice is paid or void.
        const { error } = await db.rpc('autopay_failed', {
          p_invoice_id: event.invoiceId,
          p_message: event.message,
          p_attempt: event.attempt ?? null,
        });
        if (error) return await rpcFailure(db, event, error);
        break;
      }
      case 'card-changed':
        await refreshCard(db, event.customerId);
        break;
    }
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
  }
  return new Response('ok');
});
