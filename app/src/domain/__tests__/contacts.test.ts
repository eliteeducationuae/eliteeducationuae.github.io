import {
  canRemoveContact,
  CHANNEL_LABELS,
  CONTACT_ERRORS,
  contactFlagsSummary,
  contactReceives,
  contactsFromFamily,
  describeRecipients,
  describeWhatsAppRecipients,
  draftFromContact,
  emailLockHint,
  emptyContactDraft,
  formatPhoneForDisplay,
  normaliseContactDraft,
  NOTICE_KIND_LABELS,
  noticeDefaultsFor,
  noticeKindForUrl,
  primaryContact,
  recipientsFor,
  RELATIONSHIP_LABELS,
  RELATIONSHIP_ORDER,
  validateContactDraft,
} from '../contacts';
import type { FamilyContact, FamilyContactDraft } from '../types';

const base: FamilyContact = {
  id: 'c1',
  familyId: 'f1',
  name: 'Fatima Al Mansoori',
  relationship: 'mother',
  email: 'fatima@example.com',
  phone: '+971500000001',
  preferredChannel: 'email',
  canLogIn: true,
  receivesInvoices: true,
  receivesReports: true,
  receivesLessonNotes: true,
  receivesWhatsApp: false,
  emergencyContact: false,
  isPrimary: true,
  hasLogin: true,
  profileId: 'u1',
  createdAt: '2026-01-01T00:00:00Z',
};
const contact = (patch: Partial<FamilyContact>): FamilyContact => ({ ...base, ...patch });

const fatima = base;
const khalid = contact({ id: 'c2', name: 'Khalid Al Mansoori', relationship: 'father', email: 'khalid@example.com', isPrimary: false, receivesInvoices: false, emergencyContact: true, profileId: 'u2', createdAt: '2026-01-02T00:00:00Z' });
const grace = contact({ id: 'c3', name: 'Grace Fernandes', relationship: 'pa', email: 'grace@example.com', isPrimary: false, canLogIn: false, hasLogin: false, profileId: undefined, receivesReports: false, receivesLessonNotes: false, createdAt: '2026-01-03T00:00:00Z' });
const driver = contact({ id: 'c4', name: 'Ali', relationship: 'driver', email: undefined, isPrimary: false, canLogIn: false, hasLogin: false, receivesInvoices: true, createdAt: '2026-01-04T00:00:00Z' });

const draft = (patch: Partial<FamilyContactDraft> = {}): FamilyContactDraft => ({ ...emptyContactDraft(), name: 'Grace Fernandes', email: 'grace@example.com', ...patch });

describe('labels', () => {
  it('labels every relationship and channel in order', () => {
    expect(RELATIONSHIP_ORDER).toHaveLength(Object.keys(RELATIONSHIP_LABELS).length);
    expect(RELATIONSHIP_ORDER.map((r) => RELATIONSHIP_LABELS[r])).toEqual(['Mother', 'Father', 'Parent', 'Guardian', 'Personal assistant', 'Family office', 'Driver', 'Other']);
    expect(CHANNEL_LABELS).toEqual({ email: 'Email', phone: 'Telephone', whatsapp: 'WhatsApp' });
    expect(NOTICE_KIND_LABELS.lesson_notes).toBe('Lesson notes and homework');
    expect(NOTICE_KIND_LABELS.invoices).toBe('Invoices and payments');
  });
});

describe('noticeKindForUrl (mirrors public.family_notice_kind)', () => {
  it.each([
    ['/invoice/abc', 'invoices'],
    ['/parent/billing', 'invoices'],
    ['/parent/billing?tab=cards', 'invoices'],
    ['/parent/progress', 'reports'],
    ['/reports/r1', 'reports'],
    ['/lesson/l1', 'lesson_notes'],
    ['/homework/h1', 'lesson_notes'],
    ['/homework', 'lesson_notes'],
    ['/parent/progress?tab=homework', 'lesson_notes'],
    ['/parent/progress?tab=topics', 'general'],
    ['/messages/f1', 'general'],
    ['', 'general'],
    [undefined, 'general'],
  ])('%s is %s', (url, kind) => {
    expect(noticeKindForUrl(url)).toBe(kind);
  });
});

