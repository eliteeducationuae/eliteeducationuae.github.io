import { enrolmentFor } from '@/domain/enrolments';
import { formatAED } from '@/domain/money';
import { parseRate, serviceHourly } from '@/domain/rates';
import type { Enrolment, Role, Service, Student, Tutor } from '@/domain/types';
import { plural } from '@/lib/id';

/**
 * Pure wording and visibility rules for per-student tutor pay and family prices. Kept free of React Native
 * so it can be unit tested; the components in rates.tsx render what these return.
 */

export const RATE_INVALID = 'Please enter an amount such as 200 or 199.50.';
export const RATE_NOTE = 'Leave blank to use the default.';

/** The text a rate field starts with: '' for no custom rate, else the number as typed ('265', '199.5'). */
export function rateFieldText(n?: number | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '';
}

/** The inline error for a rate field's text, or undefined when it is blank or a valid amount. */
export function rateFieldError(text: string): string | undefined {
  return parseRate(text) === 'invalid' ? RATE_INVALID : undefined;
}

/** 'Agreed role rate' when the pay came from awarding an opportunity and has not changed since; otherwise 'Custom'. */
export function customBadgeLabel(source?: Enrolment['tutorPaySource']): string {
  return source === 'opportunity' ? 'Agreed role rate' : 'Custom';
}

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] || 'Tutor';

export interface RateLine {
  key: 'tutor-pay' | 'family-price';
  label: string;
  value: string;
  /** Badge text when the rate is custom. */
  badge?: string;
  /** Explains the default when the rate is not custom. */
  note?: string;
  /** Families see one plain sentence ('Agreed price: AED 415 per hour'). */
  sentence?: boolean;
}

/**
 * What one enrolment's rate summary shows to the viewer. Every branch is gated on the viewer's role as
 * well as on the data, so a family price never reaches a tutor and tutor pay never reaches a family or student,
 * even if the data were to carry it.
 */
export function rateSummary(input: {
  enrolment: Pick<Enrolment, 'tutorId' | 'tutorPay' | 'tutorPaySource' | 'familyPrice'>;
  tutor?: Pick<Tutor, 'id' | 'fullName' | 'hourlyPay'>;
  service?: Pick<Service, 'name' | 'rate' | 'durationMin'>;
  viewer: { role: Role; tutorId?: string };
}): RateLine[] {
  const { enrolment: e, tutor, service, viewer } = input;
  const hasPay = typeof e.tutorPay === 'number';
  const hasPrice = typeof e.familyPrice === 'number';

  if (viewer.role === 'admin') {
    const pay: RateLine = hasPay
      ? { key: 'tutor-pay', label: 'Tutor pay per hour', value: formatAED(e.tutorPay!), badge: customBadgeLabel(e.tutorPaySource) }
      : tutor
        ? { key: 'tutor-pay', label: 'Tutor pay per hour', value: formatAED(tutor.hourlyPay), note: `Default — ${firstName(tutor.fullName)}’s usual rate` }
        : { key: 'tutor-pay', label: 'Tutor pay per hour', value: 'Not yet set', note: 'Default — the tutor’s usual rate, once a tutor is chosen' };
    const price: RateLine = hasPrice
      ? { key: 'family-price', label: 'Family price per hour', value: formatAED(e.familyPrice!), badge: 'Custom' }
      : service
        ? { key: 'family-price', label: 'Family price per hour', value: formatAED(serviceHourly(service)), note: `Default — ${service.name} price` }
        : { key: 'family-price', label: 'Family price per hour', value: 'Service price', note: 'Default — the lesson’s service price' };
    return [pay, price];
  }

  if (viewer.role === 'tutor') {
    if (!viewer.tutorId || e.tutorId !== viewer.tutorId) return [];
    if (hasPay) return [{ key: 'tutor-pay', label: 'Your pay for this subject', value: `${formatAED(e.tutorPay!)} per hour`, badge: customBadgeLabel(e.tutorPaySource) }];
    if (!tutor) return [];
    return [{ key: 'tutor-pay', label: 'Your pay for this subject', value: `${formatAED(tutor.hourlyPay)} per hour`, note: 'Your usual rate' }];
  }

  if (viewer.role === 'parent' && hasPrice) {
    return [{ key: 'family-price', label: 'Agreed price', value: `${formatAED(e.familyPrice!)} per hour`, sentence: true }];
  }
  return [];
}

