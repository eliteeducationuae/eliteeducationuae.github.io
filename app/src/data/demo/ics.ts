import type { Profile } from '@/domain/types';

import { AccessError, type DemoDB } from './db';

/** A random version 4 UUID, the shape production's gen_random_uuid() gives a calendar token. */
function randomToken(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Mirrors public.reset_ics_token: gives the caller (or, for an admin, anyone) a new secret calendar feed token, so
 * the old feed link stops working. Returns the new token.
 */
export function resetIcsToken(db: DemoDB, viewer: Profile, profileId?: string): string {
  const targetId = profileId ?? viewer.id;
  if (targetId !== viewer.id && viewer.role !== 'admin') {
    throw new AccessError("Only an administrator can reset someone else's calendar link.");
  }
  const target = db.profiles.find((p) => p.id === targetId);
  if (!target) throw new Error('This person was not found.');
  let fresh = randomToken();
  while (fresh === target.icsToken) fresh = randomToken();
  target.icsToken = fresh;
  return fresh;
}
