import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { INVOICE_STATUS } from '@/components/billing';
import { HistorySection } from '@/components/history';
import { Logo } from '@/components/logo';
import { AUTOPAY_MAY_HAVE_CHARGED, AutopayBadge, AutopayFailureNote, autopayMayHaveCharged, ChargeSavedCardButton } from '@/components/payments';
import { AmountLine, balanceLine, creditNoteKind, invoiceLineViews, LineTaxTable, REFUND_STATUS, TaxPartyBlock, vatPercent } from '@/components/tax';
import {
  Actions,
  Badge,
  Button,
  ChipField,
  EmptyState,
  ErrorNote,
  Field,
  Group,
  GroupRow,
  Loading,
  Notice,
  PageHeader,
  Screen,
  Txt,
  useToast,
  useWide,
  type Tone,
} from '@/components/ui';
import { font } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice, useLookup, useRefunds, useSettings } from '@/data/hooks';
import { displayStatus, invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { autopayHoldsInvoice, paymentLabel } from '@/domain/payments';
import { creditRemaining, invoiceCustomer, invoiceDocumentTitle, invoiceSupplier, refundableAmount } from '@/domain/tax';
import type { Payment, PaymentMethod } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { aed, shareInvoice } from '@/lib/invoice-pdf';

import { ActionList, SideCard, Split, StatusDot, type ActionItem } from './blocks';
import { shortDate } from './format';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank-transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
];

