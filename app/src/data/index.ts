import { DEMO_MODE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/config';

import { createDemoSource } from './demo';
import type { DataSource } from './source';
import { createSupabaseSource } from './supabase';

/** The live Supabase project, or the built-in demo data when EXPO_PUBLIC_DEMO=1. */
export const baseSource: DataSource = DEMO_MODE ? createDemoSource() : createSupabaseSource(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/** The source in use: the base source, or a read-only view while an admin is viewing as someone else. */
let active: DataSource = baseSource;
/** Functions bound to `active`, so repeated reads of e.g. source.listLessons give the same function. */
let bound = new Map<PropertyKey, unknown>();

/** Send every `source` call to another source (admin "View as"); null returns to the base source. */
export function setActiveSource(s: DataSource | null): void {
  const next = s ?? baseSource;
  if (next === active) return;
  active = next;
  bound = new Map();
}

/** What the app reads and writes through. Delegates to the active source. */
export const source: DataSource = new Proxy({} as DataSource, {
  get(_target, key) {
    const value: unknown = Reflect.get(active, key);
    if (typeof value !== 'function') return value;
    let fn = bound.get(key);
    if (!fn) {
      fn = (value as (...args: unknown[]) => unknown).bind(active);
      bound.set(key, fn);
    }
    return fn;
  },
  has(_target, key) {
    return Reflect.has(active, key);
  },
  set() {
    return false;
  },
});
