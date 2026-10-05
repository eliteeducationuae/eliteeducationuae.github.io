import { CONTACT_ERRORS, emptyContactDraft, draftFromContact } from '@/domain/contacts';
import type { FamilyContactDraft, Profile } from '@/domain/types';

import { allContacts, listFamilyContacts, removeFamilyContact, saveFamilyContact } from '../demo/contacts';
import { cmd, type DemoDB } from '../demo/db';
import { eq } from '../demo/engagement';
import { createSeed } from '../demo/seed';
import { familyContactPayload, toFamilyContact } from '../rpc-mapping';

const profile = (db: DemoDB, id: string): Profile => db.profiles.find((p) => p.id === id)!;
const draft = (patch: Partial<FamilyContactDraft>): FamilyContactDraft => ({ ...emptyContactDraft(), ...patch });

describe('seeded contacts', () => {
  it('gives the Al Mansoori family three contacts with one main contact', () => {
    const db = createSeed();
    const list = listFamilyContacts(db, profile(db, 'u-admin'), 'f-mansoori');
    expect(list.map((c) => c.name)).toEqual(['Fatima Al Mansoori', 'Khalid Al Mansoori', 'Grace Fernandes']);
    expect(list.filter((c) => c.isPrimary).map((c) => c.id)).toEqual(['fc-fatima']);
    expect(list.map((c) => c.hasLogin)).toEqual([true, true, false]);
    expect(list.map((c) => c.profileId)).toEqual(['u-parent', 'u-parent2', undefined]);
    const grace = list[2];
    expect(grace).toMatchObject({ relationship: 'pa', canLogIn: false, receivesInvoices: true, receivesReports: false, receivesLessonNotes: false });
  });

  it('keeps the demo accounts’ order and adds Khalid’s voice to the conversation', () => {
    const db = createSeed();
    expect(db.profiles.slice(0, 4).map((p) => p.id)).toEqual(['u-admin', 'u-tutor', 'u-parent', 'u-student']);
    expect(db.profiles.find((p) => p.role === 'parent')?.id).toBe('u-parent');
    expect(db.messages.some((m) => m.familyId === 'f-mansoori' && m.senderId === 'u-parent2' && m.senderName === 'Khalid Al Mansoori')).toBe(true);
  });

  it('gives every other family its main contact', () => {
    const db = createSeed();
    for (const f of db.families) {
      const primary = listFamilyContacts(db, profile(db, 'u-admin'), f.id).filter((c) => c.isPrimary);
      expect(primary).toHaveLength(1);
      expect(primary[0]).toMatchObject({ name: f.parentName, email: f.email });
    }
  });
});

