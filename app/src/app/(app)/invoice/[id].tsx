import * as WebBrowser from 'expo-web-browser';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { INVOICE_STATUS } from '@/components/billing';
import { AutopayBadge, AutopayFailureNote, AutopayNotice, ChargeSavedCardButton } from '@/components/payments';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useInvoice, useLookup, useSettings } from '@/data/hooks';
import { useMe } from '@/data/session';
import { displayStatus, formatAED, invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { autopayHoldsInvoice, paymentLabel } from '@/domain/payments';
import type { PaymentMethod } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';
import { shareInvoice } from '@/lib/invoice-pdf';

export default function InvoicePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const me = useMe();
  const lookup = useLookup();
  const invoice = useInvoice(id);
  const settings = useSettings();
  const pay = useAction(source.startCardPayment);
  const setStatus = useAction(source.setInvoiceStatus);
  const [recording, setRecording] = useState(false);

  if (invoice.isLoading || !lookup.ready) return <Loading />;
  const inv = invoice.data;
  if (!inv) return <Screen><EmptyState title="Invoice not found" /></Screen>;

  const family = lookup.family(inv.familyId);
  const totals = invoiceTotals(inv);
  const status = displayStatus(inv);
  const s = INVOICE_STATUS[status];
  const payable = (inv.status === 'sent') && totals.balance > 0;
  // While autopay is about to charge (or is charging) the saved card, other ways to pay are not offered.
  const autopayHolds = payable && autopayHoldsInvoice(inv);

  async function payByCard() {
    const result = await pay.mutateAsync([inv!.id]);
    if (result.url) {
      await WebBrowser.openBrowserAsync(result.url);
      await invoice.refetch();
    } else if (result.paid) {
      notify('Payment received', 'Thank you. A receipt has been recorded on this invoice.');
    }
  }

  return (
    <Screen
      footer={
        payable && me.role === 'parent' && !autopayHolds ? (
          <Button title={`Pay ${formatAED(totals.balance)} by card`} icon="card" variant="gold" style={{ flex: 1 }} loading={pay.isPending} onPress={payByCard} />
        ) : undefined
      }>
      <Stack.Screen options={{ title: inv.number }} />
      <Card style={{ gap: Spacing.three }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{formatAED(totals.total)}</Txt>
            <Txt variant="muted">{family?.parentName ?? family?.name}</Txt>
          </View>
          <View style={{ alignItems: 'flex-end', gap: Spacing.one }}>
            <Badge label={s.label} tone={s.tone} />
            <AutopayBadge invoice={inv} />
          </View>
        </Row>
        <Row gap={Spacing.four}>
          <View>
            <Txt variant="label">Issued</Txt>
            <Txt>{formatDate(inv.issueDate)}</Txt>
          </View>
          <View>
            <Txt variant="label">Due</Txt>
            <Txt color={status === 'overdue' ? 'danger' : undefined}>{formatDate(inv.dueDate)}</Txt>
          </View>
          {totals.paid > 0 ? (
            <View>
              <Txt variant="label">Balance</Txt>
              <Txt>{formatAED(totals.balance)}</Txt>
            </View>
          ) : null}
        </Row>
      </Card>

      <Section title="Items">
        <Card style={{ gap: Spacing.two }}>
          {inv.items.map((item, i) => (
            <Row key={i} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
              <Txt style={{ flex: 1 }}>
                {item.quantity > 1 ? `${item.quantity} × ` : ''}
                {item.description}
              </Txt>
              <Txt style={{ fontVariant: ['tabular-nums'] }}>{formatAED(item.quantity * item.unitPrice)}</Txt>
            </Row>
          ))}
          <View style={{ height: 1, backgroundColor: theme.border }} />
          {inv.vatRate > 0 ? (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="muted">Subtotal</Txt>
                <Txt variant="muted">{formatAED(totals.subtotal)}</Txt>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="muted">VAT {Math.round(inv.vatRate * 100)}%</Txt>
                <Txt variant="muted">{formatAED(totals.vat)}</Txt>
              </Row>
            </>
          ) : null}
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="h3">Total</Txt>
            <Txt variant="h3">{formatAED(totals.total)}</Txt>
          </Row>
        </Card>
      </Section>

      {inv.payments.length ? (
        <Section title="Payments">
          {inv.payments.map((p) => (
            <Card key={p.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt>
                  {formatDate(p.paidAt)} · {paymentLabel(p)}
                </Txt>
                <Txt variant="h3" color="success">
                  {formatAED(p.amount)}
                </Txt>
              </Row>
            </Card>
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
      {me.role === 'admin' ? <AutopayFailureNote invoice={inv} /> : null}
      {payable && !autopayHolds && settings.data?.bankDetails ? (
        <Banner icon="money">Prefer bank transfer? {settings.data.bankDetails}. Please quote {inv.number}.</Banner>
      ) : null}
      <ErrorNote error={pay.error ?? setStatus.error} />

      <Button
        title="Share invoice (PDF)"
        icon="share"
        variant="secondary"
        onPress={() => shareInvoice(inv, family, settings.data)}
      />

      {me.role === 'admin' ? (
        <>
          <ChargeSavedCardButton invoice={inv} family={family} balance={totals.balance} />
          {payable ? (
            recording ? (
              <RecordPayment invoiceId={inv.id} balance={totals.balance} onDone={() => setRecording(false)} />
            ) : (
              <Button title="Record a payment" icon="money" onPress={() => setRecording(true)} />
            )
          ) : null}
          {inv.status === 'draft' ? <Button title="Send to family" onPress={() => setStatus.mutate([inv.id, 'sent'])} /> : null}
          {inv.status !== 'void' && totals.paid === 0 ? (
            <Button
              title="Void invoice"
              variant="danger"
              onPress={() =>
                confirm('Void this invoice?', 'Its lessons will return to “Ready to invoice” so that they can be billed again.', () =>
                  setStatus.mutate([inv.id, 'void']),
                )
              }
            />
          ) : null}
        </>
      ) : null}
    </Screen>
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
