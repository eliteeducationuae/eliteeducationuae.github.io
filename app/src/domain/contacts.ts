/**
 * Family contacts: labels, who receives which notices, and the rules for adding, editing and removing contacts.
 * Pure helpers shared by the screens, the demo backend and their tests. The SQL RPCs
 * (list_family_contacts, save_family_contact, remove_family_contact) enforce the same rules with the same messages.
 */
import type { ContactChannel, ContactRelationship, Family, FamilyContact, FamilyContactDraft, Role } from './types';
import { normaliseWhatsAppNumber } from './whatsapp';

export const RELATIONSHIP_LABELS: Record<ContactRelationship, string> = {
  mother: 'Mother',
  father: 'Father',
  parent: 'Parent',
  guardian: 'Guardian',
  pa: 'Personal assistant',
  family_office: 'Family office',
  driver: 'Driver',
  other: 'Other',
};

export const RELATIONSHIP_ORDER: ContactRelationship[] = ['mother', 'father', 'parent', 'guardian', 'pa', 'family_office', 'driver', 'other'];

export const CHANNEL_LABELS: Record<ContactChannel, string> = {
  email: 'Email',
  phone: 'Telephone',
  whatsapp: 'WhatsApp',
};

/** The kinds of notice a family receives; each contact chooses which they want. */
export type NoticeKind = 'invoices' | 'reports' | 'lesson_notes' | 'general';

export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  invoices: 'Invoices and payments',
  reports: 'Reports',
  lesson_notes: 'Lesson notes and homework',
  general: 'General updates',
};

/** Which kind of notice a notification link is. Mirrors SQL public.family_notice_kind. */
export function noticeKindForUrl(url: string | undefined): NoticeKind {
  const u = url ?? '';
  if (u.startsWith('/invoice/') || u.startsWith('/parent/billing')) return 'invoices';
  if (u === '/parent/progress' || u.startsWith('/reports/')) return 'reports';
  if (u.startsWith('/lesson/') || u.startsWith('/homework') || u.startsWith('/parent/progress?tab=homework')) return 'lesson_notes';
  return 'general';
}

/** Whether this contact wants this kind of notice. General updates go to everyone who signs in, and the main contact. */
export function contactReceives(c: FamilyContact, kind: NoticeKind): boolean {
  switch (kind) {
    case 'invoices':
      return c.receivesInvoices;
    case 'reports':
      return c.receivesReports;
    case 'lesson_notes':
      return c.receivesLessonNotes;
    default:
      return c.canLogIn || c.isPrimary;
  }
}

function byPrimaryThenAge(a: FamilyContact, b: FamilyContact): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
}

/** The contacts we can reach with this kind of notice (they have an email or a login), main contact first. */
export function recipientsFor(contacts: FamilyContact[], kind: NoticeKind): FamilyContact[] {
  return contacts.filter((c) => contactReceives(c, kind) && (!!c.email || c.hasLogin)).sort(byPrimaryThenAge);
}

/** Join names the British way: 'A', 'A and B', 'A, B and C'. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who will receive this kind of notice, as a phrase: 'Fatima Al Mansoori and Grace Fernandes', or 'Nobody'. */
export function describeRecipients(contacts: FamilyContact[], kind: NoticeKind): string {
  const names = recipientsFor(contacts, kind).map((c) => c.name);
  return names.length ? joinNames(names) : 'Nobody';
}

/** Short labels describing a contact's role and preferences, for chips on a contact card. */
export function contactFlagsSummary(c: FamilyContact): string[] {
  const flags: string[] = [];
  if (c.isPrimary) flags.push('Main contact');
  if (c.canLogIn) flags.push('Signs in');
  if (c.receivesInvoices) flags.push('Invoices');
  if (c.receivesReports) flags.push('Reports');
  if (c.receivesLessonNotes) flags.push('Lesson notes');
  if (c.receivesWhatsApp) flags.push('WhatsApp');
  if (c.emergencyContact) flags.push('Emergency contact');
  return flags;
}

/** A blank contact form. */
export function emptyContactDraft(): FamilyContactDraft {
  return {
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
  };
}

/** The editable part of a contact. */
export function draftFromContact(c: FamilyContact): FamilyContactDraft {
  return {
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    email: c.email,
    phone: c.phone,
    preferredChannel: c.preferredChannel,
    canLogIn: c.canLogIn,
    receivesInvoices: c.receivesInvoices,
    receivesReports: c.receivesReports,
    receivesLessonNotes: c.receivesLessonNotes,
    receivesWhatsApp: c.receivesWhatsApp,
    emergencyContact: c.emergencyContact,
    isPrimary: c.isPrimary,
  };
}