describe('parents', () => {
  it('Khalid can list his family’s contacts and add one', () => {
    const db = createSeed();
    const khalid = profile(db, 'u-parent2');
    expect(listFamilyContacts(db, khalid, 'f-mansoori')).toHaveLength(3);
    const saved = saveFamilyContact(db, khalid, 'f-mansoori', draft({ name: ' Ahmed ', relationship: 'driver', phone: '050 123 4567', receivesReports: false, receivesLessonNotes: false }));
    expect(saved).toMatchObject({ name: 'Ahmed', phone: '+971501234567', hasLogin: false, familyId: 'f-mansoori' });
    expect(listFamilyContacts(db, khalid, 'f-mansoori')).toHaveLength(4);
    expect(db.outbox.at(-1)?.subject).toBe('Family contacts updated: Al Mansoori family');
  });

  it('cannot remove the main contact or the last contact who signs in', () => {
    const db = createSeed();
    const khalid = profile(db, 'u-parent2');
    expect(() => removeFamilyContact(db, khalid, 'fc-fatima')).toThrow(CONTACT_ERRORS.removePrimary);
    // Fatima stops signing in, so Khalid is the last login.
    saveFamilyContact(db, khalid, 'f-mansoori', { ...draftFromContact(db.familyContacts!.find((c) => c.id === 'fc-fatima')!), canLogIn: false });
    expect(() => removeFamilyContact(db, khalid, 'fc-khalid')).toThrow(CONTACT_ERRORS.lastLogin);
    expect(() =>
      saveFamilyContact(db, khalid, 'f-mansoori', { ...draftFromContact(db.familyContacts!.find((c) => c.id === 'fc-khalid')!), canLogIn: false }),
    ).toThrow(CONTACT_ERRORS.lastLogin);
    removeFamilyContact(db, khalid, 'fc-grace');
    expect(listFamilyContacts(db, khalid, 'f-mansoori').map((c) => c.id)).toEqual(['fc-fatima', 'fc-khalid']);
  });

  it('removing a contact who signs in ends their access', () => {
    const db = createSeed();
    removeFamilyContact(db, profile(db, 'u-parent'), 'fc-khalid');
    expect(profile(db, 'u-parent2').familyId).toBeUndefined();
  });

  it('cannot see or change another family’s contacts', () => {
    const db = createSeed();
    const khalid = profile(db, 'u-parent2');
    expect(listFamilyContacts(db, khalid, 'f-sharma')).toEqual([]);
    expect(() => saveFamilyContact(db, khalid, 'f-sharma', draft({ name: 'Someone' }))).toThrow('Family not found');
    const sharmaPrimary = listFamilyContacts(db, profile(db, 'u-admin'), 'f-sharma')[0];
    expect(() => removeFamilyContact(db, khalid, sharmaPrimary.id)).toThrow('Contact not found');
    expect(listFamilyContacts(db, profile(db, 'u-student'), 'f-mansoori')).toEqual([]);
  });

  it('rejects duplicate emails and emails that sign in to another family', () => {
    const db = createSeed();
    const fatima = profile(db, 'u-parent');
    expect(() => saveFamilyContact(db, fatima, 'f-mansoori', draft({ name: 'Grace again', email: 'GRACE@example.com' }))).toThrow(CONTACT_ERRORS.duplicateEmail);
    // A parent is never told that an address belongs to another client or an account: one neutral message, and the
    // office is told so it can follow up.
    const before = db.familyContacts!.length;
    expect(() => saveFamilyContact(db, fatima, 'f-mansoori', draft({ name: 'Priya', email: 'priya@example.com', canLogIn: true }))).toThrow(CONTACT_ERRORS.loginReferred);
    expect(db.outbox.at(-1)?.subject).toBe('Contact sign-in to review: Al Mansoori family');
    expect(db.outbox.at(-1)?.body).toContain('Fatima Al Mansoori asked to give Priya (priya@example.com) sign-in access');
    // Asking again for the same address the same day gives the same reply but does not tell the office twice.
    const told = db.outbox.length;
    expect(() => saveFamilyContact(db, fatima, 'f-mansoori', draft({ name: 'Priya', email: 'priya@example.com', canLogIn: true }))).toThrow(CONTACT_ERRORS.loginReferred);
    expect(db.outbox.length).toBe(told);
    expect(() => saveFamilyContact(db, fatima, 'f-mansoori', draft({ name: 'Sarah', email: 'sarah@eliteeducation.me', canLogIn: true }))).toThrow(CONTACT_ERRORS.loginReferred);
    expect(db.familyContacts!.length).toBe(before);
    // The office is told the reason.
    const admin = profile(db, 'u-admin');
    expect(() => saveFamilyContact(db, admin, 'f-mansoori', draft({ name: 'Priya', email: 'priya@example.com', canLogIn: true }))).toThrow(CONTACT_ERRORS.emailElsewhere);
    // A contact who does not sign in may share an address with another family (a family office, say).
    expect(saveFamilyContact(db, fatima, 'f-mansoori', draft({ name: 'Office', relationship: 'family_office', email: 'priya@example.com' })).email).toBe('priya@example.com');
  });

  it('never changes the address a login signs in with', () => {
    const db = createSeed();
    const khalidContact = db.familyContacts!.find((c) => c.id === 'fc-khalid')!;
    for (const who of ['u-parent', 'u-admin']) {
      expect(() =>
        saveFamilyContact(db, profile(db, who), 'f-mansoori', { ...draftFromContact(khalidContact), email: 'khalid.new@example.com' }),
      ).toThrow(CONTACT_ERRORS.emailLocked);
    }
    // Saving with the same address, in any case, is fine.
    expect(saveFamilyContact(db, profile(db, 'u-parent'), 'f-mansoori', { ...draftFromContact(khalidContact), email: khalidContact.email!.toUpperCase() }).hasLogin).toBe(true);
  });

  it('renaming a linked contact renames their login', () => {
    const db = createSeed();
    const khalidContact = db.familyContacts!.find((c) => c.id === 'fc-khalid')!;
    saveFamilyContact(db, profile(db, 'u-parent'), 'f-mansoori', { ...draftFromContact(khalidContact), name: 'Khalid bin Saeed Al Mansoori' });
    expect(profile(db, 'u-parent2').fullName).toBe('Khalid bin Saeed Al Mansoori');
  });
});

