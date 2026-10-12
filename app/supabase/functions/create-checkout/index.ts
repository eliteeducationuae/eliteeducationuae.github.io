// Creates a Stripe Checkout session and returns its { url }.
//   { invoiceId }  pays the balance of an invoice the caller can see (parent or admin).
//   { offerId }    a parent buys a lesson package ("Buy more lessons"); the webhook adds the package.
// Paying an invoice that autopay is waiting to charge takes it out of autopay first, so it is never charged twice.
// The card is saved to the family's Stripe customer for next time (and for autopay, if the family turns it on).
// Apple Pay and Google Pay appear automatically once switched on in the Stripe Dashboard.
// Secrets: STRIPE_SECRET_KEY, APP_URL (where Stripe returns the parent afterwards).
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';
import { refuseViewAs } from '../_shared/view-as.ts';
import { checkoutInvoiceForm, checkoutOfferForm, invoiceBalanceFils, offerChargeFils } from '../_shared/stripe.ts';
import { ensureCustomer, stripe } from '../_shared/stripe-api.ts';

const CHARGING = 'Your saved card is being charged for this invoice. Please wait a moment and refresh.';

/** Credit notes and refunds, embedded so the balance matches invoice_balance in the database. */
const ADJUSTMENTS = 'credit_notes!credit_notes_invoice_id_fkey(total), refunds!refunds_invoice_id_fkey(amount, status)';

const OFFER_GONE = 'This lesson package is no longer available.';

/** The app's address, e.g. https://eliteeducation.me/app. Never guessed: Stripe must return parents to the app. */
const appUrl = () => (Deno.env.get('APP_URL') ?? '').trim().replace(/\/+$/, '');
const NO_APP_URL = 'Card payments are not set up yet (APP_URL is missing).';

/** Stripe's own error text stays in the logs (it can name Stripe ids); the family sees a plain sentence. */
function stripeFailure(res: { status: number; body: { error?: { message?: string } } | null }) {
  console.error('create-checkout: Stripe refused the session', res.status, res.body?.error?.message ?? '');
  return json({ error: 'The card payment page could not be opened just now. Please try again in a moment.' }, 502);
}

async function invoiceCheckout(req: Request, invoiceId: string) {
  const supabase = userClient(req);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
  // Only the family itself (a parent login) or the office may pay, or take an invoice out of autopay: the accountant
  // and tutors may be able to read some invoices, but must never start a payment.
  const { data: profile } = await supabase.from('profiles').select('role, family_id').eq('id', auth.user.id).single();
  if (profile?.role !== 'parent' && profile?.role !== 'admin') return json({ error: 'Only the family or the office can pay an invoice.' }, 403);
  // Row-level security means this only finds invoices the signed-in parent (or admin) may see.
  const { data: inv, error } = await supabase
    .from('invoices')
    .select(`id, number, status, items, vat_rate, family_id, autopay_status, payments(amount), ${ADJUSTMENTS}`)
    .eq('id', invoiceId)
    .single();
  if (error || !inv) return json({ error: 'Invoice not found' }, 404);
  if (profile.role === 'parent' && inv.family_id !== profile.family_id) return json({ error: 'Invoice not found' }, 404);
  if (inv.status !== 'sent') return json({ error: 'This invoice is not payable' }, 400);

  // Credit notes reduce what is owed and refunds add back to it, so a credited invoice is never overcharged.
  const balance = invoiceBalanceFils(inv.items, inv.vat_rate, inv.payments ?? [], { credits: inv.credit_notes, refunds: inv.refunds });
  if (balance <= 0) return json({ error: 'Nothing left to pay' }, 400);

  const admin = adminClient();
  // 'unknown': Stripe could not be reached mid-charge, so the card may have been charged. Never offer a second payment.
  if (inv.autopay_status === 'processing' || inv.autopay_status === 'unknown') return json({ error: CHARGING }, 409);
  if (inv.autopay_status === 'pending' || inv.autopay_status === 'failed') {
    // Atomic: whichever comes first, this or the autopay run (which claims 'pending' or 'failed' the same way), wins.
    const { data: released } = await admin
      .from('invoices')
      .update({ autopay_status: null, autopay_error: null })
      .eq('id', inv.id)
      .eq('autopay_status', inv.autopay_status)
      .select('id')
      .maybeSingle();
    if (!released) return json({ error: CHARGING }, 409);
  }
  const { data: family, error: famError } = await admin.from('families').select('id, name, parent_name, email').eq('id', inv.family_id).single();
  if (famError || !family) return json({ error: 'Family not found' }, 404);
  const customerId = await ensureCustomer(admin, family);
  const res = await stripe('/checkout/sessions', {
    form: checkoutInvoiceForm({ invoiceId: inv.id, invoiceNumber: inv.number, balanceFils: balance, customerId, familyId: family.id, appUrl: appUrl() }),
  });
  if (!res.ok) return stripeFailure(res);
  return json({ url: res.body.url });
}

async function offerCheckout(req: Request, offerId: string) {
  const supabase = userClient(req);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
  const { data: profile } = await supabase.from('profiles').select('role, family_id').eq('id', auth.user.id).single();
  if (profile?.role !== 'parent' || !profile.family_id) return json({ error: 'Only parents can buy lessons' }, 403);

  // Row-level security only shows parents active offers.
  const { data: offer } = await supabase.from('package_offers').select('id, name, lessons, price, service_id, active').eq('id', offerId).maybeSingle();
  if (!offer || !offer.active) return json({ error: OFFER_GONE }, 404);
  const { data: settings } = await supabase.from('settings').select('vat_rate').eq('id', 1).single();
  const amount = offerChargeFils(offer.price, settings?.vat_rate ?? 0);

  const admin = adminClient();
  const { data: family, error } = await admin.from('families').select('id, name, parent_name, email').eq('id', profile.family_id).single();
  if (error || !family) return json({ error: 'Family not found' }, 404);
  const customerId = await ensureCustomer(admin, family);
  const res = await stripe('/checkout/sessions', {
    form: checkoutOfferForm({ offer, vatRate: settings?.vat_rate ?? 0, amountFils: amount, customerId, familyId: family.id, appUrl: appUrl() }),
  });
  if (!res.ok) return stripeFailure(res);
  return json({ url: res.body.url });
}

// Unexpected errors are thrown to withMonitoring, which logs the detail and answers with a courteous generic message,
// so database or Stripe internals never reach the app.
Deno.serve(withMonitoring('create-checkout', adminClient, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // A View as session (read only) cannot pay for anything.
  const refused = await refuseViewAs(req);
  if (refused) return refused;
  if (!appUrl()) return json({ error: NO_APP_URL }, 500);
  const body = await req.json().catch(() => ({}));
  if (typeof body?.invoiceId === 'string') return await invoiceCheckout(req, body.invoiceId);
  if (typeof body?.offerId === 'string') return await offerCheckout(req, body.offerId);
  return json({ error: 'Choose an invoice or a lesson package to pay for.' }, 400);
}));
