import type { ContactChannel, ContactRelationship, Enrolment, FamilyContact, FamilyContactDraft } from '@/domain/types';

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

/** An embedded one-to-one relation from PostgREST: an object, a one-element array, or null. */
function embedded(v: unknown): Record<string, unknown> | undefined {
  const one = Array.isArray(v) ? v[0] : v;
  return one && typeof one === 'object' ? (one as Record<string, unknown>) : undefined;
}

function amount(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The custom rates embedded in an enrolments row (enrolment_tutor_pay, enrolment_family_price). Absent where RLS hides them. */
export function enrolmentRatesFromRow(r: Record<string, unknown>): Pick<Enrolment, 'tutorPay' | 'tutorPaySource' | 'familyPrice'> {
  const out: Pick<Enrolment, 'tutorPay' | 'tutorPaySource' | 'familyPrice'> = {};
  const pay = embedded(r.enrolment_tutor_pay);
  const tutorPay = amount(pay?.hourly_pay);
  if (tutorPay !== undefined) {
    out.tutorPay = tutorPay;
    out.tutorPaySource = pay?.source === 'opportunity' ? 'opportunity' : 'custom';
  }
  const familyPrice = amount(embedded(r.enrolment_family_price)?.hourly_price);
  if (familyPrice !== undefined) out.familyPrice = familyPrice;
  return out;
}

/** The set_enrolment_rates RPC's arguments. null clears a rate. */
export function setEnrolmentRatesArgs(input: { enrolmentId: string; tutorPay: number | null; familyPrice: number | null }): {
  p_enrolment_id: string;
  p_tutor_pay: number | null;
  p_family_price: number | null;
} {
  return { p_enrolment_id: input.enrolmentId, p_tutor_pay: input.tutorPay, p_family_price: input.familyPrice };
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
