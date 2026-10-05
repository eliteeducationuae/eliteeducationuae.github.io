import { enrolmentFor, sameSubject } from './enrolments';
import { formatAED, roundMoney } from './money';
import type { Enrolment, Lesson, Service, Student, Tutor } from './types';

/**
 * Per-student tutor pay and family prices. This is the one place the rates are decided;
 * the database functions public.lesson_enrolment, public.lesson_tutor_rate and
 * public.lesson_family_price mirror it.
 */

export type TutorRateSource = 'usual' | 'custom';
export type PriceSource = 'service' | 'custom';

/** The student's active enrolment a lesson counts towards: by lesson.subject (sameSubject), else their only active enrolment. Mirrors public.lesson_enrolment. */
export function lessonEnrolment(lesson: Pick<Lesson, 'subject'>, studentId: string, enrolments: Enrolment[]): Enrolment | undefined {
  return enrolmentFor(enrolments, studentId, lesson.subject);
}

/** Custom pay applies only when the enrolment's tutor is this tutor (cover tutors get their usual rate). */
export function studentTutorRate(
  tutor: Pick<Tutor, 'id' | 'hourlyPay'>,
  enrolment?: Enrolment,
): { rate: number; source: TutorRateSource } {
  if (enrolment && enrolment.tutorId === tutor.id && typeof enrolment.tutorPay === 'number') {
    return { rate: enrolment.tutorPay, source: 'custom' };
  }
  return { rate: tutor.hourlyPay, source: 'usual' };
}

/** Group rule: the highest effective rate among the lesson's students (custom wins ties); no students → usual. Mirrors public.lesson_tutor_rate. */
export function lessonTutorRate(
  lesson: Pick<Lesson, 'tutorId' | 'studentIds' | 'subject'>,
  tutor: Pick<Tutor, 'id' | 'hourlyPay'>,
  enrolments: Enrolment[],
): { rate: number; source: TutorRateSource; group: boolean } {
  const group = lesson.studentIds.length > 1;
  let best: { rate: number; source: TutorRateSource } = { rate: tutor.hourlyPay, source: 'usual' };
  for (const studentId of lesson.studentIds) {
    const r = studentTutorRate(tutor, lessonEnrolment(lesson, studentId, enrolments));
    if (r.rate > best.rate || (r.rate === best.rate && r.source === 'custom')) best = r;
  }
  return { ...best, group };
}

/** The service's price expressed per hour. */
export function serviceHourly(service: Pick<Service, 'rate' | 'durationMin'>): number {
  if (!(service.durationMin > 0)) return 0;
  return roundMoney((service.rate * 60) / service.durationMin);
}

/** Full-fee amount one student's family pays for a lesson. Custom: roundMoney(familyPrice × lesson hours); else service.rate. Mirrors public.lesson_family_price. */
export function lessonFamilyCharge(
  lesson: Pick<Lesson, 'start' | 'end' | 'subject'>,
  service: Pick<Service, 'rate' | 'durationMin'>,
  studentId: string,
  enrolments: Enrolment[],
): { amount: number; hourly: number; source: PriceSource } {
  const enrolment = lessonEnrolment(lesson, studentId, enrolments);
  if (enrolment && typeof enrolment.familyPrice === 'number') {
    // In whole fils so halves round up exactly as the database's numeric round() does.
    const fils = Math.round(enrolment.familyPrice * 100);
    const ms = Math.max(0, new Date(lesson.end).getTime() - new Date(lesson.start).getTime());
    return { amount: Math.round((fils * ms) / 3_600_000) / 100, hourly: enrolment.familyPrice, source: 'custom' };
  }
  return { amount: service.rate, hourly: serviceHourly(service), source: 'service' };
}

/** Best guess at the service an enrolment is taught under, for the 'Default:' placeholder: subject match (sameSubject), else phase match with the student, else undefined. */
export function serviceForEnrolment(
  services: Service[],
  enrolment: Pick<Enrolment, 'subject'>,
  student?: Pick<Student, 'phase'>,
): Service | undefined {
  const bySubject = services.find((s) => sameSubject(s.subject, enrolment.subject));
  if (bySubject) return bySubject;
  if (!student?.phase?.trim()) return undefined;
  return services.find((s) => sameSubject(s.phase, student.phase));
}

/** "Default: AED 200 — Sarah’s usual rate" (first name + ’s); with no tutor: "Choose a tutor first". */
export function tutorPayPlaceholder(tutor?: Pick<Tutor, 'fullName' | 'hourlyPay'>): string {
  if (!tutor) return 'Choose a tutor first';
  const first = tutor.fullName.trim().split(/\s+/)[0] || 'Tutor';
  return `Default: ${formatAED(tutor.hourlyPay)} — ${first}’s usual rate`;
}

/** "Default: AED 350 — IGCSE and GCSE 1:1 price" (per hour via serviceHourly); with no service: "Default: the lesson's service price". */
export function familyPricePlaceholder(service?: Pick<Service, 'name' | 'rate' | 'durationMin'>): string {
  if (!service) return "Default: the lesson's service price";
  return `Default: ${formatAED(serviceHourly(service))} — ${service.name} price`;
}

/** Parses a rate field: '' or whitespace → null (use the default); a finite number ≥ 0 and < 100000 with at most 2 decimals → that number; anything else → 'invalid'. */
export function parseRate(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid';
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n >= 100000) return 'invalid';
  return n;
}
