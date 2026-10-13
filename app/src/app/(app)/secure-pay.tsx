import * as WebBrowser from 'expo-web-browser';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { dayMonth } from '@/components/parent/format';
import { lessonsCount, openAndRefresh } from '@/components/payments';
import { vatPercent } from '@/components/tax';
import { Actions, Button, EmptyState, ErrorNote, Group, GroupRow, Loading, Notice, PageHeader, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useInvoice, usePackageOffers, useServices, useSettings } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatAED, invoiceTotals } from '@/domain/billing';
import { activeOffers, autopayHoldsInvoice, offerPerLesson, offerTotal } from '@/domain/payments';

/**
 * Secure payment: what is being paid, then one button that opens Stripe Checkout. The app has no card fields; the
 * card (and Apple Pay or Google Pay, where the device offers them) is entered on Stripe's own page.
 * ?invoiceId=… pays an invoice; ?offerId=… buys a lesson package.
 */
export default function SecurePay() {
  const { invoiceId, offerId } = useLocalSearchParams<{ invoiceId?: string; offerId?: string }>();
  const me = useMe();
  const viewing = useViewing();
  const toast = useToast();
  const invoice = useInvoice(invoiceId);
  const offers = usePackageOffers();
  const services = useServices();
  const settings = useSettings();
  const payInvoice = useAction(source.startCardPayment);
  const buyOffer = useAction(source.buyPackageOffer);
  const [busy, setBusy] = useState(false);

  const header = <Stack.Screen options={{ headerShown: false, title: 'Secure payment' }} />;
  if ((invoiceId && invoice.isLoading) || (offerId && offers.isLoading) || !settings.data) return <Loading />;
  const inv = invoiceId ? invoice.data : undefined;
  const offer = offerId ? activeOffers(offers.data ?? []).find((o) => o.id === offerId) : undefined;
  const vatRate = settings.data.vatRate;
  const done = () => (router.canGoBack() ? router.back() : router.replace('/parent/billing'));

  if (me.role !== 'parent' || (!inv && !offer)) {
    return (
      <Screen topInset>
        {header}
        <PageHeader back={{ fallback: '/parent/billing' }} kicker="Secure payment" title="Nothing to pay here" />
        <EmptyState icon="credit_card" title="This payment is not available" message="It may already have been paid, or the package is no longer offered. Your invoices are in Billing." />
      </Screen>
    );
  }

  const balance = inv ? invoiceTotals(inv).balance : 0;
  const payable = inv ? inv.status === 'sent' && balance > 0 : true;
  // An invoice autopay is charging (or confirming) is not offered again; "pending" may be paid now instead.
  const held = inv ? autopayHoldsInvoice(inv) && inv.autopayStatus !== 'pending' : false;
  const amount = inv ? balance : offerTotal(offer!, vatRate);
  const service = offer?.serviceId ? (services.data ?? []).find((s) => s.id === offer.serviceId) : undefined;

  async function pay() {
    setBusy(true);
    try {
      if (inv) {
        const result = await payInvoice.mutateAsync([inv.id]);
        if (result.url) {
          await WebBrowser.openBrowserAsync(result.url);
          const fresh = await invoice.refetch();
          if (fresh.data && invoiceTotals(fresh.data).balance <= 0) {
            toast('Thank you. Your payment has been received and recorded on the invoice.');
            done();
          }
        } else if (result.paid) {
          toast('Thank you. Your payment has been received and recorded on the invoice.');
          done();
        }
      } else if (offer) {
        const result = await buyOffer.mutateAsync([offer.id]);
        if (result.url) await openAndRefresh(result.url);
        else if (result.paid) {
          toast(`Thank you. ${offer.name} (${lessonsCount(offer.lessons)}) has been added to your account.`);
          done();
        }
      }
    } catch {
      // Shown below by ErrorNote.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen topInset>
      {header}
      <PageHeader
        back={{ fallback: '/parent/billing' }}
        kicker="Secure payment"
        title={formatAED(amount)}
        sub={
          inv
            ? `${inv.number} · issued ${dayMonth(inv.issueDate)}, due ${dayMonth(inv.dueDate)}`
            : `${offer!.name} · ${lessonsCount(offer!.lessons)}${service ? ` of ${service.name}` : ''}`
        }
      />
      {inv && !payable ? (
        <Notice tone="good" title="Nothing to pay">
          This invoice has been paid. Thank you.
        </Notice>
      ) : held ? (
        <Notice tone="info" icon="autorenew">
          Your saved card is being charged for this invoice, so there is nothing to pay here. The invoice will update shortly.
        </Notice>
      ) : (
        <>
          <Group title="You are paying for">
            {inv ? (
              <GroupRow icon="receipt_long" title={inv.number} note="The balance of this invoice, including VAT" value={formatAED(balance)} valueTone="text" />
            ) : (
              <GroupRow
                icon="redeem"
                title={offer!.name}
                note={`${formatAED(offerPerLesson(offer!))} per lesson${vatRate > 0 ? ` before VAT · VAT at ${vatPercent(vatRate)} included in the total` : ''} · used before anything is invoiced`}
                value={formatAED(amount)}
                valueTone="text"
              />
            )}
          </Group>
          {inv?.autopayStatus === 'pending' ? (
            <Notice tone="info" icon="autorenew">
              If you pay now, autopay will not charge this invoice.
            </Notice>
          ) : null}
          <Notice tone="info" icon="lock">
            Payments are processed securely by Stripe. You enter your card on Stripe’s own page, where Apple Pay and Google Pay also appear on devices that offer them. Elite Education never sees your full card number, and Stripe keeps your card safely for next time.
          </Notice>
          <ErrorNote error={payInvoice.error ?? buyOffer.error} />
          {viewing ? null : (
            <Actions>
              <Button title={`Pay ${formatAED(amount)}`} icon="lock" loading={busy} onPress={pay} accessibilityLabel={`Pay ${formatAED(amount)} securely with Stripe`} />
              <Button title="Not now" variant="secondary" onPress={done} />
            </Actions>
          )}
        </>
      )}
    </Screen>
  );
}
