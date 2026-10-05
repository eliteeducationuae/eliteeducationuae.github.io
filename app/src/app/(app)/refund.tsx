import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AmountLine, parseAmount, SwitchRow } from '@/components/tax';
import { Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice, useRefunds } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatDate } from '@/domain/dates';
import { paymentLabel } from '@/domain/payments';
import { creditRemaining, overpaid, refundableAmount, refundNeedsCreditNote } from '@/domain/tax';
import type { CreditNote, Invoice, Payment, Refund } from '@/domain/types';
import { confirm, notify } from '@/lib/confirm';
import { uuid } from '@/lib/id';
import { aed } from '@/lib/invoice-pdf';

/** Admin: return money against a payment, by card through Stripe or recorded after a bank transfer or cash. */
export default function RefundScreen() {
  const { paymentId, invoiceId } = useLocalSearchParams<{ paymentId: string; invoiceId: string }>();
  const me = useMe();
  const invoice = useInvoice(invoiceId);
  const refunds = useRefunds({ invoiceId });
  const notes = useCreditNotes({ invoiceId });
  if (me.role !== 'admin') {
    return (
      <Screen>
        <EmptyState icon="alert" title="Not available" message="Only the office can refund payments." />
      </Screen>
    );
  }
  if (invoice.isLoading || refunds.isLoading || notes.isLoading) return <Loading />;
  const payment = invoice.data?.payments.find((p) => p.id === paymentId);
  if (!invoice.data || !payment) {
    return (
      <Screen>
        <EmptyState title="Payment not found" />
      </Screen>
    );
  }
  return <RefundForm invoice={invoice.data} payment={payment} refunds={refunds.data ?? []} notes={notes.data ?? []} />;
}

function RefundForm({ invoice, payment, refunds, notes }: { invoice: Invoice; payment: Payment; refunds: Refund[]; notes: CreditNote[] }) {
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

  const value = parseAmount(amount);
  const card = !!payment.viaStripe;
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
    if (result.status === 'pending') notify('Refund requested', 'The refund is being processed by Stripe.');
    else notify('Refund recorded', `${aed(result.amount)} has been refunded.`);
    router.back();
  }

  return (
    <Screen
      footer={
        <Button
          title={!Number.isNaN(value) && value > 0 ? `Refund ${aed(value)}` : 'Refund'}
          variant="gold"
          icon="repeat"
          style={{ flex: 1 }}
          disabled={!ready}
          loading={refund.isPending}
          onPress={() =>
            confirm(
              `Refund ${aed(value)}?`,
              [
                card
                  ? `${aed(value)} will be returned to the card used for this payment.`
                  : `This records a refund of ${aed(value)} made by ${method === 'cash' ? 'cash' : 'bank transfer'}.`,
                credit
                  ? `A credit note for ${aed(value)} will be issued against ${invoice.number}.`
                  : 'No credit note will be issued.',
                'This cannot be undone.',
              ].join(' '),
              () => void submit().catch(() => undefined),
              'Refund',
            )
          }
        />
      }>
      <Card style={{ gap: Spacing.one }}>
        <Txt variant="label">Payment on {invoice.number}</Txt>
        <Txt variant="h3">
          {formatDate(payment.paidAt)} · {paymentLabel(payment)}
        </Txt>
        <AmountLine label="Amount paid" value={aed(payment.amount)} />
        <AmountLine label="Already refunded" value={aed(payment.amount - refundable)} />
        <AmountLine label="Can be refunded" value={aed(refundable)} strong />
        {over > 0 ? <AmountLine label="Paid beyond what the invoice asks" value={aed(over)} /> : null}
      </Card>

      <Banner icon={card ? 'card' : 'money'}>
        {card
          ? 'The money goes back to the same card. It usually arrives within 5 to 10 working days.'
          : 'Record a refund you have already made by bank transfer or cash.'}
      </Banner>

      <Field
        label="Amount to refund (AED)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={tooMuch ? `Only ${aed(refundable)} of this payment can be refunded.` : `Up to ${aed(refundable)}.`}
      />
      <Field label="Reason" value={reason} onChangeText={setReason} multiline placeholder="For example: package cancelled at the family's request." hint="Required." />
      {!card ? (
        <Section title="Refunded by">
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'bank-transfer', label: 'Bank transfer' },
              { value: 'cash', label: 'Cash' },
            ]}
          />
          {method === 'bank-transfer' ? (
            <Field label="Bank transfer reference" value={reference} onChangeText={setReference} hint="Optional." />
          ) : null}
        </Section>
      ) : null}

      <SwitchRow
        label="Also issue a credit note"
        value={credit}
        onChange={setWithCredit}
        disabled={forced || creditLeft <= 0}
        hint={
          forced
            ? 'This refund is more than the family overpaid, so it lowers the price of the invoice. A credit note must be issued with it.'
            : creditLeft <= 0
              ? 'Nothing is left to credit on this invoice.'
              : over > 0
                ? 'Not needed when you are only returning an overpayment.'
                : 'Issue one when the refund reduces what the family is charged.'
        }
      />
      {credit && creditLeft <= 0 ? <Banner tone="warning" icon="alert">Nothing is left to credit on this invoice, so this refund cannot carry a credit note.</Banner> : null}
      {failed ? <Banner tone="danger" icon="alert">{failed}</Banner> : null}
      <ErrorNote error={refund.error} />
    </Screen>
  );
}
