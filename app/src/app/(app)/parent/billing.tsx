import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { InvoiceCard, PackageCard } from '@/components/billing';
import { AutopayPanel, BuyLessons, SavedCardPanel } from '@/components/payments';
import { Banner, EmptyState, Loading, Screen, Section, Stat, StatGrid } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useCharges, useFamilies, useInvoices, usePackageOffers, usePackages, useServices, useSettings } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe } from '@/data/session';
import { formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';

export default function ParentBilling() {
  const me = useMe();
  const { topup } = useLocalSearchParams<{ topup?: string }>();
  const invoices = useInvoices();
  const packages = usePackages();
  const charges = useCharges();
  const families = useFamilies();
  const offers = usePackageOffers();
  const services = useServices();
  const settings = useSettings();
  const toppedUp = topup === '1';

  // Back from Stripe Checkout after a top-up: the webhook may land a moment later, so look again once.
  useEffect(() => {
    if (!toppedUp) return;
    void queryClient.invalidateQueries({ queryKey: ['packages'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['families'] });
  }, [toppedUp]);

  if (invoices.isLoading || packages.isLoading) return <Loading />;
  const list = [...(invoices.data ?? [])].filter((i) => i.status !== 'void').sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const due = list.filter((i) => i.status === 'sent').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const credits = (packages.data ?? []).reduce((n, p) => n + packageRemaining(p), 0);
  const pending = (charges.data ?? []).filter((c) => c.status === 'unbilled').reduce((s, c) => s + c.amount, 0);
  const family = (families.data ?? []).find((f) => f.id === me.familyId);

  return (
    <Screen onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      {toppedUp ? <Banner tone="success" icon="check">Thank you. Your new lessons will appear here in a moment.</Banner> : null}
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
      {settings.data ? <BuyLessons offers={offers.data ?? []} services={services.data ?? []} vatRate={settings.data.vatRate} /> : null}
      {family ? (
        <Section title="Card and autopay">
          <View style={{ gap: Spacing.two }}>
            <SavedCardPanel family={family} />
            <AutopayPanel family={family} />
          </View>
        </Section>
      ) : null}
      <Section title="Invoices">
        {list.length ? list.map((i) => <InvoiceCard key={i.id} invoice={i} />) : <EmptyState icon="card" title="No invoices yet" message="Your invoices will appear here as soon as they are issued." />}
      </Section>
    </Screen>
  );
}
