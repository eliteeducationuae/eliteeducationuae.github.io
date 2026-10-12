import { router } from 'expo-router';
import { useState } from 'react';

import { INVOICE_STATUS } from '@/components/billing';
import { REFUND_STATUS } from '@/components/tax';
import { Actions, Button, Field, FieldsCard, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Tabs, type ValueTone } from '@/components/ui';
import { useCreditNotes, useInvoices, useLookup, useRefunds } from '@/data/hooks';
import { displayStatus, formatAED, invoiceTotals, type DisplayInvoiceStatus } from '@/domain/billing';
import { toDateKey } from '@/domain/dates';
import { receivables } from '@/domain/finance';
import { paymentLabel } from '@/domain/payments';
import type { Invoice } from '@/domain/types';
import { aed } from '@/lib/invoice-pdf';
import { plural } from '@/lib/id';

import { creditNotesCsv, invoicesCsv, refundsCsv } from './exports';
import { shortDate } from './format';

type View = 'invoices' | 'credit-notes' | 'refunds';

const STATUS_TONE: Partial<Record<DisplayInvoiceStatus, ValueTone>> = { overdue: 'bad', paid: 'good', 'part-paid': 'warn' };

/** The family's name as a row reads it: 'The Haddad family' for a surname, otherwise the name as recorded. */
function familyLabel(name: string | undefined): string {
  if (!name) return 'Family';
  return name.includes(' ') ? name : `The ${name} family`;
}

/** Accountant: every invoice, credit note and refund, newest first, with a live filter and CSV downloads. */
export function AccountantInvoicesScreen() {
  const invoices = useInvoices();
  const creditNotes = useCreditNotes();
  const refunds = useRefunds();
  const lookup = useLookup();
  const [view, setView] = useState<View>('invoices');
  const [query, setQuery] = useState('');

  if (!invoices.data || !creditNotes.data || !refunds.data || !lookup.ready) return <Loading />;
  const q = query.trim().toLowerCase();
  const familyName = (id: string) => lookup.family(id)?.name ?? '';
  const matches = (...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));
  const invoiceNumber = new Map(invoices.data.map((i) => [i.id, i.number]));

  const issued = invoices.data.filter((i) => i.status !== 'draft');
  const shownInvoices = issued
    .filter((i) => matches(i.number, familyName(i.familyId)))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const shownNotes = creditNotes.data
    .filter((n) => matches(n.number, n.invoiceNumber, familyName(n.familyId)))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const shownRefunds = refunds.data
    .filter((r) => matches(invoiceNumber.get(r.invoiceId), familyName(r.familyId), r.reference))
    .sort((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt));

  const owed = issued.filter((i) => i.status === 'sent' && invoiceTotals(i).balance > 0);
  const overdue = owed.filter((i) => displayStatus(i) === 'overdue');
  const overdueTotal = overdue.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const slug = toDateKey(new Date());

  const invoiceNote = (i: Invoice) => {
    const status = displayStatus(i);
    const t = invoiceTotals(i);
    const lastPaid = i.payments.map((p) => p.paidAt).sort().pop();
    const when = status === 'paid' && lastPaid ? ` ${shortDate(lastPaid)}` : i.status === 'sent' ? ` · due ${shortDate(i.dueDate)}` : '';
    return `${INVOICE_STATUS[status].label}${when} · issued ${shortDate(i.issueDate)}${t.credited > 0 && status !== 'credited' ? ' · part credited' : ''}`;
  };

  const download = () => {
    if (view === 'invoices') return invoicesCsv(shownInvoices, familyName, slug);
    if (view === 'credit-notes') return creditNotesCsv(shownNotes, familyName, slug);
    return refundsCsv(shownRefunds, (id) => invoiceNumber.get(id), familyName, slug);
  };
  const empty = (what: string) => (q ? `No ${what} match this filter.` : `${what[0].toUpperCase()}${what.slice(1)} appear here once they are issued.`);

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        refunds.refetch();
      }}
      refreshing={invoices.isRefetching}>
      <PageHeader kicker="Books" title="Invoices, credit notes and refunds" sub="Newest first. Drafts are not shown." />
      <Tabs
        accessibilityLabel="Documents"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'invoices', label: 'Invoices' },
          { value: 'credit-notes', label: 'Credit notes' },
          { value: 'refunds', label: 'Refunds' },
        ]}
      />
      {view === 'invoices' && !q ? (
        <Figures>
          <Figure label="Outstanding" value={formatAED(receivables(invoices.data))} hint={plural(owed.length, 'invoice')} />
          <Figure label="Overdue" value={formatAED(overdueTotal)} hint={plural(overdue.length, 'invoice')} tone={overdueTotal > 0 ? 'bad' : undefined} />
        </Figures>
      ) : null}
      <FieldsCard>
        <Field label="Filter" value={query} onChangeText={setQuery} placeholder="Family name or number" autoCapitalize="none" autoCorrect={false} />
      </FieldsCard>

      {view === 'invoices' ? (
        <Group note={shownInvoices.length ? undefined : empty('invoices')}>
          {shownInvoices.map((i) => {
            const status = displayStatus(i);
            return (
              <GroupRow
                key={i.id}
                icon="receipt_long"
                title={`${i.number} · ${familyLabel(familyName(i.familyId))}`}
                note={invoiceNote(i)}
                value={aed(invoiceTotals(i).total)}
                valueTone={STATUS_TONE[status] ?? 'text'}
                onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: i.id } })}
              />
            );
          })}
        </Group>
      ) : null}

      {view === 'credit-notes' ? (
        <Group note={shownNotes.length ? undefined : empty('credit notes')}>
          {shownNotes.map((n) => (
            <GroupRow
              key={n.id}
              icon="undo"
              tone="bad"
              title={`${n.number} · ${familyLabel(familyName(n.familyId))}`}
              note={`Issued ${shortDate(n.issueDate)} · against ${n.invoiceNumber}`}
              value={`−${aed(n.total)}`}
              valueTone="bad"
              onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
            />
          ))}
        </Group>
      ) : null}

      {view === 'refunds' ? (
        <Group note={shownRefunds.length ? undefined : empty('refunds')}>
          {shownRefunds.map((r) => (
            <GroupRow
              key={r.id}
              icon="currency_exchange"
              title={`${r.reference ?? REFUND_STATUS[r.status].label} · ${familyLabel(familyName(r.familyId))}`}
              note={`${paymentLabel({ method: r.method, reference: undefined })} refund · ${
                r.status === 'succeeded' ? `settled ${shortDate(r.settledAt ?? r.createdAt)}` : REFUND_STATUS[r.status].label.toLowerCase()
              } · ${invoiceNumber.get(r.invoiceId) ?? ''}`}
              value={aed(r.amount)}
              valueTone="text"
              onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: r.invoiceId } })}
            />
          ))}
        </Group>
      ) : null}

      <Actions>
        <Button title="Download as CSV" icon="download" variant="secondary" onPress={() => void download()} />
      </Actions>
    </Screen>
  );
}
