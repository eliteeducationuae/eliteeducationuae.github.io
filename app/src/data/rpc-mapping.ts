import type { ContactChannel, ContactRelationship, FamilyContact, FamilyContactDraft } from '@/domain/types';

import type { NewChildSubject } from './source';

/** The add_my_child RPC's p_subjects: snake_case keys, blanks left out. */
export function addChildSubjects(subjects: NewChildSubject[]): Record<string, string>[] {
  return subjects.map((s) => {
    const row: Record<string, string | undefined> = {
      subject: s.subject.trim(),
      curriculum: s.curriculum?.trim() || undefined,
      level: s.level?.trim() || undefined,
      exam_board: s.examBoard?.trim() || undefined,
      syllabus_id: s.syllabusId?.trim() || undefined,
    };
    return Object.fromEntries(Object.entries(row).filter((e): e is [string, string] => e[1] !== undefined));
  });
}

type ContactRow = Record<string, unknown>;

const text = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));

/** A row from the list_family_contacts RPC. Nulls become undefined; tutors' rows carry no email, telephone or login. */
export function toFamilyContact(r: ContactRow): FamilyContact {
  return {
    id: String(r.id),
    familyId: String(r.family_id),
    name: String(r.name ?? ''),
    relationship: (text(r.relationship) ?? 'other') as ContactRelationship,
    email: text(r.email),
    phone: text(r.phone),
    preferredChannel: (text(r.preferred_channel) ?? 'email') as ContactChannel,
    canLogIn: !!r.can_log_in,
    receivesInvoices: !!r.receives_invoices,
    receivesReports: !!r.receives_reports,
    receivesLessonNotes: !!r.receives_lesson_notes,
    receivesWhatsApp: !!r.receives_whatsapp,
    emergencyContact: !!r.emergency_contact,
    isPrimary: !!r.is_primary,
    hasLogin: !!r.has_login,
    profileId: text(r.profile_id),
    createdAt: text(r.created_at),
  };
}

/** The save_family_contact RPC's p_contact: snake_case keys, blanks sent as null. Pass a normalised draft. */
export function familyContactPayload(d: FamilyContactDraft): Record<string, string | boolean | null> {
  return {
    id: d.id ?? null,
    name: d.name,
    relationship: d.relationship,
    email: d.email ?? null,
    phone: d.phone ?? null,
    preferred_channel: d.preferredChannel,
    can_log_in: d.canLogIn,
    receives_invoices: d.receivesInvoices,
    receives_reports: d.receivesReports,
    receives_lesson_notes: d.receivesLessonNotes,
    receives_whatsapp: d.receivesWhatsApp,
    emergency_contact: d.emergencyContact,
    is_primary: d.isPrimary,
  };
}
