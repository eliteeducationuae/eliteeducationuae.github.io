/**
 * Search helpers shared by the search screen and its tests: accent- and case-insensitive matching, and an index of
 * family contacts so a family can be found by anyone it has added (a PA, the family office, a driver).
 */
import { RELATIONSHIP_LABELS } from './contacts';
import type { FamilyContact } from './types';

/** Lower case without accents, so 'Zoë' is found by 'zoe'. */
export const normSearch = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Whether any of the fields contains the (already normalised) query. */
export const matchesSearch = (q: string, ...fields: (string | undefined)[]) => fields.some((f) => !!f && normSearch(f).includes(q));

export interface ContactSearchEntry {
  familyId: string;
  contact: FamilyContact;
  /** Normalised name, email and telephone, built once. */
  text: string[];
}

/**
 * The family's other contacts, normalised once for searching. The main contact is left out: the family record
 * already carries their name, email and telephone.
 */
export function buildContactIndex(contacts: readonly FamilyContact[]): ContactSearchEntry[] {
  return contacts
    .filter((c) => !c.isPrimary)
    .map((c) => ({ familyId: c.familyId, contact: c, text: [c.name, c.email, c.phone].filter((f): f is string => !!f).map(normSearch) }));
}

/** Family id → the first of its other contacts whose name, email or telephone contains the normalised query. */
export function familiesByContact(index: readonly ContactSearchEntry[], q: string): Map<string, FamilyContact> {
  const out = new Map<string, FamilyContact>();
  if (!q) return out;
  for (const e of index) {
    if (!out.has(e.familyId) && e.text.some((t) => t.includes(q))) out.set(e.familyId, e.contact);
  }
  return out;
}

/** 'via Raj Patel (driver)': why a family turned up in the results. */
export function viaContact(c: FamilyContact): string {
  return `via ${c.name} (${RELATIONSHIP_LABELS[c.relationship].toLowerCase()})`;
}
