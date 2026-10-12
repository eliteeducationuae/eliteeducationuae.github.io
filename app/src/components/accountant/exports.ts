/**
 * The accountant's CSV downloads. The same columns as the office's "Export for your accountant" files on Money, here
 * limited to a period (a month or the last 12 months) or to the rows shown on the Invoices screen.
 */
import { invoiceTotals, roundMoney } from '@/domain/billing';
import { creditNoteTrueCredit, type MonthFigures } from '@/domain/finance';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { CreditNote, Expense, Invoice, Refund, TutorInvoice } from '@/domain/types';
import { exportCSV } from '@/lib/csv-export';

/** Inclusive YYYY-MM-DD bounds, plus a slug for the file name (e.g. '2026-09' or '12-months-2026-10-12'). */
export interface Period {
  from: string;
  to: string;
  slug: string;
}

type Name = (id: string) => string | undefined;
const inPeriod = (d: string | undefined, p: Period) => !!d && d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;

export function invoicesCsv(invoices: Invoice[], familyName: Name, slug: string) {
  return exportCSV(`invoices-${slug}.csv`, [
    ['Number', 'Family', 'Issued', 'Due', 'Status', 'Subtotal', 'VAT', 'Total', 'Credited', 'Paid', 'Refunded', 'Balance'],
    ...invoices.map((i) => {
      const t = invoiceTotals(i);
      return [i.number, familyName(i.familyId), i.issueDate, i.dueDate, i.status, t.subtotal, t.vat, t.total, t.credited, t.paid, t.refunded, t.balance];
    }),
  ]);
}

export function creditNotesCsv(notes: CreditNote[], familyName: Name, slug: string) {
  return exportCSV(`credit-notes-${slug}.csv`, [
    ['Number', 'Invoice', 'Family', 'Issued', 'Reason', 'Net', 'VAT', 'Total', 'Net re-invoiced'],
    ...notes.map((n) => [n.number, n.invoiceNumber, familyName(n.familyId), n.issueDate, n.reason, n.subtotal, n.vat, n.total, roundMoney(n.subtotal - creditNoteTrueCredit(n))]),
  ]);
}

export function refundsCsv(refunds: Refund[], invoiceNumber: Name, familyName: Name, slug: string) {
  return exportCSV(`refunds-${slug}.csv`, [
    ['Date', 'Invoice', 'Family', 'Method', 'Status', 'Reference', 'Amount'],
    ...refunds.map((r) => [(r.settledAt ?? r.createdAt).slice(0, 10), invoiceNumber(r.invoiceId), familyName(r.familyId), r.method, r.status, r.reference, r.amount]),
  ]);
}

export function paymentsCsv(invoices: Invoice[], familyName: Name, p: Period) {
  return exportCSV(`payments-${p.slug}.csv`, [
    ['Date', 'Invoice', 'Family', 'Method', 'Reference', 'Amount'],
    ...invoices.flatMap((i) =>
      i.payments.filter((x) => inPeriod(x.paidAt, p)).map((x) => [x.paidAt.slice(0, 10), i.number, familyName(i.familyId), x.method, x.reference, x.amount]),
    ),
  ]);
}

export function expensesCsv(expenses: Expense[], p: Period) {
  return exportCSV(`expenses-${p.slug}.csv`, [
    ['Date', 'Category', 'Description', 'Amount', 'VAT', 'Receipt'],
    ...expenses.filter((e) => inPeriod(e.date, p)).map((e) => [e.date, e.category, e.description, e.amount, e.vatAmount, e.receiptPath ? 'yes' : '']),
  ]);
}

export function tutorPayCsv(tutorInvoices: TutorInvoice[], tutorName: Name, p: Period) {
  return exportCSV(`tutor-payouts-${p.slug}.csv`, [
    ['Invoice', 'Tutor', 'Period', 'Status', 'Total', 'Paid on', 'Reference'],
    ...tutorInvoices
      .filter((i) => i.status !== 'draft' && inPeriod(i.periodStart, p))
      .map((i) => [i.number, tutorName(i.tutorId), i.periodStart.slice(0, 7), i.status, tutorInvoiceTotal(i.items), i.paidAt?.slice(0, 10), i.paymentReference]),
  ]);
}

export function profitAndLossCsv(months: MonthFigures[], slug: string) {
  return exportCSV(`profit-and-loss-${slug}.csv`, [
    ['Month', 'Revenue', 'Credits to families', 'Tutor costs', 'Tutor costs estimated', 'Expenses', 'Profit', 'Refunds', 'Cash received less refunds'],
    ...months.map((m) => [m.month, m.revenue, m.credits, m.tutorCosts, m.tutorCostsEstimated ? 'yes' : 'no', m.expenses, m.profit, m.refunds, m.cashIn]),
  ]);
}

export { inPeriod };
