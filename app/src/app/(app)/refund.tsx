import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Ledger, SideCard, Split } from '@/components/money/blocks';
import { parseAmount } from '@/components/tax';
import { Button, ChipField, EmptyState, ErrorNote, Field, Loading, Notice, PageHeader, Screen, Toggle, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice, useLookup, useRefunds } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatDate } from '@/domain/dates';
import { paymentLabel } from '@/domain/payments';
import { creditRemaining, overpaid, refundableAmount, refundNeedsCreditNote } from '@/domain/tax';
import type { CreditNote, Invoice, Payment, Refund } from '@/domain/types';
import { confirm } from '@/lib/confirm';
import { uuid } from '@/lib/id';
import { aed } from '@/lib/invoice-pdf';

const head = <Stack.Screen options={{ headerShown: false }} />;

/** Admin: return money against a payment, by card through Stripe or recorded after a bank transfer or cash. */
export default function RefundScreen() {
  const { paymentId, invoiceId } = useLocalSearchParams<{ paymentId: string; invoiceId: string }>();
  const me = useMe();
  const invoice = useInvoice(invoiceId);
  const refunds = useRefunds({ invoiceId });
  const notes = useCreditNotes({ invoiceId });
  if (me.role !== 'admin') {
    return (
      <Screen topInset>
        {head}
        <PageHeader back kicker="Refund" title="Not available" />
        <EmptyState icon="alert" title="Not available" message="Only the office can refund payments." />
      </Screen>
    );
  }
  if (invoice.isLoading || refunds.isLoading || notes.isLoading) {
    return (
      <Screen topInset>
        {head}
        <Loading />
      </Screen>
    );
  }
  const payment = invoice.data?.payments.find((p) => p.id === paymentId);
  if (!invoice.data || !payment) {
    return (
      <Screen topInset>
        {head}
        <PageHeader back kicker="Refund" title="Payment not found" />
        <EmptyState title="Payment not found" />
      </Screen>
    );
  }
  return <RefundForm invoice={invoice.data} payment={payment} refunds={refunds.data ?? []} notes={notes.data ?? []} />;
}

