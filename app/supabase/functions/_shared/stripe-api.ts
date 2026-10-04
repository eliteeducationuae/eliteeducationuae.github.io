// Small Stripe REST client for the Edge Functions (no SDK needed). Secret: STRIPE_SECRET_KEY.
// Never log request bodies or responses here: they can contain card details.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { cardSummary, customerForm } from './stripe.ts';

const API = 'https://api.stripe.com/v1';

// deno-lint-ignore no-explicit-any
export type StripeResult = { ok: boolean; status: number; body: any };

/** Calls the Stripe API. GET when no form is given; POST otherwise. */
export async function stripe(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; form?: URLSearchParams; idempotencyKey?: string } = {},
): Promise<StripeResult> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return { ok: false, status: 500, body: { error: { message: 'Card payments are not set up yet (STRIPE_SECRET_KEY is missing).' } } };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (opts.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${API}${path}`, { method: opts.method ?? (opts.form ? 'POST' : 'GET'), headers, body: opts.form });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export type BillingFamily = { id: string; name?: string | null; parent_name?: string | null; email?: string | null };

/** The family's Stripe customer id, creating and linking the customer the first time. */
export async function ensureCustomer(admin: SupabaseClient, family: BillingFamily): Promise<string> {
  const { data: billing, error } = await admin.from('family_billing').select('stripe_customer_id').eq('family_id', family.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (billing?.stripe_customer_id) return billing.stripe_customer_id as string;

  const name = family.parent_name || family.name || undefined;
  const res = await stripe('/customers', {
    form: customerForm({ familyId: family.id, email: family.email, name }),
    // Two taps at once still make one customer.
    idempotencyKey: `customer-${family.id}`,
  });
  if (!res.ok) throw new Error(res.body?.error?.message ?? 'Stripe could not create the customer');
  const link = await admin.rpc('link_stripe_customer', { p_family_id: family.id, p_customer_id: res.body.id });
  if (link.error) throw new Error(link.error.message);
  // Another request may have linked a customer first; the stored one always wins.
  const { data: after } = await admin.from('family_billing').select('stripe_customer_id').eq('family_id', family.id).maybeSingle();
  return (after?.stripe_customer_id as string) ?? (res.body.id as string);
}

/** The card autopay should use: the customer's default, else the first saved card. */
export async function defaultCard(customerId: string): Promise<{ id: string; card: unknown } | null> {
  const cust = await stripe(`/customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`);
  if (!cust.ok) throw new Error(cust.body?.error?.message ?? 'Stripe could not load the customer');
  const pm = cust.body?.invoice_settings?.default_payment_method;
  if (pm && typeof pm === 'object' && pm.type === 'card') return pm;
  const list = await stripe(`/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=1`);
  if (!list.ok) throw new Error(list.body?.error?.message ?? 'Stripe could not list the saved cards');
  return list.body?.data?.[0] ?? null;
}

/** Copies the saved card's brand, last four digits and expiry into family_billing (or clears them). */
export async function refreshCard(admin: SupabaseClient, customerId: string): Promise<void> {
  const pm = await defaultCard(customerId);
  const card = cardSummary(pm);
  const { error } = await admin.rpc('set_family_card', {
    p_customer_id: customerId,
    p_brand: card?.brand ?? null,
    p_last4: card?.last4 ?? null,
    p_expires: card?.expires || null,
  });
  if (error) throw new Error(error.message);
}

/** Makes the card the family last paid with their default, so autopay uses it. */
export async function setDefaultCard(customerId: string, paymentMethodId: string): Promise<StripeResult> {
  return await stripe(`/customers/${encodeURIComponent(customerId)}`, {
    form: new URLSearchParams({ 'invoice_settings[default_payment_method]': paymentMethodId }),
  });
}
