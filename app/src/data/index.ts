import { DEMO_MODE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/config';

import { createDemoSource } from './demo';
import type { DataSource } from './source';
import { createSupabaseSource } from './supabase';

/** The live Supabase project, or the built-in demo data when EXPO_PUBLIC_DEMO=1. */
export const source: DataSource = DEMO_MODE ? createDemoSource() : createSupabaseSource(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
