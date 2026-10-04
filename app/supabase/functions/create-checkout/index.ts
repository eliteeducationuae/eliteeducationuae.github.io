// Creates a Stripe Checkout session for the balance of an invoice the caller can see.
// Secrets: STRIPE_SECRET_KEY, APP_URL (where Stripe returns the parent afterwards).
import { corsHeaders, json, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { invoiceId } = await req.json();
    const supabase = userClient(req);

    // Row-level security means this only finds invoices the signed-in parent (or admin) may see.
    const { data: inv, error } = await supabase.from('invoices').select('*, payments(amount), families(email)').eq('id', invoiceId).single();
    if (error || !inv) return json({ error: 'Invoice not found' }, 404);
    if (inv.status !== 'sent') return json({ error: 'This invoice is not payable' }, 400);

    const subtotal = (inv.items as { quantity: number; unitPrice: number }[]).reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const total = Math.round(subtotal * (1 + Number(inv.vat_rate)) * 100) / 100;
    const paid = (inv.payments as { amount: number }[]).reduce((s, p) => s + Number(p.amount), 0);
    const balance = Math.round((total - paid) * 100); // fils
    if (balance <= 0) return json({ error: 'Nothing left to pay' }, 400);

    const appUrl = Deno.env.get('APP_URL') ?? 'https://eliteeducation.me';
    const form = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'aed',
      'line_items[0][price_data][unit_amount]': String(balance),
      'line_items[0][price_data][product_data][name]': `Elite Education invoice ${inv.number}`,
      'metadata[invoice_id]': inv.id,
      'payment_intent_data[metadata][invoice_id]': inv.id,
      success_url: `${appUrl}/invoice/${inv.id}?paid=1`,
      cancel_url: `${appUrl}/invoice/${inv.id}`,
    });
    if (inv.families?.email) form.set('customer_email', inv.families.email);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const session = await res.json();
    if (!res.ok) return json({ error: session.error?.message ?? 'Stripe error' }, 502);
    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
