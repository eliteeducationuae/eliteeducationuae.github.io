import { View } from 'react-native';

import { InvoiceCard, PackageCard } from '@/components/billing';
import { EmptyState, Loading, Screen, Section, Stat, StatGrid } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useCharges, useInvoices, usePackages } from '@/data/hooks';
import { formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';

export default function ParentBilling() {
  const invoices = useInvoices();
  const packages = usePackages();
  const charges = useCharges();
  if (invoices.isLoading || packages.isLoading) return <Loading />;
  const list = [...(invoices.data ?? [])].filter((i) => i.status !== 'void').sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const due = list.filter((i) => i.status === 'sent').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const credits = (packages.data ?? []).reduce((n, p) => n + packageRemaining(p), 0);
  const pending = (charges.data ?? []).filter((c) => c.status === 'unbilled').reduce((s, c) => s + c.amount, 0);

  return (
    <Screen onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <StatGrid>
        <Stat label="Due now" value={formatAED(due)} tone={due > 0 ? 'warning' : 'success'} />
        {credits ? <Stat label="Prepaid lessons" value={String(credits)} hint="remaining" /> : null}
        {pending ? <Stat label="Next invoice" value={formatAED(pending)} hint="lessons so far this month" /> : null}
      </StatGrid>
      {(packages.data ?? []).length ? (
        <Section title="Lesson packages">
          <View style={{ gap: Spacing.two }}>
            {(packages.data ?? []).map((p) => (
              <PackageCard key={p.id} pkg={p} />
            ))}
          </View>
        </Section>
      ) : null}
      <Section title="Invoices">
        {list.length ? list.map((i) => <InvoiceCard key={i.id} invoice={i} />) : <EmptyState icon="card" title="No invoices yet" message="Your invoices will appear here as soon as they are issued." />}
      </Section>
    </Screen>
  );
}
