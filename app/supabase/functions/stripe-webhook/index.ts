// Records card payments from Stripe. Point a Stripe webhook (checkout.session.completed) here.
// Deploy with --no-verify-jwt. Secrets: STRIPE_WEBHOOK_SECRET.
import { adminClient } from '../_shared/supabase.ts';

const TOLERANCE_SECONDS = 300;

async function verify(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  const signatures = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get('stripe-signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET')!))) {
    return new Response('Invalid signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoice_id;
    if (invoiceId) {
      // stripe_session_id is unique, so Stripe retries can't double-record a payment.
      const { error } = await adminClient()
        .from('payments')
        .upsert(
          { invoice_id: invoiceId, amount: session.amount_total / 100, method: 'card', reference: session.payment_intent, stripe_session_id: session.id },
          { onConflict: 'stripe_session_id', ignoreDuplicates: true },
        );
      if (error) return new Response(error.message, { status: 500 });
    }
  }
  return new Response('ok');
});
