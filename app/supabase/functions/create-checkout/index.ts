// Creates a Stripe Checkout session and returns its { url }.
//   { invoiceId }  pays the balance of an invoice the caller can see (parent or admin).
//   { offerId }    a parent buys a lesson bundle ("Buy more lessons"); the webhook adds the package.
// The card is saved to the family's Stripe customer for next time (and for autopay, if the family turns it on).
// Apple Pay and Google Pay appear automatically once switched on in the Stripe Dashboard.
// Secrets: STRIPE_SECRET_KEY, APP_URL (where Stripe returns the parent afterwards).
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { checkoutInvoiceForm, checkoutOfferForm, invoiceBalanceFils, offerChargeFils } from '../_shared/stripe.ts';
import { ensureCustomer, stripe } from '../_shared/stripe-api.ts';

const appUrl = () => (Deno.env.get('APP_URL') ?? 'https://eliteeducation.me').replace(/\/+$/, '');

async function invoiceCheckout(req: Request, invoiceId: string) {
  const supabase = userClient(req);
  // Row-level security means this only finds invoices the signed-in parent (or admin) may see.
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('id, number, status, items, vat_rate, family_id, payments(amount)')
    .eq('id', invoiceId)
    .single();
  if (error || !inv) return json({ error: 'Invoice not found' }, 404);
  if (inv.status !== 'sent') return json({ error: 'This invoice is not payable' }, 400);

  const balance = invoiceBalanceFils(inv.items, inv.vat_rate, inv.payments ?? []);
  if (balance <= 0) return json({ error: 'Nothing left to pay' }, 400);

  const admin = adminClient();
  const { data: family, error: famError } = await admin.from('families').select('id, name, parent_name, email').eq('id', inv.family_id).single();
  if (famError || !family) return json({ error: 'Family not found' }, 404);
  const customerId = await ensureCustomer(admin, family);
  const res = await stripe('/checkout/sessions', {
    form: checkoutInvoiceForm({ invoiceId: inv.id, invoiceNumber: inv.number, balanceFils: balance, customerId, familyId: family.id, appUrl: appUrl() }),
  });
  if (!res.ok) return json({ error: res.body?.error?.message ?? 'Stripe error' }, 502);
  return json({ url: res.body.url });
}

async function offerCheckout(req: Request, offerId: string) {
  const supabase = userClient(req);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
  const { data: profile } = await supabase.from('profiles').select('role, family_id').eq('id', auth.user.id).single();
  if (profile?.role !== 'parent' || !profile.family_id) return json({ error: 'Only parents can buy lessons' }, 403);

  // Row-level security only shows parents active offers.
  const { data: offer } = await supabase.from('package_offers').select('id, name, lessons, price, active').eq('id', offerId).maybeSingle();
  if (!offer || !offer.active) return json({ error: 'This lesson bundle is no longer available.' }, 404);
  const { data: settings } = await supabase.from('settings').select('vat_rate').eq('id', 1).single();
  const amount = offerChargeFils(offer.price, settings?.vat_rate ?? 0);

  const admin = adminClient();
  const { data: family, error } = await admin.from('families').select('id, name, parent_name, email').eq('id', profile.family_id).single();
  if (error || !family) return json({ error: 'Family not found' }, 404);
  const customerId = await ensureCustomer(admin, family);
  const res = await stripe('/checkout/sessions', {
    form: checkoutOfferForm({ offer, amountFils: amount, customerId, familyId: family.id, appUrl: appUrl() }),
  });
  if (!res.ok) return json({ error: res.body?.error?.message ?? 'Stripe error' }, 502);
  return json({ url: res.body.url });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.invoiceId === 'string') return await invoiceCheckout(req, body.invoiceId);
    if (typeof body?.offerId === 'string') return await offerCheckout(req, body.offerId);
    return json({ error: 'Choose an invoice or a lesson bundle to pay for.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
