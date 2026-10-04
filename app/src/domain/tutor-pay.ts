import { minutesBetween, toDateKey } from './dates';
import { roundMoney } from './billing';
import type { Lesson, Service, Settings, Student, Tutor, TutorInvoiceItem } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** First and last day (`YYYY-MM-DD`) of the month containing `d`. */
export function monthBounds(d: Date): { start: string; end: string } {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toDateKey(first), end: toDateKey(last) };
}

/** Whether a lesson counts towards tutor pay. Mirrors tutorEarnings() and create_tutor_invoice(). */
export function isPaidLesson(l: Pick<Lesson, 'status'>, settings: Pick<Settings, 'payTutorForLateCancel'>): boolean {
  return l.status === 'completed' || l.status === 'no-show' || (l.status === 'late-cancel' && settings.payTutorForLateCancel);
}

/**
 * Invoice lines for a tutor's month: one per paid lesson, billed by the hour.
 * Mirrors public.create_tutor_invoice(). Lessons already on another invoice are skipped.
 */
export function tutorInvoiceLines(
  tutor: Tutor,
  lessons: Lesson[],
  services: Service[],
  students: Student[],
  month: Date,
  settings: Pick<Settings, 'payTutorForLateCancel'>,
  alreadyInvoiced: Set<string> = new Set(),
): TutorInvoiceItem[] {
  const { start, end } = monthBounds(month);
  return lessons
    .filter((l) => l.tutorId === tutor.id && !alreadyInvoiced.has(l.id) && isPaidLesson(l, settings))
    .filter((l) => {
      const key = toDateKey(new Date(l.start));
      return key >= start && key <= end;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((l) => {
      const d = new Date(l.start);
      const names = l.studentIds.map((id) => students.find((s) => s.id === id)?.fullName.split(' ')[0] ?? 'Student').join(' & ');
      const service = services.find((s) => s.id === l.serviceId)?.name ?? 'Lesson';
      return {
        description: `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} — ${service} — ${names}${l.status === 'completed' ? '' : ` (${l.status})`}`,
        quantity: roundMoney(minutesBetween(d, new Date(l.end)) / 60),
        unitPrice: tutor.hourlyPay,
        lessonId: l.id,
      };
    });
}

export function tutorInvoiceTotal(items: Pick<TutorInvoiceItem, 'quantity' | 'unitPrice'>[]): number {
  return roundMoney(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
}

/** `TI-202609-ABCD`, matching the database. */
export function tutorInvoiceNumber(tutorId: string, month: Date): string {
  const ym = `${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, '0')}`;
  return `TI-${ym}-${tutorId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Bank details
// ---------------------------------------------------------------------------

export function normaliseIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 check: format plus the mod-97 checksum. */
export function isValidIban(raw: string): boolean {
  const iban = normaliseIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** `AE07 •••• •••• 3456` */
export function maskIban(raw: string): string {
  const iban = normaliseIban(raw);
  if (iban.length < 8) return '••••';
  return `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
}

/** Group an IBAN in fours for display. */
export function formatIban(raw: string): string {
  return normaliseIban(raw).replace(/(.{4})/g, '$1 ').trim();
}
