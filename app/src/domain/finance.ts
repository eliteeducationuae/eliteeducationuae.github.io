import { chargeRevenue, invoiceTotals, roundMoney, tutorEarnings } from './billing';
import { OTHER } from './catalogue';
import { toDateKey } from './dates';
import { tutorInvoiceTotal } from './tutor-pay';
import type { Charge, CreditNoteRef, Expense, Invoice, Lesson, LessonPackage, Refund, Settings, Tutor, TutorInvoice } from './types';

export interface MonthFigures {
  /** `YYYY-MM` */
  month: string;
  label: string;
  revenue: number;
  tutorCosts: number;
  /** True when some tutor costs are estimated from lessons because no invoice has been approved yet. */
  tutorCostsEstimated: boolean;
  expenses: number;
  /** Credit notes issued in the month, net of VAT (closing notes of re-invoiced cancellations left out). */
  credits: number;
  /** Money returned to families in the month (succeeded refunds). */
  refunds: number;
  /** revenue - credits - tutorCosts - expenses. */
  profit: number;
  /** Profit as a share of revenue (0–1), or 0 with no revenue. */
  margin: number;
  /** Money actually received from families, less refunds. */
  cashIn: number;
}

export interface FinanceData {
  charges: Charge[];
  packages: LessonPackage[];
  invoices: Invoice[];
  lessons: Lesson[];
  tutors: Tutor[];
  tutorInvoices: TutorInvoice[];
  expenses: Expense[];
  settings: Pick<Settings, 'payTutorForLateCancel'>;
  /** Defaults to the credit notes attached to the invoices. */
  creditNotes?: CreditNoteRef[];
  /** Defaults to the refunds attached to the invoices. */
  refunds?: Refund[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const inMonth = (iso: string, month: string) => iso.slice(0, 7) === month;

/**
 * Profit and loss for one calendar month.
 * Revenue: lessons delivered (charges, with package credits at their per-lesson value).
 * Tutor costs: the tutor's submitted/approved/paid invoice for that month, otherwise estimated from lessons taught.
 */
export function monthFigures(month: Date, data: FinanceData): MonthFigures {
  const key = ym(month);
  const revenue = chargeRevenue(
    data.charges.filter((c) => inMonth(toDateKey(new Date(c.date)), key)),
    data.packages,
  );
  let tutorCosts = 0;
  let estimated = false;
  for (const tutor of data.tutors) {
    const invoice = data.tutorInvoices.find(
      (i) => i.tutorId === tutor.id && i.periodStart.slice(0, 7) === key && i.status !== 'draft' && i.status !== 'rejected',
    );
    if (invoice) {
      tutorCosts += tutorInvoiceTotal(invoice.items);
    } else {
      const taught = data.lessons.filter((l) => inMonth(toDateKey(new Date(l.start)), key));
      const est = tutorEarnings(tutor, taught, data.settings).amount;
      if (est > 0) estimated = true;
      tutorCosts += est;
    }
  }
  const expenses = data.expenses.filter((e) => inMonth(e.date, key)).reduce((s, e) => s + e.amount, 0);
  const cashIn = data.invoices
    .flatMap((i) => i.payments)
    .filter((p) => inMonth(toDateKey(new Date(p.paidAt)), key))
    .reduce((s, p) => s + p.amount, 0);
  const credits = (data.creditNotes ?? data.invoices.flatMap((i) => i.creditNotes ?? []))
    .filter((n) => !n.rebilled && inMonth(n.issueDate, key))
    .reduce((s, n) => s + n.subtotal, 0);
  const refunds = (data.refunds ?? data.invoices.flatMap((i) => i.refunds ?? []))
    .filter((r) => r.status === 'succeeded' && inMonth(toDateKey(new Date(r.settledAt ?? r.createdAt)), key))
    .reduce((s, r) => s + r.amount, 0);
  const profit = revenue - credits - tutorCosts - expenses;
  return {
    month: key,
    label: `${MONTHS[month.getMonth()]} ${String(month.getFullYear()).slice(2)}`,
    revenue: roundMoney(revenue),
    tutorCosts: roundMoney(tutorCosts),
    tutorCostsEstimated: estimated,
    expenses: roundMoney(expenses),
    credits: roundMoney(credits),
    refunds: roundMoney(refunds),
    profit: roundMoney(profit),
    margin: revenue > 0 ? profit / revenue : 0,
    cashIn: roundMoney(cashIn - refunds),
  };
}

/** The last `count` months ending with the month of `now`, oldest first. */
export function monthSeries(now: Date, count: number, data: FinanceData): MonthFigures[] {
  return Array.from({ length: count }, (_, i) => monthFigures(new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1), data));
}

/** Money families owe right now (sent invoices not yet paid in full). */
export function receivables(invoices: Invoice[]): number {
  return roundMoney(invoices.filter((i) => i.status === 'sent').reduce((s, i) => s + invoiceTotals(i).balance, 0));
}

/** Revenue split by subject: each charge counts towards its lesson's subject, or 'Other'. Highest first. */
export function revenueBySubject(charges: Charge[], lessons: Lesson[], packages: LessonPackage[]): { subject: string; revenue: number }[] {
  const byLesson = new Map(lessons.map((l) => [l.id, l]));
  const out = new Map<string, { subject: string; charges: Charge[] }>();
  for (const c of charges) {
    const subject = byLesson.get(c.lessonId)?.subject?.trim() || OTHER;
    const key = subject.toLowerCase();
    const entry = out.get(key) ?? { subject, charges: [] };
    entry.charges.push(c);
    out.set(key, entry);
  }
  return [...out.values()]
    .map(({ subject, charges: cs }) => ({ subject, revenue: chargeRevenue(cs, packages) }))
    .sort((a, b) => b.revenue - a.revenue || a.subject.localeCompare(b.subject));
}

/** RFC 4180 CSV. */
export function toCSV(rows: (string | number | undefined | null)[][]): string {
  const cell = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