describe('who receives what', () => {
  it('follows each contact’s choices, and general updates go to logins and the main contact', () => {
    expect(contactReceives(khalid, 'invoices')).toBe(false);
    expect(contactReceives(grace, 'invoices')).toBe(true);
    expect(contactReceives(grace, 'reports')).toBe(false);
    expect(contactReceives(khalid, 'lesson_notes')).toBe(true);
    expect(contactReceives(grace, 'general')).toBe(false);
    expect(contactReceives(khalid, 'general')).toBe(true);
    expect(contactReceives(contact({ canLogIn: false, isPrimary: true }), 'general')).toBe(true);
  });

  it('lists reachable recipients, main contact first then oldest', () => {
    const all = [driver, grace, khalid, fatima];
    expect(recipientsFor(all, 'invoices').map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(recipientsFor(all, 'reports').map((c) => c.id)).toEqual(['c1', 'c2']);
    // A contact with no email but a login is still reachable in the app.
    const linkedNoEmail = contact({ id: 'c5', email: undefined, isPrimary: false, hasLogin: true, createdAt: '2026-01-05T00:00:00Z' });
    expect(recipientsFor([linkedNoEmail], 'reports').map((c) => c.id)).toEqual(['c5']);
    expect(recipientsFor([contact({ createdAt: undefined, isPrimary: false, id: 'x' }), contact({ isPrimary: false, id: 'y' })], 'reports').map((c) => c.id)).toEqual(['x', 'y']);
  });

  it('describes recipients the British way', () => {
    expect(describeRecipients([fatima, grace], 'invoices')).toBe('Fatima Al Mansoori and Grace Fernandes (email only)');
    expect(describeRecipients([fatima, khalid, grace], 'general')).toBe('Fatima Al Mansoori and Khalid Al Mansoori');
    expect(describeRecipients([fatima, khalid, contact({ id: 'c6', name: 'Noor', isPrimary: false, createdAt: '2026-01-09T00:00:00Z' })], 'reports')).toBe('Fatima Al Mansoori, Khalid Al Mansoori and Noor');
    expect(describeRecipients([fatima], 'reports')).toBe('Fatima Al Mansoori');
    expect(describeRecipients([grace], 'reports')).toBe('Nobody');
    expect(describeRecipients([], 'invoices')).toBe('Nobody');
  });

  it('lists who receives WhatsApp, marking those who choose for themselves', () => {
    const driver = contact({ id: 'c7', name: 'Ahmed', relationship: 'driver', email: undefined, canLogIn: false, hasLogin: false, profileId: undefined, isPrimary: false, receivesWhatsApp: true, createdAt: '2026-01-10T00:00:00Z' });
    const fatimaWa = { ...fatima, receivesWhatsApp: true, hasLogin: true };
    expect(describeWhatsAppRecipients([driver, fatimaWa, grace])).toBe('Fatima Al Mansoori (own settings) and Ahmed');
    expect(describeWhatsAppRecipients([grace])).toBe('Nobody');
  });
});

describe('contactFlagsSummary', () => {
  it('lists the short labels in a fixed order', () => {
    expect(contactFlagsSummary(fatima)).toEqual(['Main contact', 'Signs in', 'Invoices', 'Reports', 'Lesson notes']);
    expect(contactFlagsSummary(contact({ isPrimary: false, receivesWhatsApp: true, emergencyContact: true }))).toEqual([
      'Signs in',
      'Invoices',
      'Reports',
      'Lesson notes',
      'WhatsApp',
      'Emergency contact',
    ]);
    expect(contactFlagsSummary(contact({ isPrimary: false, canLogIn: false, receivesInvoices: false, receivesReports: false, receivesLessonNotes: false }))).toEqual([]);
  });
});

describe('drafts', () => {
  it('starts blank with sensible defaults', () => {
    expect(emptyContactDraft()).toEqual({
      name: '',
      relationship: 'parent',
      email: undefined,
      phone: undefined,
      preferredChannel: 'email',
      canLogIn: false,
      receivesInvoices: false,
      receivesReports: true,
      receivesLessonNotes: true,
      receivesWhatsApp: false,
      emergencyContact: false,
      isPrimary: false,
    });
  });

  it('round-trips a contact without its server-side fields', () => {
    const d = draftFromContact(khalid);
    expect(d).toMatchObject({ id: 'c2', name: 'Khalid Al Mansoori', relationship: 'father', emergencyContact: true, receivesInvoices: false });
    expect(d).not.toHaveProperty('hasLogin');
    expect(d).not.toHaveProperty('familyId');
    expect(d).not.toHaveProperty('profileId');
  });

  it('normalises names, emails and telephone numbers', () => {
    const n = normaliseContactDraft(draft({ id: ' ', name: '  Grace  ', email: ' Grace@Example.COM ', phone: '050 123 4567' }));
    expect(n.id).toBeUndefined();
    expect(n.name).toBe('Grace');
    expect(n.email).toBe('grace@example.com');
    expect(n.phone).toBe('+971501234567');
    expect(normaliseContactDraft(draft({ email: '  ', phone: '' })).email).toBeUndefined();
    expect(normaliseContactDraft(draft({ phone: '  ' })).phone).toBeUndefined();
    // Not a number we can put in E.164 form: kept as typed.
    expect(normaliseContactDraft(draft({ phone: ' ext. 12 ' })).phone).toBe('ext. 12');
    expect(normaliseContactDraft(draft({ id: 'c3' })).id).toBe('c3');
  });
});

describe('notice defaults by relationship', () => {
  it('sends reports and lesson notes to parents and guardians only', () => {
    for (const r of ['mother', 'father', 'parent', 'guardian'] as const) {
      expect(noticeDefaultsFor(r)).toEqual({ receivesInvoices: false, receivesReports: true, receivesLessonNotes: true });
    }
  });

  it('sends a personal assistant or family office invoices but not the child\'s reports or notes', () => {
    for (const r of ['pa', 'family_office'] as const) {
      expect(noticeDefaultsFor(r)).toEqual({ receivesInvoices: true, receivesReports: false, receivesLessonNotes: false });
    }
  });

  it('sends a driver or anyone else nothing until switched on', () => {
    for (const r of ['driver', 'other'] as const) {
      expect(noticeDefaultsFor(r)).toEqual({ receivesInvoices: false, receivesReports: false, receivesLessonNotes: false });
    }
  });

  it('a new contact follows its relationship, and WhatsApp is never on without consent', () => {
    for (const r of RELATIONSHIP_ORDER) {
      const d = emptyContactDraft(r);
      expect(d.relationship).toBe(r);
      expect(d).toMatchObject(noticeDefaultsFor(r));
      expect(d.receivesWhatsApp).toBe(false);
      expect(d.canLogIn).toBe(false);
    }
  });
});

describe('emailLockHint', () => {
  const second: FamilyContact = { ...base, id: 'c2', name: 'Second', email: 'second@example.com', isPrimary: false, profileId: 'u2' };
  const driver: FamilyContact = { ...base, id: 'c3', name: 'Driver', relationship: 'driver', canLogIn: false, hasLogin: false, isPrimary: false, profileId: undefined };

  it('sends a parent to the office for their own address', () => {
    expect(emailLockHint(base, [base, second], { id: 'u1', role: 'parent' })).toBe(
      'This is the address you sign in with. To change it, please ask the office.',
    );
  });

  it('sends a parent to the office for the family\'s last sign-in', () => {
    expect(emailLockHint(second, [second, driver], { id: 'u9', role: 'parent' })).toBe(
      'This is the address they sign in with. To change it, please ask the office.',
    );
  });

  it('otherwise explains switching off sign-in, and warns that access is lost meanwhile', () => {
    const hint = emailLockHint(second, [base, second], { id: 'u1', role: 'parent' });
    expect(hint).toContain('switch off their sign-in and save first');
    expect(hint).toContain('will not be able to sign in until');
    // The office may always do so, even for the last sign-in.
    expect(emailLockHint(second, [second], { id: 'u-admin', role: 'admin' })).toBe(hint);
  });
});

describe('validateContactDraft', () => {
  const family = [fatima, khalid];

  it('accepts a good contact', () => {
    expect(validateContactDraft(draft(), family, 'parent')).toBeNull();
    expect(validateContactDraft(draft({ email: undefined }), family, 'admin')).toBeNull();
  });

  it('needs a name', () => {
    expect(validateContactDraft(draft({ name: '   ' }), family, 'admin')).toBe(CONTACT_ERRORS.name);
    expect(CONTACT_ERRORS.name).toBe("Please enter the contact's name.");
  });

  it('needs a valid email when one is given', () => {
    expect(validateContactDraft(draft({ email: 'grace@' }), family, 'admin')).toBe(CONTACT_ERRORS.email);
    expect(CONTACT_ERRORS.email).toBe('Please enter a valid email address.');
  });

  it('needs an email for a login and for the main contact', () => {
    expect(validateContactDraft(draft({ email: undefined, canLogIn: true }), family, 'admin')).toBe(CONTACT_ERRORS.loginNeedsEmail);
    expect(validateContactDraft(draft({ email: undefined, isPrimary: true }), family, 'admin')).toBe(CONTACT_ERRORS.primaryNeedsEmail);
    expect(CONTACT_ERRORS.loginNeedsEmail).toBe('A contact who can sign in needs an email address.');
    expect(CONTACT_ERRORS.primaryNeedsEmail).toBe('The main contact needs an email address.');
  });

  it('needs an international mobile number for WhatsApp, unless the contact signs in with their own settings', () => {
    expect(validateContactDraft(draft({ receivesWhatsApp: true }), family, 'admin')).toBe(CONTACT_ERRORS.whatsappNumber);
    expect(validateContactDraft(draft({ receivesWhatsApp: true, phone: 'ext. 12' }), family, 'admin')).toBe(CONTACT_ERRORS.whatsappNumber);
    expect(validateContactDraft(draft({ receivesWhatsApp: true, phone: '050 123 4567' }), family, 'admin')).toBeNull();
    expect(validateContactDraft(draft({ receivesWhatsApp: true, phone: '050 123' }), family, 'admin')).toBe(CONTACT_ERRORS.whatsappNumber);
    expect(validateContactDraft(draft({ receivesWhatsApp: true, phone: '+971 4 123 4567' }), family, 'admin')).toBe(CONTACT_ERRORS.whatsappNumber);
    expect(validateContactDraft(draft({ receivesWhatsApp: true, phone: '+44 7700 900123' }), family, 'admin')).toBeNull();
    expect(validateContactDraft({ ...draftFromContact(khalid), receivesWhatsApp: true, phone: undefined, hasLogin: true }, [fatima], 'parent')).toBeNull();
    expect(CONTACT_ERRORS.whatsappNumber).toBe('Please enter a mobile number with its country code, for example +971 50 123 4567, to send WhatsApp messages.');
  });

  it('rejects an email another contact in the family uses, but not the contact’s own', () => {
    expect(validateContactDraft(draft({ email: 'KHALID@example.com' }), family, 'admin')).toBe(CONTACT_ERRORS.duplicateEmail);
    expect(validateContactDraft(draftFromContact(khalid), family, 'parent')).toBeNull();
    expect(CONTACT_ERRORS.duplicateEmail).toBe('Another contact in this family already uses that email address.');
  });

  it('keeps one login for parents', () => {
    const onlyFatimaSignsIn = [fatima, grace];
    expect(validateContactDraft({ ...draftFromContact(fatima), canLogIn: false }, onlyFatimaSignsIn, 'parent')).toBe(CONTACT_ERRORS.lastLogin);
    expect(validateContactDraft({ ...draftFromContact(fatima), canLogIn: false }, onlyFatimaSignsIn, 'admin')).toBeNull();
    expect(validateContactDraft({ ...draftFromContact(fatima), canLogIn: false }, family, 'parent')).toBeNull();
    expect(CONTACT_ERRORS.lastLogin).toBe('At least one contact must be able to sign in.');
  });

  it('keeps a main contact', () => {
    expect(validateContactDraft({ ...draftFromContact(fatima), isPrimary: false }, family, 'admin')).toBe(CONTACT_ERRORS.primaryRequired);
    expect(validateContactDraft({ ...draftFromContact(fatima), isPrimary: false }, family, 'parent')).toBe(CONTACT_ERRORS.primaryRequired);
    expect(validateContactDraft({ ...draftFromContact(khalid), isPrimary: true }, family, 'parent')).toBeNull();
    expect(CONTACT_ERRORS.primaryRequired).toBe('Please choose another main contact first.');
  });

  it('leaves the cross-family email check to the server', () => {
    expect(CONTACT_ERRORS.emailElsewhere).toBe('That email address already signs in to another family. Please use a different address.');
    // A parent is given one neutral message that never says whether the address belongs to another client.
    expect(CONTACT_ERRORS.loginReferred).toBe(
      'We could not give sign-in access to that email address. The office has been told and will be in touch to add this contact for you.',
    );
    expect(CONTACT_ERRORS.loginReferred).not.toMatch(/another family|already has/);
  });
});

describe('canRemoveContact', () => {
  it('never removes the main contact', () => {
    expect(canRemoveContact(fatima, [fatima, khalid], 'admin')).toEqual({ ok: false, reason: CONTACT_ERRORS.removePrimary });
    expect(CONTACT_ERRORS.removePrimary).toBe('Please choose another main contact before removing this one.');
  });

  it('stops a parent removing the last contact who signs in', () => {
    const notPrimary = contact({ id: 'c9', isPrimary: false });
    const otherPrimary = contact({ id: 'c10', canLogIn: false });
    expect(canRemoveContact(notPrimary, [otherPrimary, notPrimary], 'parent')).toEqual({ ok: false, reason: CONTACT_ERRORS.lastLogin });
    expect(canRemoveContact(notPrimary, [otherPrimary, notPrimary], 'admin')).toEqual({ ok: true });
    expect(canRemoveContact(khalid, [fatima, khalid, grace], 'parent')).toEqual({ ok: true });
    expect(canRemoveContact(grace, [fatima, grace], 'parent')).toEqual({ ok: true });
  });
});

describe('primaryContact and contactsFromFamily', () => {
  it('finds the main contact, or the first', () => {
    expect(primaryContact([grace, fatima])?.id).toBe('c1');
    expect(primaryContact([grace, khalid])?.id).toBe('c3');
    expect(primaryContact([])).toBeUndefined();
  });

  it('builds the main contact from a family record', () => {
    const [c] = contactsFromFamily({ id: 'f-sharma', name: 'Sharma', parentName: 'Priya Sharma', email: 'priya@example.com', phone: '+971 50 000 0002', createdAt: '2026-02-01T00:00:00Z' });
    expect(c).toEqual({
      id: 'f-sharma-primary',
      familyId: 'f-sharma',
      name: 'Priya Sharma',
      relationship: 'parent',
      email: 'priya@example.com',
      phone: '+971 50 000 0002',
      preferredChannel: 'email',
      canLogIn: true,
      receivesInvoices: true,
      receivesReports: true,
      receivesLessonNotes: true,
      receivesWhatsApp: false,
      emergencyContact: false,
      isPrimary: true,
      hasLogin: false,
      createdAt: '2026-02-01T00:00:00Z',
    });
    expect(contactsFromFamily({ id: 'f2', name: 'X', parentName: 'Y', email: '' })[0].email).toBeUndefined();
  });
});

describe('formatPhoneForDisplay', () => {
  it('groups a UAE mobile and leaves other numbers as stored', () => {
    expect(formatPhoneForDisplay('+971500000012')).toBe('+971 50 000 0012');
    expect(formatPhoneForDisplay('+971 50 000 0012')).toBe('+971 50 000 0012');
    expect(formatPhoneForDisplay('+447700900123')).toBe('+447700900123');
    expect(formatPhoneForDisplay('+971 4 123 4567')).toBe('+971 4 123 4567');
    expect(formatPhoneForDisplay(undefined)).toBeUndefined();
  });

  it('is used for the editor, and saving stores the compact form again', () => {
    const d = draftFromContact({ ...base, phone: '+971500000012' });
    expect(d.phone).toBe('+971 50 000 0012');
    expect(normaliseContactDraft(d).phone).toBe('+971500000012');
  });
});
