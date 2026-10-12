import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { BuyLessonsGroup, CardAutopayGroup } from '@/components/parent/billing-view';
import { dayMonth } from '@/components/parent/format';
import { payableInvoices } from '@/components/parent/hooks';
import { REFUND_STATUS, vatPercent } from '@/components/tax';
import { Actions, Button, Columns, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Screen, type ValueTone } from '@/components/ui';
import { useCharges, useCreditNotes, useFamilies, useInvoices, usePackageOffers, usePackages, useRefunds, useServices, useSettings } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe, useViewing } from '@/data/session';
import { displayStatus, formatAED, invoiceTotals, packageRemaining, type DisplayInvoiceStatus } from '@/domain/billing';
import { autopayHoldsInvoice, autopayStatusText, paymentLabel } from '@/domain/payments';
import type { Invoice } from '@/domain/types';

const STATUS_WORDS: Record<DisplayInvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Due',
  'part-paid': 'Part paid',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
  credited: 'Credited',
};

const STATUS_TONE: Record<DisplayInvoiceStatus, ValueTone> = {
  draft: 'muted',
  sent: 'warn',
  'part-paid': 'warn',
  overdue: 'bad',
  paid: 'good',
  void: 'muted',
  credited: 'muted',
};

const openInvoice = (id: string) => router.push({ pathname: '/invoice/[id]', params: { id } });

