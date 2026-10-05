import { router } from 'expo-router';
import { useState } from 'react';

import { InvoiceCard } from '@/components/billing';
import { CreditNoteCard, RefundRow } from '@/components/tax';
import { EmptyState, Field, Loading, Screen, Segmented } from '@/components/ui';
import { useCreditNotes, useInvoices, useLookup, useRefunds } from '@/data/hooks';

type View = 'invoices' | 'credit-notes' | 'refunds';

/** Accountant: every invoice, credit note and refund, newest first, with a filter by family or number. */
export default function AccountantInvoices() {
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

  const shownInvoices = invoices.data
    .filter((i) => i.status !== 'draft' && matches(i.number, familyName(i.familyId)))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const shownNotes = creditNotes.data
    .filter((n) => matches(n.number, n.invoiceNumber, familyName(n.familyId)))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const shownRefunds = refunds.data
    .filter((r) => matches(invoiceNumber.get(r.invoiceId), familyName(r.familyId), r.reference))
    .sort((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt));

  return (
    <Screen
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        refunds.refetch();
      }}
      refreshing={invoices.isRefetching}>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'invoices', label: 'Invoices' },
          { value: 'credit-notes', label: 'Credit notes' },
          { value: 'refunds', label: 'Refunds' },
        ]}
      />
      <Field label="Filter" value={query} onChangeText={setQuery} placeholder="Family name or number" autoCapitalize="none" />

      {view === 'invoices' ? (
        shownInvoices.length ? (
          shownInvoices.map((i) => <InvoiceCard key={i.id} invoice={i} familyName={familyName(i.familyId)} />)
        ) : (
          <EmptyState icon="doc" title="No invoices" message={q ? 'No invoices match this filter.' : 'Invoices appear here once they are sent.'} />
        )
      ) : null}

      {view === 'credit-notes' ? (
        shownNotes.length ? (
          shownNotes.map((n) => <CreditNoteCard key={n.id} note={n} familyName={familyName(n.familyId)} />)
        ) : (
          <EmptyState icon="doc" title="No credit notes" message={q ? 'No credit notes match this filter.' : 'Credit notes appear here once they are issued.'} />
        )
      ) : null}

      {view === 'refunds' ? (
        shownRefunds.length ? (
          shownRefunds.map((r) => (
            <RefundRow
              key={r.id}
              refund={r}
              invoiceNumber={`${invoiceNumber.get(r.invoiceId) ?? ''} · ${familyName(r.familyId)}`}
              onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: r.invoiceId } })}
            />
          ))
        ) : (
          <EmptyState icon="money" title="No refunds" message={q ? 'No refunds match this filter.' : 'Refunds appear here once they are made.'} />
        )
      ) : null}
    </Screen>
  );
}
