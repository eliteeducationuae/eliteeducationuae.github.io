import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFinanceData } from '@/components/money';
import { HeaderActions } from '@/components/role-tabs';
import { Button, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Segmented, TextLink, Txt, useWide } from '@/components/ui';
import { useCreditNotes, useLookup, useRefunds } from '@/data/hooks';
import { formatAED, formatPercent, roundMoney } from '@/domain/billing';
import { monthSeries, receivables } from '@/domain/finance';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';

import { BigAmount, ChipRow, DownloadChip, Ledger, MonthBars, NoirPanel, Split, useStackBack } from './blocks';
import { moneyExports, yearFigures } from './exports';
import { monthName, shortDate } from './format';

type Period = 'month' | 'last' | 'year';

/** The office's Money: profit and loss by period, the last 12 months, expenses, the tutor pay run and the exports. */
export function AdminMoney() {
  const lookup = useLookup();
  const finance = useFinanceData();
  const creditNotes = useCreditNotes();
  const refunds = useRefunds();
  const stack = useStackBack();
  const wide = useWide();
  const [period, setPeriod] = useState<Period>('month');
  const now = useMemo(() => new Date(), []);
  const series = useMemo(() => (finance.data ? monthSeries(now, 12, finance.data) : []), [finance.data, now]);

  const header = (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back={stack} kicker="Business" title="Money" right={stack ? undefined : <HeaderActions search inbox />} />
    </>
  );
  if (!finance.data || !lookup.ready || series.length < 2) {
    return (
      <Screen topInset>
        {header}
        <Loading />
      </Screen>
    );
  }
  const d = finance.data;
  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];
  const shown = period === 'month' ? thisMonth : period === 'last' ? lastMonth : yearFigures(series);
  const when = period === 'month' ? 'month to date' : period === 'last' ? monthName(lastMonth.month) : 'last 12 months';
  // The months in the chosen period, as YYYY-MM keys, for the expenses list.
  const months = period === 'month' ? [thisMonth.month] : period === 'last' ? [lastMonth.month] : series.map((m) => m.month);
  const expenses = d.expenses.filter((e) => months.includes(e.date.slice(0, 7))).sort((a, b) => b.date.localeCompare(a.date));
  const listed = expenses.slice(0, 10);
  const payRun = d.tutorInvoices.filter((i) => i.status === 'approved');
  const toApprove = d.tutorInvoices.filter((i) => i.status === 'submitted').length;
  const payTotal = roundMoney(payRun.reduce((s, i) => s + tutorInvoiceTotal(i.items), 0));
  const exports = moneyExports({ data: d, creditNotes: creditNotes.data ?? [], refunds: refunds.data ?? [], lookup, series, now });
  const owed = receivables(d.invoices);

  return (
    <Screen topInset onRefresh={finance.refetch} refreshing={finance.refreshing}>
      {header}
      <View style={{ width: wide ? 400 : '100%' }}>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: monthName(thisMonth.month) },
            { value: 'last', label: monthName(lastMonth.month) },
            { value: 'year', label: '12 months' },
          ]}
        />
      </View>

      <Split>
        <View style={{ gap: 16 }}>
          <BigAmount
            label="Profit"
            amount={shown.profit}
            negative={shown.profit < 0}
            sub={shown.revenue ? `${formatPercent(shown.margin)} margin · ${when}` : `No revenue yet · ${when}`}
          />
          <Ledger
            lines={[
              { label: 'Lessons delivered', value: formatAED(shown.revenue) },
              ...(shown.credits ? [{ label: 'Credits to families', value: formatAED(-shown.credits) }] : []),
              { label: `Tutor costs${shown.tutorCostsEstimated ? ' (part estimated)' : ''}`, value: formatAED(-shown.tutorCosts) },
              { label: 'Other expenses', value: formatAED(-shown.expenses) },
            ]}
            footnote={shown.tutorCostsEstimated ? 'Tutor costs are estimated from lessons taught until each tutor submits the month’s invoice.' : undefined}
          />
        </View>
        <View style={{ gap: 20 }}>
          <Figures>
            <Figure
              label="Cash received"
              value={formatAED(shown.cashIn)}
              hint={shown.refunds ? `less ${formatAED(shown.refunds)} refunded` : 'less refunds'}
              tone={shown.cashIn < 0 ? 'bad' : undefined}
            />
            <Figure
              label="Owed by families"
              value={formatAED(owed)}
              hint="Open the ledger"
              tone={owed > 0 ? 'warn' : undefined}
              onPress={() => router.push('/admin/billing')}
            />
          </Figures>
          <MonthBars
            title="Last 12 months"
            highlight={period === 'month' ? [series.length - 1] : period === 'last' ? [series.length - 2] : undefined}
            items={series.map((m) => ({ label: m.label, short: m.label.slice(0, 3), revenue: m.revenue, profit: m.profit }))}
          />
        </View>
      </Split>

      <Split>
        <Group
          title="Expenses"
          link={{ label: 'Add an expense', onPress: () => router.push('/manage/expense-edit') }}
          note={
            expenses.length
              ? undefined
              : `No expenses recorded for ${period === 'year' ? 'the last 12 months' : period === 'month' ? monthName(thisMonth.month) : when}. Add rent, software, marketing and other costs to see true profit.`
          }>
          {listed.map((e) => (
            <GroupRow
              key={e.id}
              title={`${e.category}${e.description ? ` · ${e.description}` : ''}`}
              note={
                <Txt variant="note" color={e.receiptPath ? 'textMuted' : 'warning'}>
                  {`${shortDate(e.date, now)}${e.vatAmount ? ` · VAT ${formatAED(e.vatAmount)}` : ''}${e.receiptPath ? '' : ' · no receipt'}`}
                </Txt>
              }
              value={formatAED(e.amount)}
              valueTone="text"
              onPress={() => router.push({ pathname: '/manage/expense-edit', params: { id: e.id } })}
              accessibilityLabel={`${e.category}${e.description ? `, ${e.description}` : ''}, ${formatAED(e.amount)}, ${shortDate(e.date, now)}${e.receiptPath ? '' : ', no receipt'}`}
            />
          ))}
          {expenses.length > listed.length ? (
            <GroupRow title={`${expenses.length - listed.length} more`} titleWeight="regular" note="Every expense is in the Expenses CSV below." />
          ) : null}
        </Group>

        <View style={{ gap: 20 }}>
          <NoirPanel
            kicker="Pay run"
            title={payRun.length ? formatAED(payTotal) : 'Nothing to pay'}
            line={
              payRun.length
                ? payRun
                    .map((i) => `${lookup.tutor(i.tutorId)?.fullName.split(' ')[0] ?? 'Tutor'} ${formatAED(tutorInvoiceTotal(i.items)).replace('AED ', '')}`)
                    .join(' · ')
                : toApprove
                  ? `${toApprove} tutor invoice${toApprove === 1 ? ' is' : 's are'} waiting for approval.`
                  : 'No approved tutor invoices are waiting to be paid.'
            }>
            {payRun.length && toApprove ? <Txt variant="small">{`${toApprove} more to approve.`}</Txt> : null}
            <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              <Button title={payRun.length ? 'Review and pay tutors' : 'Open tutor invoices'} size="sm" onPress={() => router.push('/manage/tutor-invoices')} />
            </View>
          </NoirPanel>

          <View style={{ gap: 10 }}>
            <Txt variant="groupTitle" style={{ fontSize: 19 }} accessibilityRole="header">
              For your accountant
            </Txt>
            <Txt variant="note">CSV files covering the last 12 months. They open in Excel, Numbers or Google Sheets.</Txt>
            <ChipRow>
              {exports.map((x) => (
                <DownloadChip key={x.title} label={x.title} onPress={x.run} accessibilityLabel={`Download ${x.title} CSV`} />
              ))}
            </ChipRow>
            <View style={{ alignSelf: 'flex-start', marginTop: 6 }}>
              <TextLink label="VAT returns →" onPress={() => router.push('/manage/vat')} />
            </View>
          </View>
        </View>
      </Split>
    </Screen>
  );
}