/** The office's view of an invoice: the tax document on the left, payments and actions beside it. */
export function AdminInvoice({ id }: { id: string }) {
  const theme = useTheme();
  const wide = useWide();
  const toast = useToast();
  const lookup = useLookup();
  const invoice = useInvoice(id);
  const settings = useSettings();
  const creditNotes = useCreditNotes({ invoiceId: id });
  const refundList = useRefunds({ invoiceId: id });
  const setStatus = useAction(source.setInvoiceStatus);
  const [recording, setRecording] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const head = <Stack.Screen options={{ headerShown: false }} />;
  if (invoice.isLoading || !lookup.ready) {
    return (
      <Screen topInset>
        {head}
        <Loading />
      </Screen>
    );
  }
  const inv = invoice.data;
  if (!inv) {
    return (
      <Screen topInset>
        {head}
        <PageHeader back={{ fallback: '/admin/billing' }} kicker="Invoice" title="Invoice not found" />
        <EmptyState title="Invoice not found" message="It may have been removed, or the link is incomplete." />
      </Screen>
    );
  }

  const family = lookup.family(inv.familyId);
  const totals = invoiceTotals(inv);
  const status = displayStatus(inv);
  const s = INVOICE_STATUS[status];
  const toneColor: Partial<Record<Tone, string>> = { danger: theme.danger, success: theme.success, warning: theme.warning, info: theme.text };
  const statusColor = toneColor[s.tone] ?? theme.textMuted;
  const title = invoiceDocumentTitle(inv, settings.data);
  const supplier = invoiceSupplier(inv, settings.data);
  const customer = invoiceCustomer(inv, family);
  const notes = creditNotes.data ?? [];
  const refunds = refundList.data ?? inv.refunds ?? [];
  const issued = inv.status === 'sent' || inv.status === 'paid';
  const canCredit = issued && creditRemaining(inv, notes).gross > 0;
  const payable = inv.status === 'sent' && totals.balance > 0;
  // Recording or cancelling now could leave the family charged twice, so the office is asked to check Stripe first.
  const mayHaveCharged = autopayMayHaveCharged(inv);
  const autopayHolds = payable && autopayHoldsInvoice(inv);
  const balance = balanceLine(totals.balance);
  const showSettlement = totals.credited > 0 || totals.paid > 0 || totals.refunded > 0;
  const who = family ? `${family.name} family` : (customer?.name ?? '');

  function startRecording() {
    if (mayHaveCharged) confirm('Record a payment?', AUTOPAY_MAY_HAVE_CHARGED, () => setRecording(true));
    else setRecording(true);
  }

  async function cancelInvoice() {
    await setStatus.mutateAsync([inv!.id, 'void']);
    setConfirmCancel(false);
    toast(`${inv!.number} cancelled with a credit note.`);
  }

  const actions: ActionItem[] = [
    {
      icon: 'download',
      label: 'Download PDF',
      // An invoice autopay is paying carries no bank transfer details, in the app or on its PDF.
      onPress: () => shareInvoice(inv, family, autopayHolds && settings.data ? { ...settings.data, bankDetails: undefined } : settings.data),
    },
    ...(canCredit
      ? [
          {
            icon: 'receipt_long' as const,
            label: 'Issue a credit note',
            onPress: () => router.push({ pathname: '/credit-note/new', params: { invoiceId: inv.id } }),
          },
        ]
      : []),
    ...(inv.status === 'draft'
      ? [
          {
            icon: 'block' as const,
            label: 'Void draft',
            danger: true,
            onPress: () =>
              confirm(
                'Void this draft?',
                'Its lessons will return to “Ready to invoice” so that they can be billed again.' + (mayHaveCharged ? ` ${AUTOPAY_MAY_HAVE_CHARGED}` : ''),
                () => setStatus.mutate([inv.id, 'void']),
                'Void draft',
              ),
          },
        ]
      : []),
    ...(canCredit ? [{ icon: 'block' as const, label: 'Cancel this invoice', danger: true, onPress: () => setConfirmCancel(true) }] : []),
  ];

  const document = (
    <View style={{ gap: 20 }}>
      <View style={{ borderRadius: 20, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surface, padding: wide ? 32 : 20, gap: 22 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <Logo wide width={124} />
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Text style={[font('serif'), { fontSize: 28, lineHeight: 32, color: theme.text, fontVariant: ['tabular-nums'] }]}>{aed(totals.total)}</Text>
            <StatusDot label={s.label} color={statusColor} />
            <AutopayBadge invoice={inv} />
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 14,
            paddingVertical: 16,
            borderTopWidth: 1,
            borderTopColor: theme.text,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}>
          <KeyDate label="Date of issue" value={formatDate(inv.issueDate)} />
          <KeyDate label="Date of supply" value={formatDate(inv.supplyDate ?? inv.issueDate)} />
          <KeyDate label="Due" value={formatDate(inv.dueDate)} danger={status === 'overdue'} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <TaxPartyBlock label="Supplier" party={supplier} />
          <TaxPartyBlock label="Customer" party={customer} />
        </View>
        <LineTaxTable lines={invoiceLineViews(inv)} />
        <View style={{ gap: 6 }}>
          <AmountLine label="Total excluding VAT" value={aed(totals.subtotal)} />
          <AmountLine label={`VAT at ${vatPercent(inv.vatRate)}`} value={aed(totals.vat)} />
          <AmountLine label="Total including VAT" value={aed(totals.total)} strong />
        </View>
        {showSettlement ? (
          <View style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
            {totals.credited > 0 ? <AmountLine label="Credited" value={`−${aed(totals.credited)}`} /> : null}
            {totals.paid > 0 ? <AmountLine label="Paid" value={`−${aed(totals.paid)}`} /> : null}
            {totals.refunded > 0 ? <AmountLine label="Refunded" value={aed(totals.refunded)} /> : null}
            <AmountLine label={balance.label} value={balance.value} strong tone={totals.balance < 0 ? 'warning' : undefined} />
          </View>
        ) : null}
        {payable && !autopayHolds && settings.data?.bankDetails ? (
          <Txt variant="small" style={{ lineHeight: 19 }}>{`Bank transfer: ${settings.data.bankDetails}. Please quote ${inv.number}.`}</Txt>
        ) : null}
      </View>

      {notes.length ? (
        <Group title="Credit notes">
          {notes.map((n) => (
            <GroupRow
              key={n.id}
              icon="receipt_long"
              title={n.number}
              note={`${shortDate(n.issueDate)}${n.reason ? ` · ${n.reason}` : ''}`}
              value={`−${aed(n.total)}`}
              valueTone="text"
              right={<Badge label={creditNoteKind(n)} tone="neutral" />}
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
              icon="undo"
              title={`${shortDate(r.settledAt ?? r.createdAt)} · ${r.method === 'card' ? 'Card refund' : paymentLabel({ method: r.method, reference: r.reference })}`}
              note={
                [r.reason, r.status === 'pending' ? 'Being processed by Stripe.' : '', r.status === 'failed' ? r.failureReason : '']
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              value={aed(r.amount)}
              valueTone="text"
              right={<Badge label={REFUND_STATUS[r.status].label} tone={REFUND_STATUS[r.status].tone} />}
            />
          ))}
        </Group>
      ) : null}
    </View>
  );

  const side = (
    <View style={{ gap: 14 }}>
      <AutopayFailureNote invoice={inv} />
      {payable && inv.autopayStatus === 'pending' ? (
        <Notice tone="info" icon="credit_card">
          Autopay will take this payment from the family’s saved card.
        </Notice>
      ) : null}
      {payable ? (
        recording ? (
          <RecordPayment invoiceId={inv.id} number={inv.number} balance={totals.balance} onDone={() => setRecording(false)} />
        ) : (
          <Button title="Record a payment" icon="payments" onPress={startRecording} />
        )
      ) : null}
      <ChargeSavedCardButton invoice={inv} family={family} balance={totals.balance} />
      {inv.status === 'draft' ? (
        <Button title="Send to family" icon="send" loading={setStatus.isPending} onPress={() => setStatus.mutate([inv.id, 'sent'])} />
      ) : null}

      {inv.payments.map((p) => (
        <PaymentCard key={p.id} payment={p} left={refundableAmount(p, refunds)} canRefund={inv.status !== 'draft'} invoiceId={inv.id} />
      ))}
      {totals.balance < 0 ? (
        <Notice tone="warn" title="Overpaid">
          {`The family has paid ${aed(-totals.balance)} more than this invoice now asks for. Refund it from the payment above.`}
        </Notice>
      ) : null}
      {totals.credited > 0 ? <Notice tone="info" icon="receipt_long">{`${aed(totals.credited)} has been credited on this invoice.`}</Notice> : null}

      <ActionList items={actions} />
      {confirmCancel ? (
        <View style={{ backgroundColor: theme.dangerBg, borderRadius: 16, padding: 18, gap: 12 }} accessibilityRole="alert">
          <Txt style={{ fontSize: 14.5, lineHeight: 21, color: theme.textBody }}>
            {[
              'This issues a credit note for the full remaining amount. Any lessons on it can then be invoiced again.',
              totals.paid > 0 ? 'Payments already received will then show as credit to be refunded.' : '',
              mayHaveCharged ? AUTOPAY_MAY_HAVE_CHARGED : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              title="Cancel invoice"
              variant="danger"
              size="sm"
              loading={setStatus.isPending}
              onPress={() => void cancelInvoice().catch(() => undefined)}
            />
            <Button title="Keep it" variant="secondary" size="sm" onPress={() => setConfirmCancel(false)} />
          </View>
        </View>
      ) : null}
      <ErrorNote error={setStatus.error} />
    </View>
  );

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoice.refetch();
        creditNotes.refetch();
        refundList.refetch();
      }}
      refreshing={invoice.isRefetching}>
      {head}
      <PageHeader back={{ fallback: '/admin/billing' }} kicker={title} title={inv.number} sub={who} />
      <Split weights={[3, 2]}>
        {document}
        {side}
      </Split>
      <HistorySection filter={{ entityId: inv.id }} />
    </Screen>
  );
}

function KeyDate({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 120, gap: 3 }}>
      <Txt variant="figureLabel">{label}</Txt>
      <Txt color={danger ? 'danger' : undefined} style={{ fontSize: 15 }}>
        {value}
      </Txt>
    </View>
  );
}

