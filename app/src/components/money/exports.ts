import {
  creditNotesCsv,
  expensesCsv,
  invoicesCsv,
  paymentsCsv,
  profitAndLossCsv,
  refundsCsv,
  tutorPayCsv,
  type Period,
} from '@/components/accountant/exports';
import type { Lookup } from '@/data/hooks';
import { startOfMonth, toDateKey } from '@/domain/dates';
import type { FinanceData, MonthFigures } from '@/domain/finance';
import type { CreditNote, Refund } from '@/domain/types';

export interface MoneyExport {
  /** Short name, e.g. "Invoices". */
  title: string;
  run: () => void;
}

/**
 * The office's "Export for your accountant" CSVs, each covering the last 12 months. The columns are the accountant's
 * own downloads (components/accountant/exports), so both roles hand over identical files.
 */
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
  const stamp = toDateKey(now);
  const year: Period = { from: yearStart, to: '9999-12-31', slug: stamp };
  const invoiceNumber = new Map(d.invoices.map((i) => [i.id, i.number]));
  const familyName = (id: string) => lookup.family(id)?.name;
  const tutorName = (id: string) => lookup.tutor(id)?.fullName;
  return [
    { title: 'Invoices', run: () => invoicesCsv(d.invoices.filter((i) => i.issueDate >= yearStart), familyName, stamp) },
    { title: 'Credit notes', run: () => creditNotesCsv(creditNotes.filter((n) => n.issueDate >= yearStart), familyName, stamp) },
    { title: 'Payments received', run: () => paymentsCsv(d.invoices, familyName, year) },
    {
      title: 'Refunds',
      run: () =>
        refundsCsv(
          refunds.filter((r) => (r.settledAt ?? r.createdAt).slice(0, 10) >= yearStart),
          (id) => invoiceNumber.get(id),
          familyName,
          stamp,
        ),
    },
    { title: 'Expenses', run: () => expensesCsv([...d.expenses].sort((a, b) => b.date.localeCompare(a.date)), year) },
    { title: 'Tutor payouts', run: () => tutorPayCsv(d.tutorInvoices, tutorName, year) },
    { title: 'Profit & loss by month', run: () => profitAndLossCsv(series, stamp) },
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
