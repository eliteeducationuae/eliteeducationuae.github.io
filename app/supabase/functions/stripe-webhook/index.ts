// Records card payments and keeps saved cards in step with Stripe. Point a Stripe webhook here for:
//   checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed,
//   payment_method.attached, payment_method.detached, customer.updated
// Deploy with --no-verify-jwt (Stripe cannot send a Supabase login; the signature check below protects it).
// Secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY.
// Every handler is safe to repeat: Stripe retries on any non-2xx response and may send events more than once.
import { adminClient } from '../_shared/supabase.ts';
import { classifyEvent, verifyStripeSignature } from '../_shared/stripe.ts';
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
        });
        if (error) return new Response(error.message, { status: 500 });
        await rememberCard(event.customerId, event.paymentMethodId);
        break;
      }
      case 'offer-paid': {
        const { error } = await db.rpc('fulfil_package_offer', {
          p_family_id: event.familyId,
          p_offer_id: event.offerId,
          p_amount: event.amount,
          p_payment_intent: event.paymentIntent,
          p_session_id: event.sessionId ?? null,
        });
        if (error) return new Response(error.message, { status: 500 });
        await rememberCard(event.customerId, event.paymentMethodId);
        break;
      }
      case 'payment-failed': {
        // Declines inside Checkout are shown to the parent there and they can try again, so only autopay is reported.
        if (!event.autopay) break;
        const { error } = await db.rpc('autopay_failed', { p_invoice_id: event.invoiceId, p_message: event.message });
        if (error) return new Response(error.message, { status: 500 });
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