/** One payment received, with a Refund button while some of it can still be returned. */
function PaymentCard({ payment: p, left, canRefund, invoiceId }: { payment: Payment; left: number; canRefund: boolean; invoiceId: string }) {
  const theme = useTheme();
  const refundedHere = Math.max(0, p.amount - left);
  return (
    <SideCard label="Payment received" style={{ padding: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <Txt style={{ flex: 1, fontSize: 15 }}>{`${formatDate(p.paidAt)} · ${paymentLabel(p)}`}</Txt>
        <Text style={[font('serif'), { fontSize: 19, color: theme.success, fontVariant: ['tabular-nums'] }]}>{aed(p.amount)}</Text>
      </View>
      {refundedHere > 0 ? <Txt variant="note" color="warning">{`${aed(refundedHere)} of this payment has been refunded or is being refunded.`}</Txt> : null}
      {canRefund && left > 0 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button
            title="Refund"
            icon="undo"
            size="sm"
            variant="outline"
            accessibilityLabel="Refund"
            onPress={() => router.push({ pathname: '/refund', params: { paymentId: p.id, invoiceId } })}
          />
        </View>
      ) : null}
    </SideCard>
  );
}

/** Recording a payment needs an amount and a method (never a one-tap "mark paid"). */
function RecordPayment({ invoiceId, number, balance, onDone }: { invoiceId: string; number: string; balance: number; onDone: () => void }) {
  const record = useAction(source.recordPayment);
  const toast = useToast();
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod | null>('bank-transfer');
  const [reference, setReference] = useState('');
  const [tried, setTried] = useState(false);
  const value = Number(amount.replace(/,/g, ''));
  const amountOk = Number.isFinite(value) && value > 0;

  async function save() {
    setTried(true);
    if (!amountOk || !method) return;
    await record.mutateAsync([invoiceId, value, method, reference.trim() || undefined]);
    toast(`${aed(value)} recorded on ${number}.`);
    onDone();
  }

  return (
    <SideCard gold>
      <Txt variant="groupTitle" accessibilityRole="header">
        Record a payment
      </Txt>
      <Field
        label="Amount (AED)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        error={tried && !amountOk ? 'Enter the amount received.' : undefined}
      />
      <ChipField label="Method" options={METHODS} value={method} onChange={setMethod} error={tried && !method} />
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} placeholder="e.g. the bank transfer reference" />
      <ErrorNote error={record.error} />
      <Actions>
        <Button title="Save payment" loading={record.isPending} onPress={() => void save().catch(() => undefined)} />
        <Button title="Cancel" variant="secondary" onPress={onDone} />
      </Actions>
    </SideCard>
  );
}
