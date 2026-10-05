// Opens the Stripe customer portal so a family can add, replace or remove saved cards ("Manage cards").
//   {}            a parent, for their own family
//   { familyId }  an admin, for any family
// Returns { url }. Set up the portal once in Stripe: Settings → Billing → Customer portal.
// Secrets: STRIPE_SECRET_KEY, APP_URL.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { withMonitoring } from '../_shared/monitoring.ts';
import { portalForm } from '../_shared/stripe.ts';
import { stripe } from '../_shared/stripe-api.ts';

Deno.serve(withMonitoring('billing-portal', adminClient, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = userClient(req);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: profile } = await supabase.from('profiles').select('role, family_id').eq('id', auth.user.id).single();

    let familyId: string | null = null;
    if (profile?.role === 'admin' && typeof body?.familyId === 'string') familyId = body.familyId;
    else if (profile?.role === 'parent') familyId = profile.family_id;
    if (!familyId) return json({ error: 'Only the family or an admin can manage saved cards.' }, 403);

    const { data: billing, error } = await adminClient().from('family_billing').select('stripe_customer_id').eq('family_id', familyId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!billing?.stripe_customer_id) {
      return json({ error: 'No saved card yet. Your card is saved securely the next time you pay by card.' }, 400);
    }

    const appUrl = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/+$/, '');
    if (!appUrl) return json({ error: 'Managing cards is not set up yet (APP_URL is missing).' }, 500);
    // Families come back to Billing; an admin comes back to the family they were looking after.
    const returnUrl = profile?.role === 'admin' ? `${appUrl}/manage/family-edit?id=${encodeURIComponent(familyId)}` : `${appUrl}/parent/billing`;
    const res = await stripe('/billing_portal/sessions', { form: portalForm(billing.stripe_customer_id, returnUrl) });
    if (!res.ok) return json({ error: res.body?.error?.message ?? 'Stripe error' }, 502);
    return json({ url: res.body.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}));
