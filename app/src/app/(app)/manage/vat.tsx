import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { AmountLine, CreditNoteCard, Rule } from '@/components/tax';
import { Banner, Button, Card, Chip, EmptyState, ListItem, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useCreditNotes, useExpenses, useInvoices, useLookup, useSettings } from '@/data/hooks';
import { formatDate } from '@/domain/dates';
import { recentVatQuarters, vatSummary, vatSummaryCsvRows } from '@/domain/tax';
import type { Expense } from '@/domain/types';
import { exportCSV } from '@/lib/csv-export';
import { plural } from '@/lib/id';
import { aed } from '@/lib/invoice-pdf';
import { netVatLabel, shareVatSummary } from '@/lib/vat-pdf';

/** Admin and accountant: the figures for a quarter's VAT return, with CSV and PDF exports. */
export default function VatReturns() {
  const settings = useSettings();
  const invoices = useInvoices();
  const creditNotes = useCreditNotes();
  const expenses = useExpenses();
  const lookup = useLookup();
  const [now] = useState(() => new Date());
  const [picked, setPicked] = useState(0);

  if (!settings.data || !invoices.data || !creditNotes.data || !expenses.data || !lookup.ready) return <Loading />;
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

  async function openReceipt(e: Expense) {
    const url = e.receiptPath && source.fileUrl ? await source.fileUrl('receipts', e.receiptPath) : null;
    if (url) await Linking.openURL(url);
  }

  return (
    <Screen
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        expenses.refetch();
      }}
      refreshing={invoices.isRefetching}>
      {!s.trn ? (
        <Banner tone="warning" icon="alert">
          No TRN is recorded yet, so invoices print as plain invoices. Add it under Business settings.
        </Banner>
      ) : null}
      {!s.trn ? (
        <Button title="Open business settings" variant="ghost" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/manage/settings')} />
      ) : null}

      <Section title="Tax period">
        <Row gap={Spacing.one} wrap>
          {quarters.map((q, i) => (
            <Chip key={q.start} label={q.label} selected={i === picked} onPress={() => setPicked(i)} />
          ))}
        </Row>
      </Section>

      <Card style={{ gap: Spacing.three }}>
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">{netVatLabel(summary)}</Txt>
          <Txt variant="title">{aed(Math.abs(summary.netVatPayable))}</Txt>
          <Txt variant="muted">
            {formatDate(quarter.start)} to {formatDate(quarter.end)}
            {reclaim ? ' · more input VAT than output VAT' : ''}
          </Txt>
        </View>
        <Rule />
        <View style={{ gap: Spacing.one }}>
          <AmountLine label={`Standard-rated supplies (${plural(summary.invoiceCount, 'invoice')})`} value={aed(summary.standardRatedNet)} />
          <AmountLine label="Zero-rated supplies" value={aed(summary.zeroRatedNet)} />
          <AmountLine label="Output VAT" value={aed(summary.outputVat)} />
          <AmountLine label={`Less credit notes VAT (${plural(summary.creditNoteCount, 'credit note')})`} value={`−${aed(summary.creditsVat)}`} />
          <AmountLine label="Net output VAT" value={aed(summary.netOutputVat)} strong />
          <AmountLine label={`Input VAT on expenses (${plural(summary.expenseCount, 'expense')})`} value={`−${aed(summary.inputVat)}`} />
          <AmountLine label={netVatLabel(summary)} value={aed(Math.abs(summary.netVatPayable))} strong />
        </View>
        <Row gap={Spacing.two} wrap>
          <Button
            title="Export CSV"
            icon="share"
            variant="secondary"
            size="sm"
            onPress={() => exportCSV(`vat-${quarter.start}-${quarter.end}.csv`, vatSummaryCsvRows(summary))}
          />
          <Button title="Download PDF" icon="doc" variant="secondary" size="sm" onPress={() => shareVatSummary(summary, s)} />
        </Row>
      </Card>
      <Txt variant="small">Figures are based on invoice and credit note dates. Please check them with your accountant before filing with the FTA.</Txt>

      <Section title="Tax invoices">
        {invoiceRows.length === 0 ? <Txt variant="muted">No invoices were issued in this period.</Txt> : null}
        {invoiceRows.map((r) => {
          const id = invoiceIds.get(r.reference);
          return (
            <ListItem
              key={r.reference}
              title={`${r.reference}${r.party ? ` · ${r.party}` : ''}`}
              subtitle={`${formatDate(r.date)} · net ${aed(r.net)} · VAT ${aed(r.vat)}`}
              right={<Txt>{aed(r.gross)}</Txt>}
              onPress={id ? () => router.push({ pathname: '/invoice/[id]', params: { id } }) : undefined}
            />
          );
        })}
      </Section>

      <Section title="Credit notes">
        {notes.length === 0 ? <Txt variant="muted">No credit notes were issued in this period.</Txt> : null}
        {notes.map((n) => (
          <CreditNoteCard key={n.id} note={n} familyName={lookup.family(n.familyId)?.name} />
        ))}
      </Section>

      <Section title="Expenses with VAT">
        {quarterExpenses.length === 0 ? (
          <EmptyState icon="money" title="No expenses" message="There are no expenses recorded in this period." />
        ) : null}
        {quarterExpenses.map((e) => (
          <ListItem
            key={e.id}
            title={`${e.category}${e.description ? ` · ${e.description}` : ''}`}
            subtitle={`${formatDate(e.date)} · VAT ${aed(e.vatAmount)}${e.receiptPath ? ' · tap to view the receipt' : ' · no receipt'}`}
            right={<Txt>{aed(e.amount)}</Txt>}
            onPress={e.receiptPath && source.fileUrl ? () => void openReceipt(e) : undefined}
          />
        ))}
      </Section>
    </Screen>
  );
}
