import {
  canRemoveContact,
  CONTACT_ERRORS,
  contactsFromFamily,
  normaliseContactDraft,
  RELATIONSHIP_LABELS,
  validateContactDraft,
} from '@/domain/contacts';
import type { Family, FamilyContact, FamilyContactDraft, Profile } from '@/domain/types';

import { AccessError, newId, notifyAdmins, visibleStudentIds, type DemoDB } from './db';

/**
 * Demo family contacts. Mirrors list_family_contacts, save_family_contact and remove_family_contact.
 * Contacts are stored on `db.familyContacts`; databases saved before the feature are backfilled with
 * each family's main contact, built from the family record.
 */

const sameEmail = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every stored contact, backfilling a main contact for any family without one. */
export function allContacts(db: DemoDB): FamilyContact[] {
  const list = (db.familyContacts ??= []);
  const withContacts = new Set(list.map((c) => c.familyId));
  for (const f of db.families) if (!withContacts.has(f.id)) list.push(...contactsFromFamily(f));
  return list;
}

/** The parent login linked to a contact: the one stored on it, or a login of the family with the same email. */
function linkedProfile(db: DemoDB, c: FamilyContact): Profile | undefined {
  const inFamily = (p: Profile) => p.role === 'parent' && p.familyId === c.familyId;
  if (c.profileId) {
    const p = db.profiles.find((x) => x.id === c.profileId);
    if (p && inFamily(p)) return p;
  }
  return db.profiles.find((p) => inFamily(p) && sameEmail(p.email, c.email));
}