describe('tutors', () => {
  it('Sarah, who teaches Layla, sees names and relationships only', () => {
    const db = createSeed();
    const sarah = profile(db, 'u-tutor');
    const list = listFamilyContacts(db, sarah, 'f-mansoori');
    expect(list.map((c) => [c.name, c.relationship, c.isPrimary])).toEqual([
      ['Fatima Al Mansoori', 'mother', true],
      ['Khalid Al Mansoori', 'father', false],
      ['Grace Fernandes', 'pa', false],
    ]);
    for (const c of list) {
      expect(c.email).toBeUndefined();
      expect(c.phone).toBeUndefined();
      expect(c.profileId).toBeUndefined();
      expect([c.canLogIn, c.receivesInvoices, c.receivesReports, c.receivesLessonNotes, c.receivesWhatsApp, c.emergencyContact, c.hasLogin]).toEqual(Array(7).fill(false));
    }
    expect(() => saveFamilyContact(db, sarah, 'f-mansoori', draft({ name: 'X' }))).toThrow('Family not found');
  });

  it('see nothing for a family they do not teach', () => {
    const db = createSeed();
    expect(listFamilyContacts(db, profile(db, 'u-tutor'), 'f-sharma')).toEqual([]);
  });
});

describe('admins', () => {
  it('add a personal assistant who receives invoices only', () => {
    const db = createSeed();
    const admin = profile(db, 'u-admin');
    const saved = saveFamilyContact(
      db,
      admin,
      'f-sharma',
      draft({ name: 'Maria Lopez', relationship: 'pa', email: 'Maria@Example.com', receivesInvoices: true, receivesReports: false, receivesLessonNotes: false }),
    );
    expect(saved).toMatchObject({ email: 'maria@example.com', receivesInvoices: true, receivesReports: false, receivesLessonNotes: false, canLogIn: false, isPrimary: false });
    expect(listFamilyContacts(db, admin, 'f-sharma').map((c) => c.name)).toEqual(['Priya Sharma', 'Maria Lopez']);
    // The office is not told about its own changes.
    expect(db.outbox.some((m) => m.subject.startsWith('Family contacts updated'))).toBe(false);
  });

  it('switching the main contact updates the family record', () => {
    const db = createSeed();
    const admin = profile(db, 'u-admin');
    const khalid = db.familyContacts!.find((c) => c.id === 'fc-khalid')!;
    saveFamilyContact(db, admin, 'f-mansoori', { ...draftFromContact(khalid), isPrimary: true });
    const list = listFamilyContacts(db, admin, 'f-mansoori');
    expect(list.filter((c) => c.isPrimary).map((c) => c.id)).toEqual(['fc-khalid']);
    expect(list[0].id).toBe('fc-khalid');
    expect(db.families.find((f) => f.id === 'f-mansoori')).toMatchObject({ parentName: 'Khalid Al Mansoori', email: 'khalid@example.com', phone: '+971500000011' });
    // Fatima can now be removed; un-marking Khalid without another main contact cannot happen.
    expect(() => saveFamilyContact(db, admin, 'f-mansoori', { ...draftFromContact(list[0]), isPrimary: false })).toThrow(CONTACT_ERRORS.primaryRequired);
    removeFamilyContact(db, admin, 'fc-fatima');
    expect(listFamilyContacts(db, admin, 'f-mansoori')).toHaveLength(2);
  });

  it('editing the family keeps the main contact in step', () => {
    const db = createSeed();
    const admin = profile(db, 'u-admin');
    const family = db.families.find((f) => f.id === 'f-mansoori')!;
    cmd.saveFamily(db, admin, { ...family, parentName: 'Fatima Saeed Al Mansoori', phone: '+971 50 999 0001' });
    const primary = listFamilyContacts(db, admin, 'f-mansoori')[0];
    expect(primary).toMatchObject({ id: 'fc-fatima', name: 'Fatima Saeed Al Mansoori', phone: '+971 50 999 0001' });
    // A new family gets a main contact straight away.
    const created = cmd.saveFamily(db, admin, { name: 'Khan', parentName: 'Aisha Khan', email: 'aisha@example.com' });
    expect(listFamilyContacts(db, admin, created.id)).toMatchObject([{ name: 'Aisha Khan', email: 'aisha@example.com', isPrimary: true }]);
  });

  it('a prospect renaming themselves renames their contact entry', () => {
    const db = createSeed();
    const fatima = profile(db, 'u-parent');
    db.families.find((f) => f.id === 'f-mansoori')!.status = 'prospect';
    eq.setMyName(db, fatima, 'Fatima Al-Mansoori');
    expect(listFamilyContacts(db, fatima, 'f-mansoori')[0].name).toBe('Fatima Al-Mansoori');
  });
});

