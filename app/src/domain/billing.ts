import { addDays, minutesBetween, toDateKey } from './dates';
import { round2 } from './tax';
import type {
  Charge,
  Invoice,
  InvoiceItem,
  Lesson,
  LessonPackage,
  Service,
  Settings,
  Student,
  Tutor,
} from './types';

/** Round to fils, half away from zero and float-safe (see round2). */
export function roundMoney(n: number): number {
  return round2(n);
}

export function formatAED(n: number): string {
  const fixed = roundMoney(n).toFixed(Number.isInteger(roundMoney(n)) ? 0 : 2);
  return `AED ${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export interface InvoiceTotals {
  subtotal: number;
  vat: number;
  total: number;
  paid: number;
  /** Credit notes issued against the invoice (VAT included). */
  credited: number;
  /** Money returned to the family (failed refunds are left out). */
  refunded: number;
  /** total - credited - paid + refunded. Negative when the family has paid more than it owes. */
  balance: number;
}

export function invoiceTotals(
  invoice: Pick<Invoice, 'items' | 'vatRate' | 'payments'> & Partial<Pick<Invoice, 'creditNotes' | 'refunds'>>,
): InvoiceTotals {
  const subtotal = roundMoney(invoice.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const vat = roundMoney(subtotal * invoice.vatRate);
  const total = roundMoney(subtotal + vat);
  const paid = roundMoney(invoice.payments.reduce((sum, p) => sum + p.amount, 0));
  const credited = roundMoney((invoice.creditNotes ?? []).reduce((sum, c) => sum + c.total, 0));
  const refunded = roundMoney((invoice.refunds ?? []).filter((r) => r.status !== 'failed').reduce((sum, r) => sum + r.amount, 0));
  return { subtotal, vat, total, paid, credited, refunded, balance: roundMoney(total - credited - paid + refunded) };
}

/** 'credited': cancelled by credit notes covering the whole invoice. 'void' remains for invoices voided before credit notes. */
export type DisplayInvoiceStatus = Invoice['status'] | 'overdue' | 'part-paid' | 'credited';

export function displayStatus(invoice: Invoice, now: Date = new Date()): DisplayInvoiceStatus {
  if (invoice.status === 'void') {
    const { total, credited } = invoiceTotals(invoice);
    return (invoice.creditNotes?.length ?? 0) > 0 && credited >= total - 0.005 ? 'credited' : 'void';
  }
  if (invoice.status !== 'sent') return invoice.status;
  const { paid, balance } = invoiceTotals(invoice);
  if (balance <= 0) return 'paid';
  if (toDateKey(now) > invoice.dueDate) return 'overdue';
  if (paid > 0) return 'part-paid';
  return 'sent';
}

export function packageRemaining(p: LessonPackage): number {
  return Math.max(0, p.lessonsTotal - p.lessonsUsed);
}

export function packageIsUsable(p: LessonPackage, serviceId: string, onDate: Date): boolean {
  if (packageRemaining(p) <= 0) return false;
  if (p.serviceId && p.serviceId !== serviceId) return false;
  if (p.expiresAt && toDateKey(onDate) > p.expiresAt) return false;
  return true;
}

export interface ChargeResult {
  charges: Omit<Charge, 'id'>[];
  /** Package ids to draw one credit from (one entry per credit). */
  packageDraws: string[];
}

/**
 * Work out what each student owes for a lesson once it has happened (or was late-cancelled / missed).
 * A full-price lesson draws a package credit when the family has one; reduced fees are always invoiced.
 */
export function chargesForLesson(
  lesson: Lesson,
  service: Service,
  students: Student[],
  packages: LessonPackage[],
  settings: Pick<Settings, 'lateCancelFee' | 'noShowFee'>,
  attendance: Record<string, 'present' | 'late' | 'absent'> = {},
): ChargeResult {
  const result: ChargeResult = { charges: [], packageDraws: [] };
  const date = new Date(lesson.start);
  const remaining = new Map(packages.map((p) => [p.id, packageRemaining(p)]));

  for (const studentId of lesson.studentIds) {
    const student = students.find((s) => s.id === studentId);
    if (!student) continue;

    let fee: number;
    let label: string;
    if (lesson.status === 'late-cancel') {
      fee = settings.lateCancelFee;
      label = 'late cancellation';
    } else if (lesson.status === 'no-show' || attendance[studentId] === 'absent') {
      fee = settings.noShowFee;
      label = 'missed lesson';
    } else if (lesson.status === 'completed') {
      fee = 1;
      label = '';
    } else {
      continue;
    }
    if (fee <= 0) continue;

    const description = `${service.name} — ${student.fullName}, ${toDateKey(date)}${label ? ` (${label})` : ''}`;
    const base = {
      lessonId: lesson.id,
      studentId,
      familyId: student.familyId,
      description,
      date: lesson.start,
    };

    const pkg =
      fee === 1
        ? packages.find(
            (p) =>
              p.familyId === student.familyId &&
              (remaining.get(p.id) ?? 0) > 0 &&
              packageIsUsable(p, service.id, date),
          )
        : undefined;

    if (pkg) {
      remaining.set(pkg.id, (remaining.get(pkg.id) ?? 0) - 1);
      result.packageDraws.push(pkg.id);
      result.charges.push({ ...base, amount: 0, status: 'package', packageId: pkg.id });
    } else {
      result.charges.push({ ...base, amount: roundMoney(service.rate * fee), status: 'unbilled' });
    }
  }
  return result;
}

/** Turn a family's unbilled charges into invoice line items. */
export function itemsFromCharges(charges: Charge[]): InvoiceItem[] {
  return charges
    .filter((c) => c.status === 'unbilled')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => ({ description: c.description, quantity: 1, unitPrice: c.amount, chargeId: c.id }));
}

export function newInvoiceDraft(
  familyId: string,
  items: InvoiceItem[],
  settings: Pick<Settings, 'vatRate' | 'invoiceDueDays' | 'nextInvoiceNumber'>,
  now: Date = new Date(),
): Omit<Invoice, 'id'> {
  return {
    number: formatInvoiceNumber(settings.nextInvoiceNumber),
    familyId,
    issueDate: toDateKey(now),
    dueDate: toDateKey(addDays(now, settings.invoiceDueDays)),
    status: 'draft',
    items,
    vatRate: settings.vatRate,
    payments: [],
  };
}

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, '0')}`;
}