/** Store the current login link on each contact of the family. */
function refreshLinks(db: DemoDB, familyId: string): FamilyContact[] {
  const list = allContacts(db).filter((c) => c.familyId === familyId);
  for (const c of list) {
    const p = linkedProfile(db, c);
    c.profileId = p?.id;
    c.hasLogin = !!p;
  }
  return list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

function teachesFamily(db: DemoDB, viewer: Profile, familyId: string): boolean {
  const visible = visibleStudentIds(db, viewer);
  return db.students.some((s) => s.familyId === familyId && visible.has(s.id));
}

function canManage(viewer: Profile, familyId: string): boolean {
  return viewer.role === 'admin' || (viewer.role === 'parent' && viewer.familyId === familyId);
}

/** Names and relationships only, for a tutor who teaches the family. */
function forTutor(c: FamilyContact): FamilyContact {
  return {
    id: c.id,
    familyId: c.familyId,
    name: c.name,
    relationship: c.relationship,
    preferredChannel: 'email',
    canLogIn: false,
    receivesInvoices: false,
    receivesReports: false,
    receivesLessonNotes: false,
    receivesWhatsApp: false,
    emergencyContact: false,
    isPrimary: c.isPrimary,
    hasLogin: false,
  };
}

export function listFamilyContacts(db: DemoDB, viewer: Profile, familyId: string): FamilyContact[] {
  if (canManage(viewer, familyId)) return refreshLinks(db, familyId);
  if (viewer.role === 'tutor' && teachesFamily(db, viewer, familyId)) return refreshLinks(db, familyId).map(forTutor);
  return [];
}

/** Copy the main contact's name, email and telephone onto the family record. */
function copyPrimaryToFamily(family: Family, c: FamilyContact) {
  family.parentName = c.name;
  if (c.email) family.email = c.email;
  family.phone = c.phone;
}

function familyLabel(family: Family) {
  return family.name.endsWith('family') ? family.name : `${family.name} family`;
}

export function saveFamilyContact(db: DemoDB, viewer: Profile, familyId: string, draft: FamilyContactDraft, now = new Date()): FamilyContact {
  const family = db.families.find((f) => f.id === familyId);
  if (!family || !canManage(viewer, familyId)) throw new AccessError('Family not found');
  const contacts = refreshLinks(db, familyId);
  const d = normaliseContactDraft(draft);
  const existing = d.id ? contacts.find((c) => c.id === d.id) : undefined;
  if (d.id && !existing) throw new AccessError('Contact not found');
  const others = contacts.filter((c) => c.id !== existing?.id);

  const problem = validateContactDraft({ ...d, hasLogin: existing?.hasLogin }, others, viewer.role);
  if (problem) throw new Error(problem);
  // A login email may belong to one family only (and never to a tutor or the office).
  if (d.canLogIn && d.email) {
    const elsewhere =
      db.profiles.some((p) => sameEmail(p.email, d.email) && !(p.role === 'parent' && p.familyId === familyId)) ||
      allContacts(db).some((c) => c.familyId !== familyId && c.canLogIn && sameEmail(c.email, d.email));
    if (elsewhere) throw new Error(CONTACT_ERRORS.emailElsewhere);
  }

  if (d.isPrimary) for (const o of others) o.isPrimary = false;
  const saved: FamilyContact = {
    id: existing?.id ?? newId('fc'),
    familyId,
    name: d.name,
    relationship: d.relationship,
    email: d.email,
    phone: d.phone,
    preferredChannel: d.preferredChannel,
    canLogIn: d.canLogIn,
    receivesInvoices: d.receivesInvoices,
    receivesReports: d.receivesReports,
    receivesLessonNotes: d.receivesLessonNotes,
    receivesWhatsApp: d.receivesWhatsApp,
    emergencyContact: d.emergencyContact,
    isPrimary: d.isPrimary,
    hasLogin: false,
    profileId: existing?.profileId,
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  const list = allContacts(db);
  if (existing) list[list.indexOf(existing)] = saved;
  else list.push(saved);

  const profile = linkedProfile(db, saved);
  saved.profileId = profile?.id;
  saved.hasLogin = !!profile;
  if (profile) profile.fullName = saved.name;
  if (saved.isPrimary) copyPrimaryToFamily(family, saved);

  if (viewer.role === 'parent') {
    notifyAdmins(
      db,
      `Family contacts updated: ${familyLabel(family)}`,
      `${viewer.fullName} ${existing ? 'updated' : 'added'} ${saved.name} (${RELATIONSHIP_LABELS[saved.relationship]})${saved.isPrimary ? ' as the main contact' : ''}.`,
      `/manage/family-edit?id=${familyId}`,
      now,
    );
  }
  return saved;
}

export function removeFamilyContact(db: DemoDB, viewer: Profile, contactId: string, now = new Date()) {
  const contact = allContacts(db).find((c) => c.id === contactId);
  if (!contact || !canManage(viewer, contact.familyId)) throw new AccessError('Contact not found');
  const contacts = refreshLinks(db, contact.familyId);
  const check = canRemoveContact(contact, contacts, viewer.role);
  if (!check.ok) throw new Error(check.reason);
  // Removing a contact who signs in ends their access to the family.
  const profile = linkedProfile(db, contact);
  if (profile) profile.familyId = undefined;
  db.familyContacts = allContacts(db).filter((c) => c.id !== contactId);

  const family = db.families.find((f) => f.id === contact.familyId);
  if (viewer.role === 'parent' && family) {
    notifyAdmins(db, `Family contacts updated: ${familyLabel(family)}`, `${viewer.fullName} removed ${contact.name} (${RELATIONSHIP_LABELS[contact.relationship]}).`, `/manage/family-edit?id=${family.id}`, now);
  }
}

/** Keep the main contact in step with the family record after the family itself is edited or created. */
export function syncPrimaryFromFamily(db: DemoDB, family: Family) {
  const list = (db.familyContacts ??= []);
  const mine = list.filter((c) => c.familyId === family.id);
  const primary = mine.find((c) => c.isPrimary);
  if (!mine.length || !primary) {
    // allContacts backfills a family with no contacts; a family whose contacts lost their main one gets it back.
    if (mine.length) list.push(...contactsFromFamily(family).map((c) => ({ ...c, id: newId('fc') })));
    else allContacts(db);
    return;
  }
  primary.name = family.parentName;
  primary.email = family.email || primary.email;
  primary.phone = family.phone;
  const profile = linkedProfile(db, primary);
  if (profile) profile.fullName = family.parentName;
}
