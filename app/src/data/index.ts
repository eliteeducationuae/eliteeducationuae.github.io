import { createDemoSource } from './demo';
import type { DataSource } from './source';
import { createSupabaseSource } from './supabase';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The app talks to Supabase when it is configured (see .env.example), otherwise it runs
 * on the built-in demo data so it can be tried straight away.
 */
export const source: DataSource = url && anonKey ? createSupabaseSource(url, anonKey) : createDemoSource();
