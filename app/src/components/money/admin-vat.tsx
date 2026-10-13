import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { creditNoteKind } from '@/components/tax';
import { Chip, Group, GroupRow, Loading, Notice, PageHeader, Screen, Txt } from '@/components/ui';
import { source } from '@/data';
import { useCreditNotes, useExpenses, useInvoices, useLookup, useSettings } from '@/data/hooks';
import { formatDate } from '@/domain/dates';
import { recentVatQuarters, vatSummary, vatSummaryCsvRows } from '@/domain/tax';
import type { Expense } from '@/domain/types';
import { exportCSV } from '@/lib/csv-export';
import { plural } from '@/lib/id';
import { aed } from '@/lib/invoice-pdf';
import { netVatLabel, shareVatSummary } from '@/lib/vat-pdf';

import { BigAmount, ChipRow, DownloadChip, Ledger, Split } from './blocks';
import { shortDate, vatReturnDue } from './format';

/** The office's VAT returns: a quarter's figures for the FTA return, the documents behind them and the exports. */
export function AdminVat() {
  const settings = useSettings();
  const invoices = useInvoices();
  const creditNotes = useCreditNotes();
  const expenses = useExpenses();
  const lookup = useLookup();
  const [now] = useState(() => new Date());
  const [picked, setPicked] = useState(0);

  const header = (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back={{ fallback: '/manage/money' }} kicker="Business · Federal Tax Authority" title="VAT returns" />
    </>
  );
  if (!settings.data || !invoices.data || !creditNotes.data || !expenses.data || !lookup.ready) {
    return (
      <Screen topInset>
        {header}
        <Loading />
      </Screen>
    );
  }
  const s = settings.data;
  const quarters = recentVatQuarters(now, s.vatQuarterStartMonth, 8);
  const quarter = quarters[Math.min(picked, quarters.length - 1)];
  const summary = vatSummary(quarter, {
    invoices: invoices.data,
    creditNotes: creditNotes.data,
    expenses: expenses.data,
    familyName: (id) => lookup.family(id)?.name,
  });
  const inQuarter = (d: string) => d.slice(0, 10) >= quarter.start && d.slice(0, 10) <= quarter.end;
  const notes = creditNotes.data.filter((n) => inQuarter(n.issueDate)).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const invoiceRows = summary.rows.filter((r) => r.kind === 'invoice').reverse();
  const quarterExpenses = expenses.data.filter((e) => inQuarter(e.date)).sort((a, b) => b.date.localeCompare(a.date));
  const invoiceIds = new Map(invoices.data.map((i) => [i.number, i.id]));
  const reclaim = summary.netVatPayable < 0;
  const due = vatReturnDue(quarter.end);
  // The return most likely being prepared now: the last quarter that has ended, while its due date is still ahead.
  const last = quarters[1];
  const lastDue = last ? vatReturnDue(last.end) : null;

  async function openReceipt(e: Expense) {
    const url = e.receiptPath && source.fileUrl ? await source.fileUrl('receipts', e.receiptPath) : null;
    if (url) await Linking.openURL(url);
  }

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        expenses.refetch();
      }}
      refreshing={invoices.isRefetching}>
      {header}
      {!s.trn ? (
        <Notice tone="warn" link={{ label: 'Open business settings', onPress: () => router.push('/manage/settings') }}>
          No TRN is recorded yet, so invoices print as plain invoices. Add it under Business settings.
        </Notice>
      ) : null}

      <View style={{ gap: 8 }}>
        <Txt variant="label">Tax period</Txt>
        <ChipRow>
          {quarters.map((q, i) => (
            <Chip key={q.start} label={q.label} selected={i === picked} onPress={() => setPicked(i)} />
          ))}
        </ChipRow>
      </View>

      {last && lastDue && lastDue >= now ? (
        <Notice tone="info" title={`Due ${formatDate(lastDue)}`} link={picked === 1 ? undefined : { label: `Show ${last.label}`, onPress: () => setPicked(1) }}>
          {`The return for ${last.label} is due by ${formatDate(lastDue)}. File it in EmaraTax.`}
        </Notice>
      ) : null}

      <Split>
        <View style={{ gap: 14 }}>
          <BigAmount
            label={netVatLabel(summary)}
            amount={Math.abs(summary.netVatPayable)}
            decimals
            sub={`${formatDate(quarter.start)} to ${formatDate(quarter.end)} · return ${due >= now ? 'due' : 'was due'} ${formatDate(due)}${reclaim ? ' · more input VAT than output VAT' : ''}`}
          />
          <ChipRow>
            <DownloadChip label="Export CSV" onPress={() => exportCSV(`vat-${quarter.start}-${quarter.end}.csv`, vatSummaryCsvRows(summary))} />
            <DownloadChip label="Download PDF" icon="description" onPress={() => shareVatSummary(summary, s)} />
          </ChipRow>
        </View>
        <Ledger
          lines={[
            { label: `Standard-rated supplies (${plural(summary.invoiceCount, 'invoice')})`, value: aed(summary.standardRatedNet) },
            ...(summary.standardRatedCreditsNet > 0 ? [{ label: 'Less credit notes (net)', value: `−${aed(summary.standardRatedCreditsNet)}` }] : []),
            { label: 'Zero-rated supplies', value: aed(summary.zeroRatedNet) },
            ...(summary.outOfScopeNet > 0 ? [{ label: 'Outside the scope of VAT (issued before registration)', value: aed(summary.outOfScopeNet) }] : []),
            { label: 'Output VAT', value: aed(summary.outputVat) },
            { label: `Less credit notes VAT (${plural(summary.creditNoteCount, 'credit note')})`, value: `−${aed(summary.creditsVat)}` },
            { label: 'Net output VAT', value: aed(summary.netOutputVat), strong: true },
            { label: `Input VAT on expenses (${plural(summary.expenseCount, 'expense')})`, value: `−${aed(summary.inputVat)}` },
            { label: netVatLabel(summary), value: aed(Math.abs(summary.netVatPayable)), strong: true },
          ]}
          footnote="Figures follow invoice and credit note dates. Check them with your accountant before filing with the FTA."
        />
      </Split>

      <Group
        title="Tax invoices this quarter"
        meta={invoiceRows.length ? plural(invoiceRows.length, 'invoice') : undefined}
        note={invoiceRows.length ? undefined : 'No invoices were issued in this period.'}>
        {invoiceRows.map((r) => {
          const id = invoiceIds.get(r.reference);
          return (
            <GroupRow
              key={r.reference}
              title={`${r.reference}${r.party ? ` · ${r.party}` : ''}`}
              note={`${shortDate(r.date, now)} · net ${aed(r.net)} · VAT ${aed(r.vat)}`}
              value={aed(r.gross)}
              valueTone="text"
              onPress={id ? () => router.push({ pathname: '/invoice/[id]', params: { id } }) : undefined}
            />
          );
        })}
      </Group>

      <Split>
        <Group title="Credit notes" note={notes.length ? undefined : 'No credit notes were issued in this period.'}>
          {notes.map((n) => {
            const family = lookup.family(n.familyId)?.name;
            return (
              <GroupRow
                key={n.id}
                icon="receipt_long"
                title={family ? `${n.number} · ${family}` : n.number}
                note={`${shortDate(n.issueDate, now)} · against ${n.invoiceNumber} · ${creditNoteKind(n)}`}
                value={`−${aed(n.total)}`}
                valueTone="text"
                onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
              />
            );
          })}
        </Group>
        <Group title="Expenses with VAT" note={quarterExpenses.length ? undefined : 'There are no expenses recorded in this period.'}>
          {quarterExpenses.map((e) => (
            <GroupRow
              key={e.id}
              icon="receipt"
              tone={e.receiptPath ? 'gold' : 'warn'}
              title={`${e.category}${e.description ? ` · ${e.description}` : ''}`}
              note={`${shortDate(e.date, now)} · VAT ${aed(e.vatAmount)}${e.receiptPath ? '' : ' · no receipt'}`}
              value={aed(e.amount)}
              valueTone="text"
              onPress={
                e.receiptPath && source.fileUrl ? () => void openReceipt(e) : () => router.push({ pathname: '/manage/expense-edit', params: { id: e.id } })
              }
              accessibilityHint={e.receiptPath && source.fileUrl ? 'Opens the receipt' : 'Opens the expense'}
            />
          ))}
        </Group>
      </Split>
    </Screen>
  );
}
