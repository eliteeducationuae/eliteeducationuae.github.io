import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { useFinanceData } from '@/components/money';
import { TUTOR_INVOICE_STATUS } from '@/components/tutor-pay';
import { Avatar, Columns, Figure, Figures, Group, GroupRow, Hero, Loading, Notice, Screen, Tabs, Txt, useWide } from '@/components/ui';
import { source } from '@/data';
import { useLookup, useSettings } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, formatPercent } from '@/domain/billing';
import { toDateKey } from '@/domain/dates';
import { monthSeries, type MonthFigures } from '@/domain/finance';
import { greetingLine } from '@/domain/greeting';
import { recentVatQuarters } from '@/domain/tax';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { Expense } from '@/domain/types';
import { dayMonth, quarterMonths, quarterWithReturnDue, vatReturnDueDate } from '@/domain/vat-due';
import { useTheme } from '@/hooks/use-theme';
import { aed } from '@/lib/invoice-pdf';
import { plural } from '@/lib/id';

import {
  creditNotesCsv,
  expensesCsv,
  inPeriod,
  invoicesCsv,
  paymentsCsv,
  profitAndLossCsv,
  refundsCsv,
  tutorPayCsv,
  type Period,
} from './exports';
import { LONG_MONTHS, longDay, shortDate } from './format';

