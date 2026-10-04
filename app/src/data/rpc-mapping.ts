import type { Enrolment } from '@/domain/types';

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