export default function ParentBilling() {
  const me = useMe();
  const viewing = useViewing();
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
    // Drop ?topup=1 from the address. The tab screen stays mounted, so the notice stays for this visit.
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
  const open = payableInvoices(invoices.data);
  const toPay = open.filter((i) => !autopayHoldsInvoice(i));
  const due = open.reduce((s, i) => s + invoiceTotals(i).balance, 0);
  const credits = (packages.data ?? []).reduce((n, p) => n + packageRemaining(p), 0);
  const unbilled = (charges.data ?? []).filter((c) => c.status === 'unbilled');
  const pending = unbilled.reduce((s, c) => s + c.amount, 0);
  const pendingLessons = new Set(unbilled.map((c) => c.lessonId)).size;
  const family = (families.data ?? []).find((f) => f.id === me.familyId);
  const vatRate = settings.data?.vatRate ?? 0;
  const dueHint = !due
    ? 'Nothing to pay'
    : open.length === 1
      ? `${open[0].number} · ${displayStatus(open[0]) === 'overdue' ? 'overdue' : `due ${dayMonth(open[0].dueDate)}`}`
      : `${open.length} invoices`;
  const sub = [
    settings.data ? `Invoices are due within ${settings.data.invoiceDueDays} days of issue.` : '',
    vatRate > 0 ? `VAT at ${vatPercent(vatRate)} is shown on every invoice.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoices.refetch();
        creditNotes.refetch();
        refunds.refetch();
      }}
      refreshing={invoices.isRefetching}>
      <PageHeader kicker="Billing" title="Invoices and payments" sub={sub || undefined} />
      {toppedUp ? (
        <Notice tone="good" title="Thank you">
          Thank you. Your new lessons will appear here in a moment.
        </Notice>
      ) : null}
      <Figures>
        <Figure label="Due now" value={formatAED(due)} hint={dueHint} tone={due > 0 ? (open.some((i) => displayStatus(i) === 'overdue') ? 'bad' : 'warn') : 'good'} />
        {pending ? (
          <Figure
            label="Next invoice"
            value={formatAED(pending)}
            hint={`${pendingLessons === 1 ? 'one lesson' : `${pendingLessons} lessons`} so far${vatRate > 0 ? ', before VAT' : ''}`}
          />
        ) : null}
        {credits ? <Figure label="Prepaid lessons" value={String(credits)} hint="remaining" /> : null}
      </Figures>

      {open.length ? (
        <>
          <Group title="To pay">
            {open.map((i) => (
              <GroupRow
                key={i.id}
                icon="receipt_long"
                tone={displayStatus(i) === 'overdue' ? 'bad' : 'warn'}
                title={i.number}
                note={autopayHoldsInvoice(i) ? autopayStatusText(i.autopayStatus!) : `${displayStatus(i) === 'overdue' ? 'Was due' : 'Due'} ${dayMonth(i.dueDate)}`}
                value={formatAED(invoiceTotals(i).balance)}
                valueTone="text"
                onPress={() => openInvoice(i.id)}
              />
            ))}
          </Group>
          {toPay.length === 1 && !viewing ? (
            <Actions>
              <Button
                title={`Pay ${formatAED(invoiceTotals(toPay[0]).balance)}`}
                icon="lock"
                onPress={() => router.push({ pathname: '/secure-pay', params: { invoiceId: toPay[0].id } })}
              />
            </Actions>
          ) : null}
        </>
      ) : null}

      <Columns>
        {(packages.data ?? []).length ? (
          <Group title="Lesson packages">
            {(packages.data ?? []).map((p) => {
              const left = packageRemaining(p);
              return (
                <GroupRow
                  key={p.id}
                  icon="inventory_2"
                  title={p.name}
                  note={`${left} of ${p.lessonsTotal} remaining · bought ${dayMonth(p.purchasedAt)}${p.expiresAt ? ` · use by ${dayMonth(p.expiresAt)}` : ''}`}
                  progress={p.lessonsTotal ? (left / p.lessonsTotal) * 100 : 0}
                />
              );
            })}
          </Group>
        ) : null}

        <Group title="Invoices" note={list.length ? undefined : 'Your invoices will appear here as soon as they are issued.'}>
          {list.map((i) => (
            <InvoiceRow key={i.id} invoice={i} />
          ))}
        </Group>

        {creditNotes.data?.length ? (
          <Group title="Credit notes">
            {creditNotes.data.map((n) => (
              <GroupRow
                key={n.id}
                icon="assignment_return"
                title={`${n.number} · ${formatAED(n.total)}`}
                note={[`Against ${n.invoiceNumber}`, `issued ${dayMonth(n.issueDate)}`, n.reason].filter(Boolean).join(' · ')}
                onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
              />
            ))}
          </Group>
        ) : null}

        {refunds.data?.length ? (
          <Group title="Refunds">
            {refunds.data.map((r) => (
              <GroupRow
                key={r.id}
                icon="payments"
                title={`${formatAED(r.amount)} · ${r.method === 'card' ? 'Card refund' : paymentLabel({ method: r.method, reference: r.reference })}`}
                note={[invoiceNumber.get(r.invoiceId) ? `Against ${invoiceNumber.get(r.invoiceId)}` : '', dayMonth(r.settledAt ?? r.createdAt), r.status === 'failed' ? r.failureReason : r.status === 'pending' ? 'Being processed by Stripe' : '']
                  .filter(Boolean)
                  .join(' · ')}
                value={REFUND_STATUS[r.status].label}
                valueTone={r.status === 'succeeded' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}
                valueSize={13}
                onPress={() => openInvoice(r.invoiceId)}
              />
            ))}
          </Group>
        ) : null}

        {family ? <CardAutopayGroup family={family} /> : null}
        {settings.data ? <BuyLessonsGroup offers={offers.data ?? []} services={services.data ?? []} vatRate={settings.data.vatRate} /> : null}
      </Columns>
    </Screen>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const status = displayStatus(invoice);
  const t = invoiceTotals(invoice);
  const lastPaid = [...invoice.payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
  const note =
    status === 'paid'
      ? `Paid${lastPaid ? ` ${dayMonth(lastPaid.paidAt)}` : ''}${invoice.autopayStatus === 'succeeded' ? ' by autopay' : ''}`
      : status === 'credited'
        ? 'Cancelled with a credit note'
        : status === 'overdue'
          ? `Overdue · was due ${dayMonth(invoice.dueDate)}`
          : `Issued ${dayMonth(invoice.issueDate)} · due ${dayMonth(invoice.dueDate)}`;
  return (
    <GroupRow
      icon="receipt_long"
      title={invoice.number}
      note={t.balance < 0 ? `${note} · ${formatAED(-t.balance)} in credit, to be refunded` : note}
      value={formatAED(t.total)}
      valueTone={STATUS_TONE[status]}
      accessibilityLabel={`Invoice ${invoice.number}, ${STATUS_WORDS[status]}, ${formatAED(t.total)}`}
      onPress={() => openInvoice(invoice.id)}
    />
  );
}