/** Admin payroll subtitle: '4 lessons · 4 hours · usual rate AED 200 · includes 1 at custom rates'. */
export function payrollSubtitle(r: { lessons: number; hours: number; customLessons?: number }, usualRate: number): string {
  const base = `${plural(r.lessons, 'lesson')} · ${plural(r.hours, 'hour')} · usual rate ${formatAED(usualRate)}`;
  return r.customLessons ? `${base} · includes ${r.customLessons} at custom rates` : base;
}

/** A tutor's own custom rates: 'Layla Al Mansoori · Chemistry: AED 265 per hour — custom'. */
export function tutorCustomRateLines(enrolments: Enrolment[], tutorId: string | undefined, studentName: (id: string) => string | undefined): string[] {
  if (!tutorId) return [];
  return enrolments
    .filter((e) => e.active && e.tutorId === tutorId && typeof e.tutorPay === 'number')
    .map((e) => `${studentName(e.studentId) ?? 'A student'} · ${e.subject}: ${formatAED(e.tutorPay!)} per hour — ${customBadgeLabel(e.tutorPaySource).toLowerCase()}`)
    .sort((a, b) => a.localeCompare(b));
}

/** Admin booking: 'Omar Al Mansoori: custom price AED 480 per hour' for each chosen student with a custom price for the subject. */
export function bookingPriceNotes(studentIds: string[], subject: string | undefined, enrolments: Enrolment[], studentName: (id: string) => string | undefined): string[] {
  if (!subject) return [];
  const out: string[] = [];
  for (const id of studentIds) {
    const e = enrolmentFor(enrolments, id, subject);
    if (e && typeof e.familyPrice === 'number') out.push(`${studentName(id) ?? 'A student'}: custom price ${formatAED(e.familyPrice)} per hour`);
  }
  return out;
}

/** Selling a package: one note per agreed family price among the family's students. */
export function packagePriceNotes(students: Pick<Student, 'id' | 'fullName' | 'familyId'>[], familyId: string, enrolments: Enrolment[]): string[] {
  const kids = new Map(students.filter((s) => s.familyId === familyId).map((s) => [s.id, s.fullName]));
  return enrolments
    .filter((e) => e.active && kids.has(e.studentId) && typeof e.familyPrice === 'number')
    .map(
      (e) =>
        `Note: ${kids.get(e.studentId)} has an agreed price of ${formatAED(e.familyPrice!)} per hour for ${e.subject}. Package credits are used before agreed prices apply.`,
    );
}

/** True when any of the family's active subjects has an agreed price, so a 'saves N%' against the standard rate would mislead. */
export function hasCustomFamilyPrice(enrolments: Enrolment[]): boolean {
  return enrolments.some((e) => e.active && typeof e.familyPrice === 'number');
}

/** The family's agreed price for a student's subject, if any (for the parent's booking request). */
export function agreedPriceSentence(enrolment?: Pick<Enrolment, 'familyPrice'>): string | undefined {
  if (!enrolment || typeof enrolment.familyPrice !== 'number') return undefined;
  return `Extra lessons are charged at your agreed price of ${formatAED(enrolment.familyPrice)} per hour.`;
}

/** Opportunity award: 'Awarding this role sets AED 240 per hour as the tutor’s pay for this student’s Maths.' */
export function awardPaySentence(payRate: number, subject?: string): string {
  const what = subject?.trim() ? subject.trim() : 'lessons';
  return `Awarding this role sets ${formatAED(payRate)} per hour as the tutor’s pay for this student’s ${what}.`;
}
