import type { Lookup } from '@/data/hooks';
import { invoiceTotals, roundMoney } from '@/domain/billing';
import { startOfMonth, toDateKey } from '@/domain/dates';
import { creditNoteTrueCredit, type FinanceData, type MonthFigures } from '@/domain/finance';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { CreditNote, Refund } from '@/domain/types';
import { exportCSV } from '@/lib/csv-export';

export interface MoneyExport {
  /** Short name, e.g. "Invoices". */
  title: string;
  run: () => void;
}

/** The CSV exports for the accountant, each covering the last 12 months. Shared by the office's and the accountant's Money. */
export function moneyExports({
  data: d,
  creditNotes,
  refunds,
  lookup,
  series,
  now,
}: {
  data: FinanceData;
  creditNotes: CreditNote[];
  refunds: Refund[];
  lookup: Lookup;
  series: MonthFigures[];
  now: Date;
}): MoneyExport[] {
  const yearStart = toDateKey(new Date(startOfMonth(now).getFullYear(), startOfMonth(now).getMonth() - 11, 1));
  const invoiceById = new Map(d.invoices.map((i) => [i.id, i]));
  const familyName = (id: string) => lookup.family(id)?.name;
  const stamp = toDateKey(now);
  return [
    {
      title: 'Invoices',
      run: () =>
        exportCSV(`invoices-${stamp}.csv`, [
          ['Number', 'Family', 'Issued', 'Due', 'Status', 'Subtotal', 'VAT', 'Total', 'Credited', 'Paid', 'Refunded', 'Balance'],
          ...d.invoices
            .filter((i) => i.issueDate >= yearStart)
            .map((i) => {
              const t = invoiceTotals(i);
              return [
                i.number,
                familyName(i.familyId),
                i.issueDate,
                i.dueDate,
                i.status,
                t.subtotal,
                t.vat,
                t.total,
                t.credited,
                t.paid,
                t.refunded,
                t.balance,
              ];
            }),
        ]),
    },
    {
      title: 'Credit notes',
      run: () =>
        exportCSV(`credit-notes-${stamp}.csv`, [
          ['Number', 'Invoice', 'Family', 'Issued', 'Reason', 'Net', 'VAT', 'Total', 'Net re-invoiced'],
          ...creditNotes
            .filter((n) => n.issueDate >= yearStart)
            .map((n) => [
              n.number,
              n.invoiceNumber,
              familyName(n.familyId),
              n.issueDate,
              n.reason,
              n.subtotal,
              n.vat,
              n.total,
              roundMoney(n.subtotal - creditNoteTrueCredit(n)),
            ]),
        ]),
    },
    {
      title: 'Payments received',
      run: () =>
        exportCSV(`payments-${stamp}.csv`, [
          ['Date', 'Invoice', 'Family', 'Method', 'Reference', 'Amount'],
          ...d.invoices.flatMap((i) =>
            i.payments
              .filter((p) => p.paidAt.slice(0, 10) >= yearStart)
              .map((p) => [p.paidAt.slice(0, 10), i.number, familyName(i.familyId), p.method, p.reference, p.amount]),
          ),
        ]),
    },
    {
      title: 'Refunds',
      run: () =>
        exportCSV(`refunds-${stamp}.csv`, [
          ['Date', 'Invoice', 'Family', 'Method', 'Status', 'Reference', 'Amount'],
          ...refunds
            .filter((r) => (r.settledAt ?? r.createdAt).slice(0, 10) >= yearStart)
            .map((r) => [
              (r.settledAt ?? r.createdAt).slice(0, 10),
              invoiceById.get(r.invoiceId)?.number,
              familyName(r.familyId),
              r.method,
              r.status,
              r.reference,
              r.amount,
            ]),
        ]),
    },
    {
      title: 'Expenses',
      run: () =>
        exportCSV(`expenses-${stamp}.csv`, [
          ['Date', 'Category', 'Description', 'Amount', 'VAT', 'Receipt'],
          ...[...d.expenses]
            .sort((a, b) => b.date.localeCompare(a.date))
            .filter((e) => e.date >= yearStart)
            .map((e) => [e.date, e.category, e.description, e.amount, e.vatAmount, e.receiptPath ? 'yes' : '']),
        ]),
    },
    {
      title: 'Tutor payouts',
      run: () =>
        exportCSV(`tutor-payouts-${stamp}.csv`, [
          ['Invoice', 'Tutor', 'Period', 'Status', 'Total', 'Paid on', 'Reference'],
          ...d.tutorInvoices
            .filter((i) => i.status !== 'draft' && i.periodStart >= yearStart)
            .map((i) => [
              i.number,
              lookup.tutor(i.tutorId)?.fullName,
              i.periodStart.slice(0, 7),
              i.status,
              tutorInvoiceTotal(i.items),
              i.paidAt?.slice(0, 10),
              i.paymentReference,
            ]),
        ]),
    },
    {
      title: 'Profit & loss by month',
      run: () =>
        exportCSV(`profit-and-loss-${stamp}.csv`, [
          ['Month', 'Revenue', 'Credits to families', 'Tutor costs', 'Tutor costs estimated', 'Expenses', 'Profit', 'Refunds', 'Cash received less refunds'],
          ...series.map((m) => [m.month, m.revenue, m.credits, m.tutorCosts, m.tutorCostsEstimated ? 'yes' : 'no', m.expenses, m.profit, m.refunds, m.cashIn]),
        ]),
    },
  ];
}

/** The last twelve months added together, as one period. */
export function yearFigures(series: MonthFigures[]): MonthFigures {
  const y = series.reduce(
    (t, m) => ({
      ...t,
      revenue: t.revenue + m.revenue,
      tutorCosts: t.tutorCosts + m.tutorCosts,
      tutorCostsEstimated: t.tutorCostsEstimated || m.tutorCostsEstimated,
      expenses: t.expenses + m.expenses,
      credits: t.credits + m.credits,
      refunds: t.refunds + m.refunds,
      profit: t.profit + m.profit,
      cashIn: t.cashIn + m.cashIn,
    }),
    {
      month: '',
      label: 'Last 12 months',
      revenue: 0,
      tutorCosts: 0,
      tutorCostsEstimated: false,
      expenses: 0,
      credits: 0,
      refunds: 0,
      profit: 0,
      margin: 0,
      cashIn: 0,
    },
  );
  return { ...y, margin: y.revenue ? y.profit / y.revenue : 0 };
}
