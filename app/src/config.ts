/**
 * Public connection settings for the live Supabase project.
 * Both values are designed to be shipped inside the app: what anyone can do with them is limited by
 * row-level security. NEVER put the service_role / secret key or Stripe keys here.
 *
 * Override with EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, or set
 * EXPO_PUBLIC_DEMO=1 to run on built-in demo data instead.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://tzahajbulieoalzuzclv.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_GGcYrMILBwC_39aVhEiQ4w_uuQ06_Q6';
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === '1';
