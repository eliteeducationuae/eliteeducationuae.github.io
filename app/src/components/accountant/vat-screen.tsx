import { router } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { vatPercent } from '@/components/tax';
import { Actions, Button, Columns, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Screen, Tabs } from '@/components/ui';
import { source } from '@/data';
import { useCreditNotes, useExpenses, useInvoices, useLookup, useSettings } from '@/data/hooks';
import { dubaiDateKey, recentVatQuarters, vatSummary, vatSummaryCsvRows } from '@/domain/tax';
import type { Expense } from '@/domain/types';
import { dayMonth, quarterRange, vatQuarterState, vatReturnDueDate } from '@/domain/vat-due';
import { exportCSV } from '@/lib/csv-export';
import { plural } from '@/lib/id';
import { aed } from '@/lib/invoice-pdf';
import { netVatLabel, shareVatSummary } from '@/lib/vat-pdf';

import { shortDate } from './format';

/** The accountant's VAT returns: a quarter's figures, the return lines, the business's tax details and downloads. */
export function AccountantVatScreen() {
  const settings = useSettings();
  const invoices = useInvoices();
  const creditNotes = useCreditNotes();
  const expenses = useExpenses();
  const lookup = useLookup();
  const [now] = useState(() => new Date());
  const [picked, setPicked] = useState<string | null>(null);

  if (!settings.data || !invoices.data || !creditNotes.data || !expenses.data || !lookup.ready) return <Loading />;
  const s = settings.data;
  const today = dubaiDateKey(now);
  const quarters = recentVatQuarters(now, s.vatQuarterStartMonth, 4);
  // Opens on the quarter whose return is due, else the quarter in progress.
  const initial = quarters.find((q) => vatQuarterState(q, today) === 'due') ?? quarters[0];
  const quarter = quarters.find((q) => q.start === picked) ?? initial;
  const state = vatQuarterState(quarter, today);
  const dueOn = dayMonth(vatReturnDueDate(quarter));
  const familyName = (id: string) => lookup.family(id)?.name;
  const summary = vatSummary(quarter, { invoices: invoices.data, creditNotes: creditNotes.data, expenses: expenses.data, familyName });
  const inQuarter = (d: string) => d.slice(0, 10) >= quarter.start && d.slice(0, 10) <= quarter.end;
  const notes = creditNotes.data.filter((n) => inQuarter(n.issueDate)).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const allExpenses = expenses.data.filter((e) => inQuarter(e.date));
  const vatExpenses = allExpenses.filter((e) => e.vatAmount > 0).sort((a, b) => b.date.localeCompare(a.date));
  const netLabel = netVatLabel(summary);

  async function openReceipt(e: Expense) {
    const url = e.receiptPath && source.fileUrl ? await source.fileUrl('receipts', e.receiptPath) : null;
    if (url) await Linking.openURL(url);
  }

  const line = (title: string, value: string, strong = false) => (
    <GroupRow key={title} title={title} titleWeight={strong ? 'bold' : 'regular'} value={value} valueTone="text" valueSize={strong ? 16 : undefined} />
  );

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        expenses.refetch();
      }}
      refreshing={invoices.isRefetching}>
      <PageHeader kicker="Federal Tax Authority" title="VAT returns" sub="Based on invoice and credit note dates." />
      <Tabs accessibilityLabel="Tax period" value={quarter.start} onChange={setPicked} tabs={quarters.map((q) => ({ value: q.start, label: q.label }))} />

      {!s.trn ? (
        <Notice tone="warn" icon="alert">
          No TRN is recorded yet, so invoices print as plain invoices. The business’s tax details have not been entered yet. Please ask the office to add
          them.
        </Notice>
      ) : null}

      <Figures>
        <Figure
          label={netLabel}
          value={aed(Math.abs(summary.netVatPayable))}
          hint={state === 'due' ? `Due ${dueOn}` : state === 'open' ? `Quarter in progress · due ${dueOn}` : `Return was due ${dueOn}`}
          tone={state === 'due' ? 'highlight' : undefined}
        />
        <Figure label="Output VAT" value={aed(summary.netOutputVat)} hint={`${plural(summary.invoiceCount, 'invoice')}, ${plural(summary.creditNoteCount, 'credit note')}`} />
        <Figure label="Input VAT" value={aed(summary.inputVat)} hint={plural(summary.expenseCount, 'expense')} />
      </Figures>

      {state === 'due' ? (
        <Notice tone="warn" icon="event" title={`Return due ${dueOn}`}>
          Please check these figures before you file in EmaraTax. The office does not file the return.
        </Notice>
      ) : state === 'open' ? (
        <Notice tone="info" icon="event" title="Quarter in progress">
          {`These figures will change until ${dayMonth(quarter.end)}. The return is due on ${dueOn}.`}
        </Notice>
      ) : null}

      <Columns>
        <Group title="Return" meta={quarterRange(quarter)}>
          {line(`Standard-rated supplies (${plural(summary.invoiceCount, 'invoice')})`, aed(summary.standardRatedNet))}
          {summary.standardRatedCreditsNet > 0 ? line('Less credit notes (net)', `−${aed(summary.standardRatedCreditsNet)}`) : null}
          {line('Zero-rated supplies', aed(summary.zeroRatedNet))}
          {summary.outOfScopeNet > 0 ? line('Outside the scope of VAT (issued before registration)', aed(summary.outOfScopeNet)) : null}
          {line('Output VAT', aed(summary.outputVat))}
          {line(`Less credit notes VAT (${plural(summary.creditNoteCount, 'credit note')})`, `−${aed(summary.creditsVat)}`)}
          {line('Net output VAT', aed(summary.netOutputVat), true)}
          {line(`Input VAT on expenses (${plural(summary.expenseCount, 'expense')})`, `−${aed(summary.inputVat)}`)}
          {line(netLabel, aed(Math.abs(summary.netVatPayable)), true)}
        </Group>

        <Group title="Business details">
          <GroupRow icon="apartment" title={s.legalName || s.businessName} note={s.registeredAddress || 'No registered address recorded'} />
          <GroupRow
            icon="badge"
            title={s.trn ? `TRN ${s.trn}` : 'No TRN recorded'}
            note={`Quarterly returns, standard rate ${vatPercent(s.vatRate)}`}
          />
          <GroupRow icon="lock" title="Read only" note="Only the office can change these details" />
        </Group>

        <Group title="Credit notes in this quarter" note={notes.length ? undefined : 'No credit notes were issued in this quarter.'}>
          {notes.map((n) => (
            <GroupRow
              key={n.id}
              icon="undo"
              tone="bad"
              title={`${n.number} · ${familyName(n.familyId) ?? 'Family'}`}
              note={`Issued ${shortDate(n.issueDate)} · against ${n.invoiceNumber}`}
              value={`−${aed(n.total)}`}
              valueTone="bad"
              onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
            />
          ))}
        </Group>

        <Group
          title="Expenses with VAT"
          note={
            vatExpenses.length
              ? allExpenses.length > vatExpenses.length
                ? `${plural(allExpenses.length - vatExpenses.length, 'expense')} with no VAT ${allExpenses.length - vatExpenses.length === 1 ? 'is' : 'are'} in the CSV.`
                : undefined
              : 'No expenses with VAT were recorded in this quarter.'
          }>
          {vatExpenses.map((e) => (
            <GroupRow
              key={e.id}
              icon={e.receiptPath ? 'receipt' : 'report'}
              tone={e.receiptPath ? 'gold' : 'warn'}
              title={e.description?.trim() || e.category}
              note={`${shortDate(e.date)} · ${e.category}${e.receiptPath ? '' : ' · no receipt yet'}`}
              value={aed(e.vatAmount)}
              valueTone="text"
              onPress={e.receiptPath && source.fileUrl ? () => void openReceipt(e) : undefined}
              accessibilityHint={e.receiptPath && source.fileUrl ? 'Opens the receipt' : undefined}
            />
          ))}
        </Group>
      </Columns>

      <Actions>
        <Button
          title="Download VAT summary (CSV)"
          icon="download"
          onPress={() => exportCSV(`vat-${quarter.start}-${quarter.end}.csv`, vatSummaryCsvRows(summary))}
        />
        <Button title="Download as PDF" icon="picture_as_pdf" variant="secondary" onPress={() => shareVatSummary(summary, s)} />
      </Actions>
    </Screen>
  );
}