export interface TutorEarnings {
  lessons: number;
  hours: number;
  amount: number;
}

/** What a tutor has earned for lessons in a period. */
export function tutorEarnings(
  tutor: Tutor,
  lessons: Lesson[],
  settings: Pick<Settings, 'payTutorForLateCancel'>,
): TutorEarnings {
  let count = 0;
  let minutes = 0;
  for (const l of lessons) {
    if (l.tutorId !== tutor.id) continue;
    const paid =
      l.status === 'completed' ||
      l.status === 'no-show' ||
      (l.status === 'late-cancel' && settings.payTutorForLateCancel);
    if (!paid) continue;
    count++;
    minutes += minutesBetween(new Date(l.start), new Date(l.end));
  }
  const hours = minutes / 60;
  return { lessons: count, hours: roundMoney(hours), amount: roundMoney(hours * tutor.hourlyPay) };
}

/** Revenue recognised from charges in a period (package credits valued at the package's per-lesson price). */
export function chargeRevenue(charges: Charge[], packages: LessonPackage[]): number {
  return roundMoney(
    charges.reduce((sum, c) => {
      if (c.status === 'package') {
        const p = packages.find((x) => x.id === c.packageId);
        return sum + (p ? p.price / p.lessonsTotal : 0);
      }
      return sum + c.amount;
    }, 0),
  );
}
