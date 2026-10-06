// Opens the Stripe customer portal so a family can add, replace or remove saved cards ("Manage cards").
//   {}            a parent, for their own family
//   { familyId }  an admin, for any family
// Returns { url }. Set up the portal once in Stripe: Settings → Billing → Customer portal.
// Secrets: STRIPE_SECRET_KEY, APP_URL.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';
import { refuseViewAs } from '../_shared/view-as.ts';
import { portalForm } from '../_shared/stripe.ts';
import { stripe } from '../_shared/stripe-api.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Unexpected errors are thrown to withMonitoring, which logs them and answers with a courteous generic message.
Deno.serve(withMonitoring('billing-portal', adminClient, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const supabase = userClient(req);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
  const refused = await refuseViewAs(req);
  if (refused) return refused;
  const { data: profile } = await supabase.from('profiles').select('role, family_id').eq('id', auth.user.id).single();

  let familyId: string | null = null;
  if (profile?.role === 'admin' && typeof body?.familyId === 'string' && UUID.test(body.familyId)) familyId = body.familyId;
  else if (profile?.role === 'parent') familyId = profile.family_id;
  if (!familyId) return json({ error: 'Only the family or an admin can manage saved cards.' }, 403);

  const { data: billing, error } = await adminClient().from('family_billing').select('stripe_customer_id').eq('family_id', familyId).maybeSingle();
  if (error) throw new Error(`family_billing: ${error.message}`);
  if (!billing?.stripe_customer_id) {
    return json({ error: 'No saved card yet. Your card is saved securely the next time you pay by card.' }, 400);
  }

  const appUrl = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/+$/, '');
  if (!appUrl) return json({ error: 'Managing cards is not set up yet (APP_URL is missing).' }, 500);
  // Families come back to Billing; an admin comes back to the family they were looking after.
  const returnUrl = profile?.role === 'admin' ? `${appUrl}/manage/family-edit?id=${encodeURIComponent(familyId)}` : `${appUrl}/parent/billing`;
  const res = await stripe('/billing_portal/sessions', { form: portalForm(billing.stripe_customer_id, returnUrl) });
  if (!res.ok) {
    // Stripe's text can name Stripe ids, so it stays in the logs. The usual cause is the portal not being set up yet.
    console.error('billing-portal: Stripe refused the session', res.status, res.body?.error?.message ?? '');
    return json({ error: 'Managing cards is not available just now. Please try again later, or contact the office.' }, 502);
  }
  return json({ url: res.body.url });
}));
