import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { InvoiceCard, PackageCard } from '@/components/billing';
import { AutopayPanel, BuyLessons, SavedCardPanel } from '@/components/payments';
import { CreditNoteCard, RefundRow } from '@/components/tax';
import { Banner, EmptyState, Loading, Screen, Section, Stat, StatGrid } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useCharges, useCreditNotes, useFamilies, useInvoices, usePackageOffers, usePackages, useRefunds, useServices, useSettings } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe } from '@/data/session';
import { displayStatus, formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';

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
  const creditNotes = useCreditNotes();
  const refunds = useRefunds();
  // Read once: the thank-you stays for this visit, but the address is cleared so a reload does not show it again.
  const [toppedUp] = useState(() => topup === '1');

  // Back from Stripe Checkout after a top-up: the webhook may land a moment later, so look again once.
  useEffect(() => {
    if (!toppedUp) return;
    // Drop ?topup=1 from the address. The tab screen stays mounted, so the banner stays for this visit.
    router.replace('/parent/billing');
    void queryClient.invalidateQueries({ queryKey: ['packages'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['families'] });
  }, [toppedUp]);

  if (invoices.isLoading || packages.isLoading) return <Loading />;
  // Invoices voided before credit notes existed stay hidden; invoices cancelled with a credit note are shown as credited.
  const list = [...(invoices.data ?? [])]
    .filter((i) => i.status !== 'void' || displayStatus(i) === 'credited')
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const invoiceNumber = new Map((invoices.data ?? []).map((i) => [i.id, i.number]));
  const due = list.filter((i) => i.status === 'sent').reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const credits = (packages.data ?? []).reduce((n, p) => n + packageRemaining(p), 0);
  const pending = (charges.data ?? []).filter((c) => c.status === 'unbilled').reduce((s, c) => s + c.amount, 0);
  const family = (families.data ?? []).find((f) => f.id === me.familyId);

  return (
    <Screen
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        refunds.refetch();
      }}
      refreshing={invoices.isRefetching}>
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
      <Section title="Invoices">
        {list.length ? list.map((i) => <InvoiceCard key={i.id} invoice={i} />) : <EmptyState icon="card" title="No invoices yet" message="Your invoices will appear here as soon as they are issued." />}
      </Section>
      {creditNotes.data?.length ? (
        <Section title="Credit notes">
          {creditNotes.data.map((n) => (
            <CreditNoteCard key={n.id} note={n} />
          ))}
        </Section>
      ) : null}
      {refunds.data?.length ? (
        <Section title="Refunds">
          {refunds.data.map((r) => (
            <RefundRow
              key={r.id}
              refund={r}
              invoiceNumber={invoiceNumber.get(r.invoiceId)}
              onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: r.invoiceId } })}
            />
          ))}
        </Section>
      ) : null}
      {family ? (
        <Section title="Card and autopay">
          <View style={{ gap: Spacing.two }}>
            <SavedCardPanel family={family} />
            <AutopayPanel family={family} />
          </View>
        </Section>
      ) : null}
      {settings.data ? <BuyLessons offers={offers.data ?? []} services={services.data ?? []} vatRate={settings.data.vatRate} /> : null}
    </Screen>
  );
}