describe('older demo databases', () => {
  it('are backfilled with each family’s main contact', () => {
    const db = createSeed();
    delete db.familyContacts;
    const list = listFamilyContacts(db, profile(db, 'u-parent'), 'f-mansoori');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'f-mansoori-primary', name: 'Fatima Al Mansoori', isPrimary: true, hasLogin: true, profileId: 'u-parent' });
    expect(allContacts(db)).toHaveLength(db.families.length);
    expect(db.familyContacts).toHaveLength(db.families.length);
  });
});

describe('Supabase row mapping', () => {
  it('maps list_family_contacts rows, turning nulls into undefined', () => {
    expect(
      toFamilyContact({
        id: 'c1',
        family_id: 'f1',
        name: 'Grace Fernandes',
        relationship: 'pa',
        email: null,
        phone: '+971500000012',
        preferred_channel: 'whatsapp',
        can_log_in: false,
        receives_invoices: true,
        receives_reports: false,
        receives_lesson_notes: false,
        receives_whatsapp: true,
        emergency_contact: false,
        is_primary: false,
        has_login: false,
        profile_id: null,
        created_at: '2026-10-01T00:00:00Z',
      }),
    ).toEqual({
      id: 'c1',
      familyId: 'f1',
      name: 'Grace Fernandes',
      relationship: 'pa',
      email: undefined,
      phone: '+971500000012',
      preferredChannel: 'whatsapp',
      canLogIn: false,
      receivesInvoices: true,
      receivesReports: false,
      receivesLessonNotes: false,
      receivesWhatsApp: true,
      emergencyContact: false,
      isPrimary: false,
      hasLogin: false,
      profileId: undefined,
      createdAt: '2026-10-01T00:00:00Z',
    });
  });

  it('maps a tutor’s row, which has no contact details', () => {
    const c = toFamilyContact({ id: 'c1', family_id: 'f1', name: 'Fatima', relationship: 'mother', is_primary: true });
    expect(c).toMatchObject({ email: undefined, phone: undefined, preferredChannel: 'email', canLogIn: false, isPrimary: true, hasLogin: false });
  });

  it('builds save_family_contact’s p_contact', () => {
    expect(familyContactPayload(draft({ name: 'Ahmed', relationship: 'driver', phone: '+971501234567' }))).toEqual({
      id: null,
      name: 'Ahmed',
      relationship: 'driver',
      email: null,
      phone: '+971501234567',
      preferred_channel: 'email',
      can_log_in: false,
      receives_invoices: false,
      receives_reports: true,
      receives_lesson_notes: true,
      receives_whatsapp: false,
      emergency_contact: false,
      is_primary: false,
    });
    expect(familyContactPayload(draft({ id: 'c1', name: 'A' })).id).toBe('c1');
  });
});
