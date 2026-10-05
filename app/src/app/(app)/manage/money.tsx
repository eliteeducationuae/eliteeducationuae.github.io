import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { Bars, Legend, useFinanceData } from '@/components/money';
import { Badge, Button, Card, ListItem, Loading, Row, Screen, Section, Segmented, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useCreditNotes, useLookup, useRefunds } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, formatPercent, invoiceTotals, roundMoney } from '@/domain/billing';
import { formatDate, startOfMonth, toDateKey } from '@/domain/dates';
import { creditNoteTrueCredit, monthSeries, receivables, type MonthFigures } from '@/domain/finance';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { Expense, TutorInvoiceStatus } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { exportCSV } from '@/lib/csv-export';

const TUTOR_INVOICE_STATUS: Record<TutorInvoiceStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Returned',
};

/** Admin (and the accountant, read only): profit and loss, expenses, the pay run and exports. */
export default function Money() {
  const theme = useTheme();
  const me = useMe();
  const lookup = useLookup();
  const finance = useFinanceData();
  const creditNotes = useCreditNotes();
  const refunds = useRefunds();
  const [view, setView] = useState<'month' | 'last' | 'year'>('month');
  const now = useMemo(() => new Date(), []);
  const series = useMemo(() => (finance.data ? monthSeries(now, 12, finance.data) : []), [finance.data, now]);
  if (!finance.data || !lookup.ready) return <Loading />;
  const d = finance.data;
  const readOnly = me.role !== 'admin';

  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];
  const year: MonthFigures = series.reduce(
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
    { month: '', label: 'Last 12 months', revenue: 0, tutorCosts: 0, tutorCostsEstimated: false, expenses: 0, credits: 0, refunds: 0, profit: 0, margin: 0, cashIn: 0 },
  );
  const shown = view === 'month' ? thisMonth : view === 'last' ? lastMonth : { ...year, margin: year.revenue ? year.profit / year.revenue : 0 };
  const payRun = d.tutorInvoices.filter((i) => i.status === 'approved');
  const toApprove = d.tutorInvoices.filter((i) => i.status === 'submitted');
  const tutorInvoices = d.tutorInvoices.filter((i) => i.status !== 'draft').sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const expenses = [...d.expenses].sort((a, b) => b.date.localeCompare(a.date));
  const yearStart = toDateKey(new Date(startOfMonth(now).getFullYear(), startOfMonth(now).getMonth() - 11, 1));
  const invoiceById = new Map(d.invoices.map((i) => [i.id, i]));
  const familyName = (id: string) => lookup.family(id)?.name;

  async function openReceipt(e: Expense) {
    const url = e.receiptPath && source.fileUrl ? await source.fileUrl('receipts', e.receiptPath) : null;
    if (url) await Linking.openURL(url);
  }

  const exports = [
    {
      title: 'Invoices',
      run: () =>
        exportCSV(`invoices-${toDateKey(now)}.csv`, [
          ['Number', 'Family', 'Issued', 'Due', 'Status', 'Subtotal', 'VAT', 'Total', 'Credited', 'Paid', 'Refunded', 'Balance'],
          ...d.invoices
            .filter((i) => i.issueDate >= yearStart)
            .map((i) => {
              const t = invoiceTotals(i);
              return [i.number, familyName(i.familyId), i.issueDate, i.dueDate, i.status, t.subtotal, t.vat, t.total, t.credited, t.paid, t.refunded, t.balance];
            }),
        ]),
    },
    {
      title: 'Credit notes',
      run: () =>
        exportCSV(`credit-notes-${toDateKey(now)}.csv`, [
          ['Number', 'Invoice', 'Family', 'Issued', 'Reason', 'Net', 'VAT', 'Total', 'Net re-invoiced'],
          ...(creditNotes.data ?? [])
            .filter((n) => n.issueDate >= yearStart)
            .map((n) => [n.number, n.invoiceNumber, familyName(n.familyId), n.issueDate, n.reason, n.subtotal, n.vat, n.total, roundMoney(n.subtotal - creditNoteTrueCredit(n))]),
        ]),
    },
    {
      title: 'Payments received',
      run: () =>
        exportCSV(`payments-${toDateKey(now)}.csv`, [
          ['Date', 'Invoice', 'Family', 'Method', 'Reference', 'Amount'],
          ...d.invoices.flatMap((i) =>
            i.payments.filter((p) => p.paidAt.slice(0, 10) >= yearStart).map((p) => [p.paidAt.slice(0, 10), i.number, familyName(i.familyId), p.method, p.reference, p.amount]),
          ),
        ]),
    },
    {
      title: 'Refunds',
      run: () =>
        exportCSV(`refunds-${toDateKey(now)}.csv`, [
          ['Date', 'Invoice', 'Family', 'Method', 'Status', 'Reference', 'Amount'],
          ...(refunds.data ?? [])
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
        exportCSV(`expenses-${toDateKey(now)}.csv`, [
          ['Date', 'Category', 'Description', 'Amount', 'VAT', 'Receipt'],
          ...expenses.filter((e) => e.date >= yearStart).map((e) => [e.date, e.category, e.description, e.amount, e.vatAmount, e.receiptPath ? 'yes' : '']),
        ]),
    },
    {
      title: 'Tutor payouts',
      run: () =>
        exportCSV(`tutor-payouts-${toDateKey(now)}.csv`, [
          ['Invoice', 'Tutor', 'Period', 'Status', 'Total', 'Paid on', 'Reference'],
          ...d.tutorInvoices
            .filter((i) => i.status !== 'draft' && i.periodStart >= yearStart)
            .map((i) => [i.number, lookup.tutor(i.tutorId)?.fullName, i.periodStart.slice(0, 7), i.status, tutorInvoiceTotal(i.items), i.paidAt?.slice(0, 10), i.paymentReference]),
        ]),
    },
    {
      title: 'Profit & loss by month',
      run: () =>
        exportCSV(`profit-and-loss-${toDateKey(now)}.csv`, [
          ['Month', 'Revenue', 'Credits to families', 'Tutor costs', 'Tutor costs estimated', 'Expenses', 'Profit', 'Refunds', 'Cash received less refunds'],
          ...series.map((m) => [m.month, m.revenue, m.credits, m.tutorCosts, m.tutorCostsEstimated ? 'yes' : 'no', m.expenses, m.profit, m.refunds, m.cashIn]),
        ]),
    },
  ];

  return (
    <Screen onRefresh={finance.refetch} refreshing={finance.refreshing}>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'month', label: thisMonth.label },
          { value: 'last', label: lastMonth.label },
          { value: 'year', label: '12 months' },
        ]}
      />
      <Card style={{ gap: Spacing.two }}>
        <Txt variant="label">Profit</Txt>
        <Txt variant="title" style={{ color: shown.profit < 0 ? theme.danger : theme.text }}>
          {formatAED(shown.profit)}
        </Txt>
        <Txt variant="muted">{shown.revenue ? `${formatPercent(shown.margin)} margin` : 'No revenue yet'}{view === 'month' ? ' · month to date' : ''}</Txt>
        <View style={{ gap: Spacing.one, marginTop: Spacing.two }}>
          <Line label="Lessons delivered" value={shown.revenue} />
          {shown.credits ? <Line label="Credits to families" value={-shown.credits} /> : null}
          <Line label={`Tutor costs${shown.tutorCostsEstimated ? ' (part estimated)' : ''}`} value={-shown.tutorCosts} />
          <Line label="Other expenses" value={-shown.expenses} />
        </View>
        {shown.tutorCostsEstimated ? (
          <Txt variant="small">Estimated from lessons taught until the tutor submits that month’s invoice.</Txt>
        ) : null}
      </Card>
      <StatGrid>
        <Stat
          label="Cash received, less refunds"
          value={formatAED(shown.cashIn)}
          hint={shown.refunds ? `After ${formatAED(shown.refunds)} refunded` : undefined}
          // More refunded than received in the period uses the same negative tone as a loss, never brand gold.
          tone={shown.cashIn < 0 ? 'danger' : 'success'}
        />
        <Stat
          label="Owed by families"
          value={formatAED(receivables(d.invoices))}
          tone="warning"
          onPress={() => router.push(readOnly ? '/accountant/invoices' : '/admin/billing')}
        />
      </StatGrid>

      <Section title="Last 12 months">
        <Card style={{ gap: Spacing.two }}>
          <Legend items={[{ label: 'Revenue', color: theme.primary }, { label: 'Profit', color: theme.gold }]} />
          <Bars items={series.map((m) => ({ label: m.label.slice(0, 3), value: m.revenue, secondary: m.profit }))} />
        </Card>
      </Section>

      {readOnly ? (
        <Section title="Tutor invoices">
          {tutorInvoices.length === 0 ? <Txt variant="muted">No tutor invoices yet.</Txt> : null}
          {tutorInvoices.slice(0, 12).map((i) => (
            <Card key={i.id} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="h3">
                    {i.number} · {lookup.tutor(i.tutorId)?.fullName ?? 'Tutor'}
                  </Txt>
                  <Txt variant="muted">
                    {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt variant="h3">{formatAED(tutorInvoiceTotal(i.items))}</Txt>
                  <Badge label={TUTOR_INVOICE_STATUS[i.status]} tone={i.status === 'paid' ? 'success' : 'neutral'} />
                </View>
              </Row>
            </Card>
          ))}
        </Section>
      ) : (
        <Section title="Pay run">
          <Card style={{ gap: Spacing.two }} onPress={() => router.push('/manage/tutor-invoices')} accessibilityLabel="Pay run">
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="h3">{formatAED(payRun.reduce((s, i) => s + tutorInvoiceTotal(i.items), 0))} to pay</Txt>
              {toApprove.length ? <Badge label={`${toApprove.length} to approve`} tone="warning" /> : null}
            </Row>
            <Txt variant="muted">
              {payRun.length ? payRun.map((i) => `${lookup.tutor(i.tutorId)?.fullName.split(' ')[0]} ${formatAED(tutorInvoiceTotal(i.items))}`).join(' · ') : 'No approved invoices waiting to be paid.'}
            </Txt>
          </Card>
        </Section>
      )}

      <Section
        title="Expenses"
        action={readOnly ? undefined : <Button title="Add" icon="plus" size="sm" variant="ghost" onPress={() => router.push('/manage/expense-edit')} />}>
        {expenses.length === 0 ? (
          <Txt variant="muted">{readOnly ? 'No expenses have been recorded yet.' : 'Add rent, software, marketing and other costs to see true profit.'}</Txt>
        ) : null}
        {expenses.slice(0, 12).map((e) => (
          <ListItem
            key={e.id}
            title={`${e.category}${e.description ? ` — ${e.description}` : ''}`}
            subtitle={`${formatDate(e.date)}${e.vatAmount ? ` · VAT ${formatAED(e.vatAmount)}` : ''}${e.receiptPath ? '' : ' · no receipt'}`}
            right={<Txt>{formatAED(e.amount)}</Txt>}
            below={
              e.receiptPath && source.fileUrl && !readOnly ? (
                <Button title="View receipt" icon="attach" size="sm" variant="ghost" onPress={() => void openReceipt(e)} />
              ) : undefined
            }
            onPress={
              readOnly
                ? e.receiptPath && source.fileUrl
                  ? () => void openReceipt(e)
                  : undefined
                : () => router.push({ pathname: '/manage/expense-edit', params: { id: e.id } })
            }
          />
        ))}
      </Section>

      <Section title="VAT returns">
        <ListItem
          title="VAT returns"
          subtitle="Quarterly VAT summary, with CSV and PDF exports for the FTA return"
          onPress={() => router.push(readOnly ? '/accountant/vat' : '/manage/vat')}
        />
      </Section>

      <Section title={readOnly ? 'Exports' : 'Export for your accountant'}>
        <Card style={{ gap: Spacing.two }}>
          <Txt variant="muted">CSV files covering the last 12 months. They open in Excel, Numbers or Google Sheets.</Txt>
          {exports.map((x) => (
            <Button key={x.title} title={x.title} icon="share" variant="secondary" size="sm" onPress={x.run} />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Txt variant="muted">{label}</Txt>
      <Txt>{formatAED(value)}</Txt>
    </Row>
  );
}