function RefundForm({ invoice, payment, refunds, notes }: { invoice: Invoice; payment: Payment; refunds: Refund[]; notes: CreditNote[] }) {
  const toast = useToast();
  const lookup = useLookup();
  const refund = useAction(source.refundPayment);
  const inv = { ...invoice, refunds: invoice.refunds ?? refunds };
  const refundable = refundableAmount(payment, refunds);
  const over = overpaid(inv);
  const creditLeft = creditRemaining(invoice, notes).gross;
  const [amount, setAmount] = useState(() => (over > 0 ? Math.min(refundable, over).toFixed(2) : ''));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<'bank-transfer' | 'cash'>(payment.method === 'cash' ? 'cash' : 'bank-transfer');
  const [withCredit, setWithCredit] = useState(over <= 0 && creditLeft > 0);
  // One key per refund attempt, so a double tap or a retry never refunds twice.
  const [requestKey, setRequestKey] = useState(() => uuid());
  const [failed, setFailed] = useState<string | null>(null);

  const family = lookup.family(invoice.familyId);
  const value = parseAmount(amount);
  const card = !!payment.viaStripe;
  // Refunding more than the family overpaid lowers the price of the invoice, so a credit note must go with it.
  const forced = !Number.isNaN(value) && refundNeedsCreditNote(inv, value) && value > over;
  const credit = forced || withCredit;
  const tooMuch = !Number.isNaN(value) && value > refundable;
  const ready = !Number.isNaN(value) && value > 0 && !tooMuch && !!reason.trim() && !(credit && creditLeft <= 0);

  async function submit() {
    setFailed(null);
    const result = await refund.mutateAsync([
      {
        paymentId: payment.id,
        amount: value,
        reason: reason.trim(),
        reference: card || method === 'cash' ? undefined : reference.trim() || undefined,
        ...(card ? {} : { method }),
        withCreditNote: credit,
        requestKey,
      },
    ]);
    if (result.status === 'failed') {
      setFailed(result.failureReason ?? 'The refund could not be made.');
      // A fresh attempt needs a fresh key; the failed one is kept on record.
      setRequestKey(uuid());
      return;
    }
    router.back();
    if (result.status === 'pending') toast(`Refund of ${aed(result.amount)} requested through Stripe.`);
    else toast(`Refund of ${aed(result.amount)} recorded${credit ? ' with a credit note' : ''}.`);
  }

  function confirmRefund() {
    confirm(
      `Refund ${aed(value)}?`,
      [
        card
          ? `${aed(value)} will be returned to the card used for this payment.`
          : `This records a refund of ${aed(value)} made by ${method === 'cash' ? 'cash' : 'bank transfer'}.`,
        credit ? `A credit note for ${aed(value)} will be issued against ${invoice.number}.` : 'No credit note will be issued.',
        'This cannot be undone.',
      ].join(' '),
      () => void submit().catch(() => undefined),
      'Refund',
    );
  }

  return (
    <Screen topInset>
      {head}
      <PageHeader back kicker={`Refund · ${invoice.number}`} title="Refund a payment" sub={family ? `${family.name} family` : undefined} />
      <Split>
        <View style={{ gap: 20 }}>
          <Notice tone="info" icon={card ? 'credit_card' : 'payments'}>
            {card
              ? 'The money goes back to the same card through Stripe. It usually arrives within 5 to 10 working days.'
              : 'Record a refund you have already made by bank transfer or cash.'}
          </Notice>
          <Field
            label="Amount to refund (AED)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={tooMuch ? `Only ${aed(refundable)} of this payment can be refunded.` : undefined}
            hint={tooMuch ? undefined : `Up to ${aed(refundable)}.`}
          />
          <Field
            label="Reason"
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="For example, package cancelled at the family’s request."
            hint={reason.trim() ? 'Printed on the refund record.' : 'Required.'}
          />
          {!card ? (
            <>
              <ChipField
                label="Refunded by"
                options={[
                  { value: 'bank-transfer', label: 'Bank transfer' },
                  { value: 'cash', label: 'Cash' },
                ]}
                value={method}
                onChange={setMethod}
              />
              {method === 'bank-transfer' ? <Field label="Bank transfer reference" value={reference} onChangeText={setReference} hint="Optional." /> : null}
            </>
          ) : null}
          <View style={{ gap: 6 }}>
            <Toggle title="Also issue a credit note" value={credit} onValueChange={setWithCredit} disabled={forced || creditLeft <= 0} />
            <Txt variant="note">
              {forced
                ? 'This refund is more than the family overpaid, so it lowers the price of the invoice. A credit note must be issued with it.'
                : creditLeft <= 0
                  ? 'Nothing is left to credit on this invoice.'
                  : over > 0
                    ? 'Not needed when you are only returning an overpayment.'
                    : 'Issue one when the refund lowers what the family is charged.'}
            </Txt>
          </View>
          {credit && creditLeft <= 0 ? (
            <Notice tone="warn">Nothing is left to credit on this invoice, so this refund cannot carry a credit note.</Notice>
          ) : null}
        </View>

        <SideCard label={`Payment on ${invoice.number}`}>
          <Txt variant="groupTitle" style={{ fontSize: 19 }}>
            {`${formatDate(payment.paidAt)} · ${paymentLabel(payment)}`}
          </Txt>
          <Ledger
            lines={[
              { label: 'Amount paid', value: aed(payment.amount) },
              { label: 'Already refunded', value: aed(payment.amount - refundable) },
              ...(over > 0 ? [{ label: 'Paid beyond what the invoice asks', value: aed(over) }] : []),
              { label: 'Can be refunded', value: aed(refundable), strong: true },
            ]}
          />
          {failed ? <Notice tone="danger">{failed}</Notice> : null}
          <ErrorNote error={refund.error} />
          <Button
            title={!Number.isNaN(value) && value > 0 ? `Refund ${aed(value)}` : 'Refund'}
            icon="undo"
            disabled={!ready}
            loading={refund.isPending}
            onPress={confirmRefund}
          />
        </SideCard>
      </Split>
    </Screen>
  );
}