/** Tidy what was typed: trimmed name, lower-case email, phone in E.164 form where it can be, blanks left out. */
export function normaliseContactDraft(d: FamilyContactDraft): FamilyContactDraft {
  const name = (d.name ?? '').trim();
  const email = (d.email ?? '').trim().toLowerCase() || undefined;
  const typedPhone = (d.phone ?? '').trim();
  const phone = typedPhone ? (normaliseWhatsAppNumber(typedPhone) ?? typedPhone) : undefined;
  const id = (d.id ?? '').trim() || undefined;
  return { ...d, id, name, email, phone };
}

/** The messages the SQL RPCs raise, word for word. */
export const CONTACT_ERRORS = {
  name: "Please enter the contact's name.",
  email: 'Please enter a valid email address.',
  loginNeedsEmail: 'A contact who can sign in needs an email address.',
  primaryNeedsEmail: 'The main contact needs an email address.',
  whatsappNumber: 'Please enter a mobile number with its country code, for example +971 50 123 4567, to send WhatsApp messages.',
  duplicateEmail: 'Another contact in this family already uses that email address.',
  emailElsewhere: 'That email address already signs in to another family. Please use a different address.',
  lastLogin: 'At least one contact must be able to sign in.',
  primaryRequired: 'Please choose another main contact first.',
  removePrimary: 'Please choose another main contact before removing this one.',
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;
/** A UAE number must be a complete mobile, +971 5X XXX XXXX; shorter local numbers such as '050 123' are refused. */
const UAE_MOBILE_RE = /^\+9715\d{8}$/;

/** Whether a (normalised) telephone number can receive WhatsApp messages. Mirrors contact_whatsapp_number in SQL. */
export function isWhatsAppCapable(phone: string | undefined): boolean {
  if (!phone || !E164_RE.test(phone)) return false;
  return !phone.startsWith('+971') || UAE_MOBILE_RE.test(phone);
}

/**
 * Check a contact before saving. `others` are the family's other contacts (not this one).
 * Returns the first problem as a message for the form, or null when the contact can be saved.
 * Pass `hasLogin` on the draft for an existing contact who has signed in: their WhatsApp number comes from their own settings.
 * Whether the email signs in to another family is checked by the server (CONTACT_ERRORS.emailElsewhere).
 */
export function validateContactDraft(
  draft: FamilyContactDraft & { hasLogin?: boolean },
  others: FamilyContact[],
  viewerRole: Role,
): string | null {
  const d = normaliseContactDraft(draft);
  if (!d.name) return CONTACT_ERRORS.name;
  if (d.email && !EMAIL_RE.test(d.email)) return CONTACT_ERRORS.email;
  if (d.canLogIn && !d.email) return CONTACT_ERRORS.loginNeedsEmail;
  if (d.isPrimary && !d.email) return CONTACT_ERRORS.primaryNeedsEmail;
  if (d.receivesWhatsApp && !draft.hasLogin && !isWhatsAppCapable(d.phone)) return CONTACT_ERRORS.whatsappNumber;
  const rest = others.filter((o) => !d.id || o.id !== d.id);
  if (d.email && rest.some((o) => (o.email ?? '').toLowerCase() === d.email)) return CONTACT_ERRORS.duplicateEmail;
  if (viewerRole === 'parent' && !d.canLogIn && !rest.some((o) => o.canLogIn)) return CONTACT_ERRORS.lastLogin;
  if (!d.isPrimary && !rest.some((o) => o.isPrimary)) return CONTACT_ERRORS.primaryRequired;
  return null;
}

/** Whether this contact may be removed: never the main contact, and a parent cannot remove the last contact who signs in. */
export function canRemoveContact(c: FamilyContact, all: FamilyContact[], viewerRole: Role): { ok: true } | { ok: false; reason: string } {
  if (c.isPrimary) return { ok: false, reason: CONTACT_ERRORS.removePrimary };
  if (viewerRole === 'parent' && c.canLogIn && !all.some((o) => o.id !== c.id && o.canLogIn)) {
    return { ok: false, reason: CONTACT_ERRORS.lastLogin };
  }
  return { ok: true };
}

/** The family's main contact, or the first contact when none is marked. */
export function primaryContact(contacts: FamilyContact[]): FamilyContact | undefined {
  return contacts.find((c) => c.isPrimary) ?? contacts[0];
}

/** The main contact implied by a family record, for families that have no stored contacts yet. */
export function contactsFromFamily(family: Family): FamilyContact[] {
  return [
    {
      id: `${family.id}-primary`,
      familyId: family.id,
      name: family.parentName,
      relationship: 'parent',
      email: family.email || undefined,
      phone: family.phone || undefined,
      preferredChannel: 'email',
      canLogIn: true,
      receivesInvoices: true,
      receivesReports: true,
      receivesLessonNotes: true,
      receivesWhatsApp: false,
      emergencyContact: false,
      isPrimary: true,
      hasLogin: false,
      createdAt: family.createdAt,
    },
  ];
}
