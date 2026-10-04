import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { InvoiceCard } from '@/components/billing';
import { Button, Card, EmptyState, ErrorNote, Loading, Row, Screen, Section, Segmented, Stat, StatGrid, Txt } from '@/components/ui';
import { source } from '@/data';
import { useAction, useCharges, useInvoices, useLookup } from '@/data/hooks';
import { displayStatus, formatAED, invoiceTotals } from '@/domain/billing';
import { notify } from '@/lib/confirm';
import { plural } from '@/lib/id';

export default function AdminBilling() {
  const lookup = useLookup();
  const charges = useCharges();
  const invoices = useInvoices();
  const invoice = useAction(source.invoiceUnbilled);
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('open');
  const [busyFamily, setBusyFamily] = useState<string | null>(null);

  const unbilled = new Map<string, { total: number; count: number }>();
  for (const c of charges.data ?? []) {
    if (c.status !== 'unbilled') continue;
    const e = unbilled.get(c.familyId) ?? { total: 0, count: 0 };
    e.total += c.amount;
    e.count += 1;
    unbilled.set(c.familyId, e);
  }

  const all = invoices.data ?? [];
  const open = all.filter((i) => i.status === 'sent');
  const outstanding = open.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const overdue = open.filter((i) => displayStatus(i) === 'overdue').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const shown = all
    .filter((i) => (filter === 'open' ? i.status === 'sent' || i.status === 'draft' : filter === 'paid' ? i.status === 'paid' : true))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));

  async function invoiceFamily(familyId: string) {
    setBusyFamily(familyId);
    try {
      const inv = await invoice.mutateAsync([familyId]);
      if (inv) router.push({ pathname: '/invoice/[id]', params: { id: inv.id } });
    } finally {
      setBusyFamily(null);
    }
  }

  async function invoiceEveryone() {
    const ids = [...unbilled.keys()];
    for (const id of ids) await invoice.mutateAsync([id]);
    notify('Invoices sent', `${ids.length} invoice${ids.length === 1 ? '' : 's'} created and sent to families.`);
  }

  return (
    <Screen onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <StatGrid>
        <Stat label="Outstanding" value={formatAED(outstanding)} hint={plural(open.length, 'open invoice')} />
        <Stat label="Overdue" value={formatAED(overdue)} tone={overdue ? 'danger' : undefined} />
      </StatGrid>

      <Section
        title="Ready to invoice"
        action={unbilled.size > 1 ? <Button title="Invoice all" size="sm" variant="gold" onPress={invoiceEveryone} loading={invoice.isPending} /> : undefined}>
        {charges.isLoading ? (
          <Loading />
        ) : unbilled.size === 0 ? (
          <Card>
            <Txt variant="muted">There is nothing waiting to be invoiced. Completed lessons appear here until they are invoiced.</Txt>
          </Card>
        ) : (
          [...unbilled.entries()].map(([familyId, e]) => (
            <Card key={familyId}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="h3">{lookup.family(familyId)?.name ?? 'Family'}</Txt>
                  <Txt variant="muted">
                    {e.count} item{e.count === 1 ? '' : 's'} · {formatAED(e.total)}
                  </Txt>
                </View>
                <Button title="Create invoice" size="sm" onPress={() => invoiceFamily(familyId)} loading={busyFamily === familyId} />
              </Row>
            </Card>
          ))
        )}
        <ErrorNote error={invoice.error} />
      </Section>

      <Section
        title="Invoices"
        action={<Button title="Sell package" icon="tag" size="sm" variant="secondary" onPress={() => router.push('/manage/package-new')} />}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'paid', label: 'Paid' },
            { value: 'all', label: 'All' },
          ]}
        />
        {invoices.isLoading ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState icon="card" title="No invoices here" message="Invoices you create for families will appear here." />
        ) : (
          shown.map((i) => <InvoiceCard key={i.id} invoice={i} familyName={lookup.family(i.familyId)?.name} />)
        )}
      </Section>
    </Screen>
  );
}
