import * as WebBrowser from 'expo-web-browser';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { INVOICE_STATUS } from '@/components/billing';
import {
  AUTOPAY_MAY_HAVE_CHARGED,
  AutopayBadge,
  AutopayFailureNote,
  AutopayNotice,
  autopayMayHaveCharged,
  ChargeSavedCardButton,
} from '@/components/payments';
import { AmountLine, balanceLine, CreditNoteCard, invoiceLineViews, LineTaxTable, RefundRow, Rule, TaxPartyBlock, vatPercent } from '@/components/tax';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice, useLookup, useRefunds, useSettings } from '@/data/hooks';
import { useMe } from '@/data/session';
import { displayStatus, formatAED, invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { autopayHoldsInvoice, paymentLabel } from '@/domain/payments';
import { creditRemaining, invoiceCustomer, invoiceDocumentTitle, invoiceSupplier, refundableAmount } from '@/domain/tax';
import type { PaymentMethod } from '@/domain/types';
import { confirm, notify } from '@/lib/confirm';
import { aed, shareInvoice } from '@/lib/invoice-pdf';

export default function InvoicePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const lookup = useLookup();
  const invoice = useInvoice(id);
  const settings = useSettings();
  const creditNotes = useCreditNotes({ invoiceId: id });
  const refundList = useRefunds({ invoiceId: id });
  const pay = useAction(source.startCardPayment);
  const setStatus = useAction(source.setInvoiceStatus);
  const [recording, setRecording] = useState(false);

  if (invoice.isLoading || !lookup.ready) return <Loading />;
  const inv = invoice.data;
  if (!inv) return <Screen><EmptyState title="Invoice not found" /></Screen>;

  const isAdmin = me.role === 'admin';
  const family = lookup.family(inv.familyId);
  const totals = invoiceTotals(inv);
  const status = displayStatus(inv);
  const s = INVOICE_STATUS[status];
  const title = invoiceDocumentTitle(inv, settings.data);
  const supplier = invoiceSupplier(inv, settings.data);
  const customer = invoiceCustomer(inv, family);
  const notes = creditNotes.data ?? [];
  const refunds = refundList.data ?? inv.refunds ?? [];
  const issued = inv.status === 'sent' || inv.status === 'paid';
  const canCredit = issued && creditRemaining(inv, notes).gross > 0;
  const payable = inv.status === 'sent' && totals.balance > 0;
  // Admin: recording or cancelling now could leave the family charged twice, so they are asked to check Stripe first.
  const mayHaveCharged = autopayMayHaveCharged(inv);
  // While autopay is about to charge (or is charging) the saved card, other ways to pay are not offered.
  const autopayHolds = payable && autopayHoldsInvoice(inv);
  const balance = balanceLine(totals.balance);
  const showSettlement = totals.credited > 0 || totals.paid > 0 || totals.refunded > 0;

  async function payByCard() {
    const result = await pay.mutateAsync([inv!.id]);
    if (result.url) {
      await WebBrowser.openBrowserAsync(result.url);
      await invoice.refetch();
    } else if (result.paid) {
      notify('Payment received', 'Thank you. A receipt has been recorded on this invoice.');
    }
  }

  function cancelInvoice() {
    const paidNote = totals.paid > 0 ? ' Payments already received will then show as credit to be refunded.' : '';
    confirm(
      'Cancel this invoice?',
      'This issues a credit note for the full remaining amount. Any lessons on it can then be invoiced again.' +
        paidNote +
        (mayHaveCharged ? ` ${AUTOPAY_MAY_HAVE_CHARGED}` : ''),
      () => setStatus.mutate([inv!.id, 'void']),
      'Cancel invoice',
    );
  }

  return (
    <Screen
      onRefresh={() => {
        invoice.refetch();
        creditNotes.refetch();
        refundList.refetch();
      }}
      refreshing={invoice.isRefetching}
      footer={
        payable && me.role === 'parent' && !autopayHolds ? (
          <Button title={`Pay ${formatAED(totals.balance)} by card`} icon="card" variant="gold" style={{ flex: 1 }} loading={pay.isPending} onPress={payByCard} />
        ) : undefined
      }>
      <Stack.Screen options={{ title }} />
      <Card style={{ gap: Spacing.three }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label">{title}</Txt>
            <Txt variant="h2">{inv.number}</Txt>
            <Txt variant="muted">{family?.name ?? customer?.name}</Txt>
          </View>
          <View style={{ alignItems: 'flex-end', gap: Spacing.one }}>
            <Txt variant="h3">{aed(totals.total)}</Txt>
            <Badge label={s.label} tone={s.tone} />
            <AutopayBadge invoice={inv} />
          </View>
        </Row>
        <Row gap={Spacing.four} wrap style={{ alignItems: 'flex-start' }}>
          <KeyDate label="Date of issue" value={formatDate(inv.issueDate)} />
          <KeyDate label="Date of supply" value={formatDate(inv.supplyDate ?? inv.issueDate)} />
          <KeyDate label="Due" value={formatDate(inv.dueDate)} danger={status === 'overdue'} />
        </Row>
      </Card>

      <Card style={{ gap: Spacing.three }}>
        <Row gap={Spacing.four} wrap style={{ alignItems: 'flex-start' }}>
          <TaxPartyBlock label="Supplier" party={supplier} />
          <TaxPartyBlock label="Customer" party={customer} />
        </Row>
      </Card>

      <Section title="Lines">
        <Card style={{ gap: Spacing.three }}>
          <LineTaxTable lines={invoiceLineViews(inv)} />
          <View style={{ gap: Spacing.one }}>
            <AmountLine label="Total excluding VAT" value={aed(totals.subtotal)} />
            <AmountLine label={`VAT at ${vatPercent(inv.vatRate)}`} value={aed(totals.vat)} />
            <AmountLine label="Total including VAT" value={aed(totals.total)} strong />
          </View>
          {showSettlement ? (
            <>
              <Rule />
              <View style={{ gap: Spacing.one }}>
                {totals.credited > 0 ? <AmountLine label="Credited" value={`−${aed(totals.credited)}`} /> : null}
                {totals.paid > 0 ? <AmountLine label="Paid" value={`−${aed(totals.paid)}`} /> : null}
                {totals.refunded > 0 ? <AmountLine label="Refunded" value={aed(totals.refunded)} /> : null}
                <AmountLine label={balance.label} value={balance.value} strong tone={totals.balance < 0 ? 'warning' : undefined} />
              </View>
            </>
          ) : null}
        </Card>
      </Section>

      {inv.payments.length ? (
        <Section title="Payments">
          {inv.payments.map((p) => {
            const refundable = refundableAmount(p, refunds);
            const refundedHere = Math.max(0, p.amount - refundable);
            return (
              <Card key={p.id} style={{ gap: Spacing.two }}>
                <Row style={{ justifyContent: 'space-between' }} gap={Spacing.three}>
                  <Txt style={{ flex: 1 }}>
                    {formatDate(p.paidAt)} · {paymentLabel(p)}
                  </Txt>
                  <Txt variant="h3" color="success">
                    {aed(p.amount)}
                  </Txt>
                </Row>
                {refundedHere > 0 ? <Txt variant="small">{aed(refundedHere)} of this payment has been refunded or is being refunded.</Txt> : null}
                {isAdmin && inv.status !== 'draft' && refundable > 0 ? (
                  <Button
                    title="Refund"
                    icon="repeat"
                    size="sm"
                    variant="outline"
                    style={{ alignSelf: 'flex-start' }}
                    onPress={() => router.push({ pathname: '/refund', params: { paymentId: p.id, invoiceId: inv.id } })}
                  />
                ) : null}
              </Card>
            );
          })}
        </Section>
      ) : null}

      {notes.length ? (
        <Section title="Credit notes">
          {notes.map((n) => (
            <CreditNoteCard key={n.id} note={n} />
          ))}
        </Section>
      ) : null}

      {refunds.length ? (
        <Section title="Refunds">
          {refunds.map((r) => (
            <RefundRow key={r.id} refund={r} />
          ))}
        </Section>
      ) : null}

      {me.role === 'parent' ? <AutopayNotice invoice={inv} payable={payable} /> : null}
      {me.role === 'parent' && payable && inv.autopayStatus === 'pending' ? (
        <Button
          title="Pay now instead"
          variant="ghost"
          size="sm"
          style={{ alignSelf: 'flex-start' }}
          loading={pay.isPending}
          onPress={() =>
            confirm(
              'Pay now instead?',
              `You will pay ${formatAED(totals.balance)} by card now, and autopay will not charge this invoice.`,
              () => void payByCard().catch(() => undefined),
              'Pay now',
            )
          }
        />
      ) : null}
      {isAdmin ? <AutopayFailureNote invoice={inv} /> : null}
      {payable && !autopayHolds && settings.data?.bankDetails && me.role !== 'accountant' ? (
        <Banner icon="money">Prefer bank transfer? {settings.data.bankDetails}. Please quote {inv.number}.</Banner>
      ) : null}
      {totals.balance < 0 && me.role === 'parent' ? (
        <Banner icon="money">You have paid {aed(-totals.balance)} more than this invoice now asks for. We will refund it to you.</Banner>
      ) : null}
      <ErrorNote error={pay.error ?? setStatus.error} />

      <Button
        title="Download PDF"
        icon="share"
        variant="secondary"
        // An invoice autopay is paying carries no bank transfer details, in the app or on its PDF.
        onPress={() => shareInvoice(inv, family, autopayHolds && settings.data ? { ...settings.data, bankDetails: undefined } : settings.data)}
      />

      {isAdmin ? (
        <>
          <ChargeSavedCardButton invoice={inv} family={family} balance={totals.balance} />
          {payable ? (
            recording ? (
              <RecordPayment invoiceId={inv.id} balance={totals.balance} onDone={() => setRecording(false)} />
            ) : (
              <Button
                title="Record a payment"
                icon="money"
                onPress={() =>
                  mayHaveCharged ? confirm('Record a payment?', AUTOPAY_MAY_HAVE_CHARGED, () => setRecording(true)) : setRecording(true)
                }
              />
            )
          ) : null}
          {inv.status === 'draft' ? <Button title="Send to family" onPress={() => setStatus.mutate([inv.id, 'sent'])} /> : null}
          {canCredit ? (
            <Button
              title="Issue credit note"
              icon="doc"
              variant="outline"
              onPress={() => router.push({ pathname: '/credit-note/new', params: { invoiceId: inv.id } })}
            />
          ) : null}
          {inv.status === 'draft' ? (
            <Button
              title="Void draft"
              variant="danger"
              onPress={() =>
                confirm(
                  'Void this draft?',
                  'Its lessons will return to “Ready to invoice” so that they can be billed again.' + (mayHaveCharged ? ` ${AUTOPAY_MAY_HAVE_CHARGED}` : ''),
                  () => setStatus.mutate([inv.id, 'void']),
                )
              }
            />
          ) : null}
          {canCredit ? <Button title="Cancel invoice" variant="danger" loading={setStatus.isPending} onPress={cancelInvoice} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

function KeyDate({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View>
      <Txt variant="label">{label}</Txt>
      <Txt color={danger ? 'danger' : undefined}>{value}</Txt>
    </View>
  );
}

function RecordPayment({ invoiceId, balance, onDone }: { invoiceId: string; balance: number; onDone: () => void }) {
  const record = useAction(source.recordPayment);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>('bank-transfer');
  const [reference, setReference] = useState('');
  const value = Number(amount);
  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Record a payment</Txt>
      <Field label="Amount (AED)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Row gap={Spacing.one} wrap>
        {(['bank-transfer', 'cash', 'card'] as const).map((m) => (
          <Chip key={m} label={m.replace('-', ' ')} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </Row>
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} />
      <ErrorNote error={record.error} />
      <Row gap={Spacing.two}>
        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onDone} />
        <Button
          title="Save payment"
          style={{ flex: 1 }}
          disabled={!(value > 0)}
          loading={record.isPending}
          onPress={async () => {
            await record.mutateAsync([invoiceId, value, method, reference.trim() || undefined]);
            onDone();
          }}
        />
      </Row>
    </Card>
  );
}