type Period3 = 'month' | 'last' | 'year';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** The accountant's home: the books for a month, the month before or the last 12 months, read only. */
export function AccountantMoneyScreen() {
  const me = useMe();
  const theme = useTheme();
  const wide = useWide();
  const lookup = useLookup();
  const finance = useFinanceData();
  const settings = useSettings();
  const [view, setView] = useState<Period3>('last');
  const now = useMemo(() => new Date(), []);
  const series = useMemo(() => (finance.data ? monthSeries(now, 12, finance.data) : []), [finance.data, now]);
  if (!finance.data || !lookup.ready) return <Loading />;
  const d = finance.data;
  const invoicesOnly = !d.tutorCostEstimates;

  // Periods
  const monthPeriod = (offset: number): Period & { label: string; key: string } => {
    const m = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
    return { from: `${key}-01`, to: `${key}-${pad(lastDay(m.getFullYear(), m.getMonth()))}`, slug: key, key, label: LONG_MONTHS[m.getMonth()] };
  };
  const thisMonth = monthPeriod(0);
  const lastMonth = monthPeriod(1);
  const yearStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const yearPeriod = { from: toDateKey(yearStart), to: toDateKey(now), slug: `12-months-${toDateKey(now)}`, key: '', label: '12 months' };
  const period = view === 'month' ? thisMonth : view === 'last' ? lastMonth : yearPeriod;

  const sum = (ms: MonthFigures[]): MonthFigures => {
    const t = ms.reduce(
      (a, m) => ({
        ...a,
        revenue: a.revenue + m.revenue,
        tutorCosts: a.tutorCosts + m.tutorCosts,
        tutorCostsEstimated: a.tutorCostsEstimated || m.tutorCostsEstimated,
        expenses: a.expenses + m.expenses,
        credits: a.credits + m.credits,
        refunds: a.refunds + m.refunds,
        profit: a.profit + m.profit,
        cashIn: a.cashIn + m.cashIn,
      }),
      { month: '', label: '12 months', revenue: 0, tutorCosts: 0, tutorCostsEstimated: false, expenses: 0, credits: 0, refunds: 0, profit: 0, margin: 0, cashIn: 0 },
    );
    return { ...t, margin: t.revenue ? t.profit / t.revenue : 0 };
  };
  const shown = view === 'year' ? sum(series) : (series.find((m) => m.month === period.key) ?? series[series.length - 1]);
  const meta =
    view === 'month'
      ? 'Month to date, so an estimate'
      : view === 'last'
        ? `${lastMonth.label} ${lastMonth.from.slice(0, 4)}`
        : `${LONG_MONTHS[yearStart.getMonth()]} ${yearStart.getFullYear()} to ${LONG_MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  // The hero line: the VAT return that is due now, or else the next one.
  const startMonth = settings.data?.vatQuarterStartMonth ?? 1;
  const due = quarterWithReturnDue(now, startMonth);
  const current = recentVatQuarters(now, startMonth, 1)[0];
  const heroLine = due
    ? `Read-only access to the Elite Education books. The ${quarterMonths(due)} VAT return is due on ${dayMonth(vatReturnDueDate(due))}.`
    : `Read-only access to the Elite Education books. The next VAT return, for ${quarterMonths(current)}, is due on ${dayMonth(vatReturnDueDate(current))}.`;

  const expenses = d.expenses.filter((e) => inPeriod(e.date, period)).sort((a, b) => b.date.localeCompare(a.date));
  const noReceipt = expenses.filter((e) => !e.receiptPath);
  const tutorInvoices = d.tutorInvoices
    .filter((i) => i.periodStart.slice(0, 7) === period.key && i.status !== 'draft' && i.status !== 'rejected')
    .sort((a, b) => tutorInvoiceTotal(b.items) - tutorInvoiceTotal(a.items));
  const estimate = d.tutorCostEstimates?.find((e) => e.month === period.key)?.amount ?? 0;
  const familyName = (id: string) => lookup.family(id)?.name;
  const tutorName = (id: string) => lookup.tutor(id)?.fullName;
  const invoiceNumber = new Map(d.invoices.map((i) => [i.id, i.number]));
  const expenseTitle = (e: Expense) => e.description?.trim() || e.category;

  async function openReceipt(e: Expense) {
    const url = e.receiptPath && source.fileUrl ? await source.fileUrl('receipts', e.receiptPath) : null;
    if (url) await Linking.openURL(url);
  }

  const exports: { title: string; run: () => unknown }[] = [
    { title: 'Profit and loss', run: () => profitAndLossCsv(view === 'year' ? series : series.filter((m) => m.month === period.key), period.slug) },
    { title: 'Expenses', run: () => expensesCsv(d.expenses, period) },
    {
      title: 'Invoices',
      run: () => invoicesCsv(d.invoices.filter((i) => i.status !== 'draft' && inPeriod(i.issueDate, period)), familyName, period.slug),
    },
    {
      title: 'Credit notes',
      run: () => creditNotesCsv((d.creditNotes ?? []).filter((n) => inPeriod(n.issueDate, period)) as never, familyName, period.slug),
    },
    { title: 'Payments received', run: () => paymentsCsv(d.invoices, familyName, period) },
    {
      title: 'Refunds',
      run: () =>
        refundsCsv(
          (d.refunds ?? []).filter((r) => inPeriod(r.settledAt ?? r.createdAt, period)),
          (id) => invoiceNumber.get(id),
          familyName,
          period.slug,
        ),
    },
    { title: 'Tutor pay', run: () => tutorPayCsv(d.tutorInvoices, tutorName, period) },
  ];

  const max = Math.max(1, ...series.map((m) => m.revenue));
  const firstName = me.fullName.split(' ')[0];

  return (
    <Screen topInset onRefresh={finance.refetch} refreshing={finance.refreshing}>
      <Hero
        kicker={longDay(now)}
        title={`${greetingLine(now, firstName)}.`}
        line={heroLine}
        right={wide ? undefined : <Avatar name={me.fullName} size={36} />}
      />
      <Tabs
        accessibilityLabel="Period"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'month', label: thisMonth.label },
          { value: 'last', label: lastMonth.label },
          { value: 'year', label: '12 months' },
        ]}
      />
      <Figures>
        <Figure label="Revenue" value={formatAED(shown.revenue)} hint="lessons delivered, excluding VAT" />
        <Figure
          label="Profit"
          value={formatAED(shown.profit)}
          hint={shown.revenue ? `${formatPercent(shown.margin)} margin` : 'No revenue yet'}
          tone={shown.profit < 0 ? 'bad' : 'good'}
        />
        <Figure
          label="Cash received"
          value={formatAED(shown.cashIn)}
          hint={shown.refunds ? `from families, after ${formatAED(shown.refunds)} refunded` : 'from families'}
          tone={shown.cashIn < 0 ? 'bad' : undefined}
        />
      </Figures>

      {noReceipt.length ? (
        <Notice tone="warn" icon="receipt" title={noReceipt.length === 1 ? 'One expense has no receipt' : `${plural(noReceipt.length, 'expense')} have no receipt`}>
          {noReceipt
            .slice(0, 3)
            .map((e) => `${expenseTitle(e)}, ${shortDate(e.date)}, ${aed(e.amount)}`)
            .join('; ')}
          {noReceipt.length > 3 ? `; and ${noReceipt.length - 3} more.` : '.'}
        </Notice>
      ) : null}

      <Columns>
        <Group title="Profit and loss" meta={meta}>
          <GroupRow title="Revenue (lessons delivered)" titleWeight="regular" value={formatAED(shown.revenue)} valueTone="text" />
          <GroupRow title="Less credit notes" titleWeight="regular" value={shown.credits ? `−${formatAED(shown.credits)}` : formatAED(0)} valueTone={shown.credits ? 'bad' : 'text'} />
          <GroupRow
            title={`Tutor pay${invoicesOnly ? ' (tutor invoices only)' : shown.tutorCostsEstimated ? ' (part estimated)' : ''}`}
            titleWeight="regular"
            value={`−${formatAED(shown.tutorCosts)}`}
            valueTone="text"
          />
          <GroupRow title="Expenses" titleWeight="regular" value={`−${formatAED(shown.expenses)}`} valueTone="text" />
          <GroupRow title="Profit" value={formatAED(shown.profit)} valueSize={16} valueTone={shown.profit < 0 ? 'bad' : 'good'} />
          {invoicesOnly ? (
            <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
              <Txt variant="note">Estimates for lessons not yet invoiced could not be loaded, so only submitted tutor invoices are counted.</Txt>
            </View>
          ) : shown.tutorCostsEstimated ? (
            <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
              <Txt variant="note">Tutor pay is estimated from lessons taught until the tutor submits that month’s invoice.</Txt>
            </View>
          ) : null}
        </Group>

        {view === 'year' ? (
          <Group title="Revenue by month">
            {series.map((m) => (
              <GroupRow
                key={m.month}
                title={`${m.label.slice(0, 3)} · ${formatAED(m.revenue)}`}
                titleWeight="regular"
                note={`Profit ${formatAED(m.profit)}`}
                progress={Math.round((m.revenue / max) * 100)}
                progressLabel={`${m.label} revenue, against the highest month`}
                progressColor={m.profit < 0 ? theme.warning : undefined}
              />
            ))}
          </Group>
        ) : (
          <Group title={`Expenses · ${period.label}`} meta={expenses.length ? `${plural(expenses.length, 'item')} · ${formatAED(shown.expenses)}` : undefined} note={expenses.length ? undefined : `No expenses have been recorded for ${period.label}.`}>
            {expenses.map((e) => (
              <GroupRow
                key={e.id}
                icon={e.receiptPath ? 'receipt' : 'report'}
                tone={e.receiptPath ? 'gold' : 'warn'}
                title={expenseTitle(e)}
                note={`${shortDate(e.date)} · ${e.category}${e.vatAmount ? ` · VAT ${aed(e.vatAmount)}` : ''}${e.receiptPath ? '' : ' · no receipt yet'}`}
                value={aed(e.amount)}
                valueTone="text"
                onPress={e.receiptPath && source.fileUrl ? () => void openReceipt(e) : undefined}
                accessibilityHint={e.receiptPath && source.fileUrl ? 'Opens the receipt' : undefined}
              />
            ))}
          </Group>
        )}

        {view === 'year' ? null : (
          <Group
            title="Tutor pay"
            meta={formatAED(shown.tutorCosts)}
            note={tutorInvoices.length || estimate > 0 ? undefined : `No tutor invoices for ${period.label} yet.`}>
            {tutorInvoices.map((i) => (
              <GroupRow
                key={i.id}
                avatar={tutorName(i.tutorId) ?? 'Tutor'}
                title={tutorName(i.tutorId) ?? 'Tutor'}
                note={`${i.number} · ${TUTOR_INVOICE_STATUS[i.status].label}${i.paidAt ? ` ${shortDate(i.paidAt)}` : ''}`}
                value={formatAED(tutorInvoiceTotal(i.items))}
                valueTone="text"
              />
            ))}
            {estimate > 0 ? (
              <GroupRow icon="groups" title="Not yet invoiced" note="Estimated from lessons taught" value={formatAED(estimate)} valueTone="text" />
            ) : null}
          </Group>
        )}

        <Group title={`Exports · ${period.label}`}>
          {exports.map((x) => (
            <GroupRow
              key={x.title}
              icon="download"
              title={x.title}
              note="CSV"
              action={{ label: 'Download', onPress: () => void x.run(), accessibilityLabel: `Download ${x.title}, ${period.label} (CSV)` }}
            />
          ))}
        </Group>
      </Columns>
    </Screen>
  );
}
