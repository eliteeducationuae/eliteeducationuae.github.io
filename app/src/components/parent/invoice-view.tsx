import * as WebBrowser from 'expo-web-browser';
import { router, Stack } from 'expo-router';

import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice, useLookup, useRefunds, useSettings } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { displayStatus, invoiceTotals, type DisplayInvoiceStatus } from '@/domain/billing';
import { autopayFailureReason, autopayHoldsInvoice, autopayStatusText, paymentLabel } from '@/domain/payments';
import { invoiceCustomer, invoiceDocumentTitle, invoiceSupplier } from '@/domain/tax';
import { confirm } from '@/lib/confirm';
import { aed, shareInvoice } from '@/lib/invoice-pdf';

import { REFUND_STATUS, invoiceLineViews, vatPercent } from '../tax';
import { Actions, Button, Columns, EmptyState, ErrorNote, Group, GroupRow, Loading, Notice, PageHeader, Screen, Txt, useToast } from '../ui';
import { dayMonth } from './format';
import { openMessages } from './hooks';

const STATUS_WORDS: Record<DisplayInvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Due',
  'part-paid': 'Part paid',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
  credited: 'Credited',
};

/** An invoice as the family sees it: what it covers, the totals, how it was settled, and how to pay. */
export function ParentInvoice({ id }: { id: string }) {
  const viewing = useViewing();
  const toast = useToast();
  const lookup = useLookup();
  const invoice = useInvoice(id);
  const settings = useSettings();
  const creditNotes = useCreditNotes({ invoiceId: id });
  const refundList = useRefunds({ invoiceId: id });
  const pay = useAction(source.startCardPayment);

  const header = <Stack.Screen options={{ headerShown: false, title: 'Invoice' }} />;
  if (invoice.isLoading || !lookup.ready) return <Loading />;
  const inv = invoice.data;
  if (!inv) {
    return (
      <Screen topInset>
        {header}
        <PageHeader back={{ fallback: '/parent/billing' }} kicker="Billing" title="Invoice not found" />
        <EmptyState icon="receipt_long" title="Invoice not found" message="It may have been withdrawn. Your invoices are listed in Billing." />
      </Screen>
    );
  }

  const family = lookup.family(inv.familyId);
  const t = invoiceTotals(inv);
  const status = displayStatus(inv);
  const docTitle = invoiceDocumentTitle(inv, settings.data);
  const supplier = invoiceSupplier(inv, settings.data);
  const customer = invoiceCustomer(inv, family);
  const notes = creditNotes.data ?? [];
  const refunds = refundList.data ?? inv.refunds ?? [];
  const payable = inv.status === 'sent' && t.balance > 0;
  // While autopay is about to charge (or is charging) the saved card, other ways to pay are not offered.
  const autopayHolds = payable && autopayHoldsInvoice(inv);
  const lastPaid = [...inv.payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
  const bank = payable && !autopayHolds ? settings.data?.bankDetails : undefined;
  const vat = vatPercent(inv.vatRate);

  async function payNowInstead() {
    const result = await pay.mutateAsync([inv!.id]);
    if (result.url) {
      await WebBrowser.openBrowserAsync(result.url);
      await invoice.refetch();
    } else if (result.paid) toast('Thank you. Your payment has been received and recorded on the invoice.');
  }

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoice.refetch();
        creditNotes.refetch();
        refundList.refetch();
      }}
      refreshing={invoice.isRefetching}>
      {header}
      <PageHeader
        back={{ fallback: '/parent/billing' }}
        kicker={`${docTitle} · ${inv.autopayStatus && payable ? autopayStatusText(inv.autopayStatus) : STATUS_WORDS[status]}`}
        title={inv.number}
        sub={`Issued ${dayMonth(inv.issueDate)}, due ${dayMonth(inv.dueDate)}.`}
      />

      {status === 'paid' ? (
        <Notice tone="good" title={lastPaid ? `Paid on ${dayMonth(lastPaid.paidAt)}` : 'Paid'}>
          {inv.autopayStatus === 'succeeded' ? 'Paid automatically from your saved card. Thank you.' : 'Thank you. The payment is recorded below.'}
        </Notice>
      ) : status === 'credited' ? (
        <Notice tone="info" title="Cancelled with a credit note">
          There is nothing to pay on this invoice.
        </Notice>
      ) : payable && inv.autopayStatus === 'failed' ? (
        <Notice tone="warn" title="Autopay could not take this payment">
          {`Autopay could not take this payment: ${autopayFailureReason(inv.autopayError)}. Please pay by card below, or update your card under Manage cards in Billing.`}
        </Notice>
      ) : payable && inv.autopayStatus === 'pending' ? (
        <Notice tone="info" icon="autorenew">
          This invoice will be paid automatically from your saved card. There is nothing you need to do.
        </Notice>
      ) : payable && inv.autopayStatus === 'processing' ? (
        <Notice tone="info" icon="autorenew">
          Your saved card is being charged for this invoice. This usually takes a few moments.
        </Notice>
      ) : payable && inv.autopayStatus === 'unknown' ? (
        <Notice tone="info" icon="autorenew">
          We are confirming the payment from your saved card with the card processor. There is nothing you need to do, and you will not be charged twice; this invoice will update shortly.
        </Notice>
      ) : status === 'overdue' ? (
        <Notice
          tone="warn"
          title="Payment is overdue"
          link={viewing ? undefined : { label: 'I have paid by transfer', onPress: () => openMessages(`Hello, I paid ${inv.number} by bank transfer on `) }}>
          {`This invoice was due on ${dayMonth(inv.dueDate)}. If you have already paid by bank transfer, please let us know and we will match it.`}
        </Notice>
      ) : null}

      {t.balance < 0 ? (
        <Notice tone="info" icon="payments">
          {`You have paid ${aed(-t.balance)} more than this invoice now asks for. We will refund it to you.`}
        </Notice>
      ) : null}

      <Columns>
        <Group title="What it covers">
          {invoiceLineViews(inv).map((l, i) => (
            <GroupRow key={i} icon="school" title={l.description} note={l.quantity} value={aed(l.net)} valueTone="text" />
          ))}
        </Group>
        <Group title="Summary">
          <GroupRow title="Subtotal" titleWeight="regular" value={aed(t.subtotal)} valueTone="text" />
          <GroupRow title={`VAT at ${vat}`} titleWeight="regular" value={aed(t.vat)} valueTone="text" />
          <GroupRow title="Total" value={aed(t.total)} valueTone="text" valueSize={17} />
          {t.credited > 0 ? <GroupRow title="Credited" titleWeight="regular" value={`−${aed(t.credited)}`} valueTone="text" /> : null}
          {t.paid > 0 ? <GroupRow title="Paid" titleWeight="regular" value={`−${aed(t.paid)}`} valueTone="good" /> : null}
          {t.refunded > 0 ? <GroupRow title="Refunded" titleWeight="regular" value={aed(t.refunded)} valueTone="text" /> : null}
          <GroupRow
            title={t.balance < 0 ? 'In credit, to be refunded' : 'Balance due'}
            value={aed(Math.abs(t.balance))}
            valueTone={t.balance > 0 ? 'warn' : 'good'}
            valueSize={17}
          />
        </Group>

        {inv.payments.length ? (
          <Group title="Payments">
            {inv.payments.map((p) => (
              <GroupRow key={p.id} icon="check_circle" tone="good" title={`${dayMonth(p.paidAt)} · ${paymentLabel(p)}`} value={aed(p.amount)} valueTone="good" />
            ))}
          </Group>
        ) : null}

        {notes.length ? (
          <Group title="Credit notes">
            {notes.map((n) => (
              <GroupRow
                key={n.id}
                icon="assignment_return"
                title={`${n.number} · ${aed(n.total)}`}
                note={[`Issued ${dayMonth(n.issueDate)}`, n.reason].filter(Boolean).join(' · ')}
                onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
              />
            ))}
          </Group>
        ) : null}

        {refunds.length ? (
          <Group title="Refunds">
            {refunds.map((r) => (
              <GroupRow
                key={r.id}
                icon="payments"
                title={`${dayMonth(r.settledAt ?? r.createdAt)} · ${r.method === 'card' ? 'Card refund' : paymentLabel({ method: r.method, reference: r.reference })}`}
                note={r.status === 'failed' ? r.failureReason : r.status === 'pending' ? 'The refund is being processed by Stripe.' : r.reason}
                value={`${aed(r.amount)} · ${REFUND_STATUS[r.status].label}`}
                valueTone={r.status === 'succeeded' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}
              />
            ))}
          </Group>
        ) : null}

        {bank ? (
          <Group title="Pay by bank transfer">
            <GroupRow
              icon="account_balance"
              title="Show our bank details"
              note={`Please quote ${inv.number} as the reference.`}
              accessibilityHint="Shows the account details for a bank transfer"
              body={
                <Txt style={{ fontSize: 14.5, lineHeight: 22.5 }} selectable>
                  {bank}
                </Txt>
              }
            />
          </Group>
        ) : null}

        <Group title="From and to">
          {supplier ? (
            <GroupRow
              icon="school"
              title={supplier.name}
              note={[supplier.address, supplier.trn ? `TRN ${supplier.trn}` : ''].filter(Boolean).join(' · ') || undefined}
            />
          ) : null}
          {customer ? (
            <GroupRow
              icon="person"
              title={`Billed to ${customer.name}`}
              note={[customer.address, customer.trn ? `TRN ${customer.trn}` : ''].filter(Boolean).join(' · ') || undefined}
            />
          ) : null}
        </Group>
      </Columns>

      <ErrorNote error={pay.error} />
      <Actions>
        {payable && !autopayHolds && !viewing ? (
          <Button title={`Pay ${aed(t.balance)}`} icon="lock" onPress={() => router.push({ pathname: '/secure-pay', params: { invoiceId: inv.id } })} />
        ) : null}
        {payable && inv.autopayStatus === 'pending' && !viewing ? (
          <Button
            title="Pay now instead"
            variant="secondary"
            loading={pay.isPending}
            onPress={() =>
              confirm(
                'Pay now instead?',
                `You will pay ${aed(t.balance)} by card now, and autopay will not charge this invoice.`,
                () => void payNowInstead().catch(() => undefined),
                'Pay now',
              )
            }
          />
        ) : null}
        <Button
          title="Download PDF"
          icon="download"
          variant="secondary"
          // An invoice autopay is paying carries no bank transfer details, in the app or on its PDF.
          onPress={() => shareInvoice(inv, family, autopayHolds && settings.data ? { ...settings.data, bankDetails: undefined } : settings.data)}
        />
        {viewing ? null : <Button title="Ask about this invoice" icon="forum" variant="secondary" onPress={() => openMessages(`About ${inv.number}: `)} />}
      </Actions>
    </Screen>
  );
}
