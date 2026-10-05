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

// Launch readiness
/**
 * Optional Sentry project for crash reports, alongside the app's own error log (System health in the admin app).
 * Adding @sentry/react-native, initialising it with this DSN and calling registerErrorSink (src/lib/error-reporting.ts)
 * once in the root layout is all that is needed; every error the app reports then reaches Sentry too.
 */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
export const PRIVACY_URL = 'https://eliteeducation.me/privacy/';
export const TERMS_URL = 'https://eliteeducation.me/terms/';
export const SUPPORT_EMAIL = 'hello@eliteeducation.me';
