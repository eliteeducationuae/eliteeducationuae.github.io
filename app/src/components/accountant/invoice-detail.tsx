import { router, Stack } from 'expo-router';

import { INVOICE_STATUS } from '@/components/billing';
import { balanceLine, invoiceLineViews, REFUND_STATUS, vatPercent } from '@/components/tax';
import { Actions, Button, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Prose, Screen } from '@/components/ui';
import { useCreditNote, useCreditNotes, useInvoice, useLookup, useRefunds, useSettings } from '@/data/hooks';
import { displayStatus, invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { paymentLabel } from '@/domain/payments';
import { creditNoteDocumentTitle, invoiceCustomer, invoiceDocumentTitle, invoiceSupplier } from '@/domain/tax';
import type { TaxParty } from '@/domain/types';
import { shareCreditNote } from '@/lib/credit-note-pdf';
import { aed, shareInvoice } from '@/lib/invoice-pdf';

import { plainAmount, shortDate } from './format';

const INVOICE_LINE_UNIT = 'AED, excluding VAT';

const partyNote = (p: TaxParty) => [p.address?.replace(/\n+/g, ', '), p.trn ? `TRN ${p.trn}` : null, p.email].filter(Boolean).join(' · ');

function Parties({ supplier, customer }: { supplier?: TaxParty; customer?: TaxParty }) {
  if (!supplier && !customer) return null;
  return (
    <Group title="Parties">
      {supplier ? <GroupRow icon="apartment" title={supplier.name} note={partyNote(supplier) || 'Supplier'} /> : null}
      {customer ? <GroupRow icon="family_restroom" title={customer.name} note={partyNote(customer) || 'Customer'} /> : null}
    </Group>
  );
}

const amountRow = (title: string, value: string, strong = false) => (
  <GroupRow key={title} title={title} titleWeight={strong ? 'bold' : 'regular'} value={value} valueTone="text" valueSize={strong ? 16 : undefined} />
);

/** The accountant's view of an invoice: read only, as the tax invoice prints, with its payments, refunds and credit notes. */
export function AccountantInvoiceDetail({ id }: { id: string }) {
  const lookup = useLookup();
  const invoice = useInvoice(id);
  const settings = useSettings();
  const creditNotes = useCreditNotes({ invoiceId: id });
  const refundList = useRefunds({ invoiceId: id });

  if (invoice.isLoading || !lookup.ready) return <Loading />;
  const inv = invoice.data;
  if (!inv) {
    return (
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back={{ fallback: '/accountant/invoices' }} title="Invoice not found" />
        <EmptyState icon="receipt_long" title="Invoice not found" message="It may have been removed, or the link is not quite right." />
      </Screen>
    );
  }
  const family = lookup.family(inv.familyId);
  const totals = invoiceTotals(inv);
  const status = displayStatus(inv);
  const statusLabel = INVOICE_STATUS[status].label;
  const title = invoiceDocumentTitle(inv, settings.data);
  const supplier = invoiceSupplier(inv, settings.data);
  const customer = invoiceCustomer(inv, family);
  const notes = creditNotes.data ?? [];
  const refunds = refundList.data ?? inv.refunds ?? [];
  const lines = invoiceLineViews(inv);
  const lastPayment = [...inv.payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
  const balance = balanceLine(totals.balance);
  const settled = status === 'paid' && lastPayment;

  return (
    <Screen
      topInset
      onRefresh={() => {
        invoice.refetch();
        creditNotes.refetch();
        refundList.refetch();
      }}
      refreshing={invoice.isRefetching}>
      <Stack.Screen options={{ headerShown: false, title: inv.number }} />
      <PageHeader
        back={{ fallback: '/accountant/invoices' }}
        kicker={`${title} · ${statusLabel}`}
        title={inv.number}
        sub={`${family?.name ?? customer?.name ?? 'Family'} · issued ${formatDate(inv.issueDate)}`}
      />
      {status === 'overdue' ? (
        <Notice tone="danger" title={`Overdue since ${shortDate(inv.dueDate)}`}>
          The office follows up overdue invoices with the family.
        </Notice>
      ) : null}
      <Figures>
        <Figure label="Total" value={aed(totals.total)} hint="including VAT" />
        {settled ? (
          <Figure label="Paid" value={aed(totals.paid)} hint={`${shortDate(lastPayment.paidAt)} · ${paymentLabel({ method: lastPayment.method })}`} tone="good" />
        ) : (
          <Figure
            label={totals.balance < 0 ? 'In credit' : 'Balance'}
            value={balance.value}
            hint={inv.status === 'sent' ? `due ${shortDate(inv.dueDate)}` : statusLabel}
            tone={status === 'overdue' ? 'bad' : totals.balance < 0 ? 'warn' : undefined}
          />
        )}
      </Figures>

      <Columns>
        <Parties supplier={supplier} customer={customer} />
        <Group title="Dates">
          {amountRow('Date of issue', formatDate(inv.issueDate))}
          {amountRow('Date of supply', formatDate(inv.supplyDate ?? inv.issueDate))}
          <GroupRow title="Due" titleWeight="regular" value={formatDate(inv.dueDate)} valueTone={status === 'overdue' ? 'bad' : 'text'} />
        </Group>
        <Group title="Lines" meta={INVOICE_LINE_UNIT}>
          {lines.map((l, i) => (
            <GroupRow
              key={i}
              title={l.description}
              titleWeight="regular"
              note={`${l.quantity ? `${l.quantity} · ` : ''}VAT ${vatPercent(l.vatRate)}`}
              value={plainAmount(l.net)}
              valueTone="text"
            />
          ))}
        </Group>
        <Group title="Totals">
          {amountRow('Total excluding VAT', aed(totals.subtotal))}
          {amountRow(`VAT at ${vatPercent(inv.vatRate)}`, aed(totals.vat))}
          {amountRow('Total including VAT', aed(totals.total), true)}
          {totals.credited > 0 ? amountRow('Credited', `−${aed(totals.credited)}`) : null}
          {totals.paid > 0 ? amountRow('Paid', `−${aed(totals.paid)}`) : null}
          {totals.refunded > 0 ? amountRow('Refunded', aed(totals.refunded)) : null}
          {totals.credited > 0 || totals.paid > 0 || totals.refunded > 0 ? amountRow(balance.label, balance.value, true) : null}
        </Group>
        {inv.payments.length || refunds.length ? (
          <Group title={inv.payments.length > 1 ? 'Payments' : 'Payment'}>
            {inv.payments.map((p) => (
              <GroupRow key={p.id} icon="payments" tone="good" title={aed(p.amount)} note={`${paymentLabel(p)} · received ${shortDate(p.paidAt)}`} />
            ))}
            {refunds.map((r) => (
              <GroupRow
                key={r.id}
                icon="currency_exchange"
                title={`Refund${r.reference ? ` ${r.reference}` : ''} · ${aed(r.amount)}`}
                note={`${r.method === 'card' ? 'Card refund' : paymentLabel({ method: r.method })} · ${
                  r.status === 'succeeded' ? `settled ${shortDate(r.settledAt ?? r.createdAt)}` : REFUND_STATUS[r.status].label.toLowerCase()
                }`}
              />
            ))}
          </Group>
        ) : null}
        {notes.length ? (
          <Group title="Credit notes">
            {notes.map((n) => (
              <GroupRow
                key={n.id}
                icon="undo"
                tone="bad"
                title={`${n.number} · ${family?.name ?? 'Family'}`}
                note={`Issued ${shortDate(n.issueDate)} · against ${inv.number}`}
                value={`−${aed(n.total)}`}
                valueTone="bad"
                onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: n.id } })}
              />
            ))}
          </Group>
        ) : null}
      </Columns>

      <Actions>
        <Button title="Download PDF" icon="picture_as_pdf" onPress={() => shareInvoice(inv, family, settings.data)} />
      </Actions>
    </Screen>
  );
}

/** The accountant's view of a credit note: what it credits, why, its totals and how it was settled. */
export function AccountantCreditNoteDetail({ id }: { id: string }) {
  const note = useCreditNote(id);
  const invoice = useInvoice(note.data?.invoiceId);
  const refundList = useRefunds(note.data ? { invoiceId: note.data.invoiceId } : undefined);
  const settings = useSettings();
  const lookup = useLookup();

  if (note.isLoading || !lookup.ready) return <Loading />;
  const n = note.data;
  if (!n) {
    return (
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back={{ fallback: '/accountant/invoices' }} title="Credit note not found" />
        <EmptyState icon="undo" title="Credit note not found" message="It may have been removed, or the link is not quite right." />
      </Screen>
    );
  }
  const inv = invoice.data ?? undefined;
  const family = lookup.family(n.familyId);
  const title = creditNoteDocumentTitle(n, settings.data);
  const supplier = n.supplier ?? invoiceSupplier(inv ?? {}, settings.data);
  const customer = n.customer ?? invoiceCustomer(inv ?? {}, family);
  const refunds = (refundList.data ?? []).filter((r) => r.creditNoteId === n.id);

  return (
    <Screen topInset onRefresh={() => note.refetch()} refreshing={note.isRefetching}>
      <Stack.Screen options={{ headerShown: false, title: n.number }} />
      <PageHeader
        back={{ fallback: '/accountant/invoices' }}
        kicker={title}
        title={n.number}
        sub={`${family?.name ?? customer?.name ?? 'Family'} · issued ${formatDate(n.issueDate)}`}
      />
      <Figures>
        <Figure label="Credit" value={`−${aed(n.total)}`} hint="including VAT" tone="bad" />
        <Figure label="VAT reduced" value={`−${aed(n.vat)}`} hint="on the return for its quarter" />
      </Figures>
      <Columns>
        <Group title="Against">
          <GroupRow
            icon="receipt_long"
            title={`${n.invoiceNumber}${inv ? ` · ${aed(invoiceTotals(inv).total)}` : ''}`}
            note={inv ? `${invoiceDocumentTitle(inv, settings.data)} issued ${formatDate(inv.issueDate)}` : undefined}
            onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: n.invoiceId } })}
          />
        </Group>
        <Prose title="Reason" paragraphs={[n.reason]} />
        <Parties supplier={supplier} customer={customer} />
        <Group title="Lines" meta={INVOICE_LINE_UNIT}>
          {n.lines.map((l, i) => (
            <GroupRow key={i} title={l.description} titleWeight="regular" note={l.rebilled ? 'Returned to be invoiced again' : undefined} value={plainAmount(l.net)} valueTone="text" />
          ))}
        </Group>
        <Group title="Totals">
          {amountRow('Credit excluding VAT', aed(n.subtotal))}
          {amountRow(`VAT at ${vatPercent(n.vatRate)}`, aed(n.vat))}
          {amountRow('Total credit', aed(n.total), true)}
        </Group>
        <Group title="Settled">
          {refunds.length ? (
            refunds.map((r) => (
              <GroupRow
                key={r.id}
                icon="task_alt"
                tone="good"
                titleWeight="regular"
                title={`${r.status === 'succeeded' ? 'Refunded' : REFUND_STATUS[r.status].label} ${r.method === 'card' ? 'to card' : `by ${paymentLabel({ method: r.method }).toLowerCase()}`}${r.reference ? `, ${r.reference}` : ''}`}
                note={`${aed(r.amount)}${r.status === 'succeeded' ? ` · settled ${shortDate(r.settledAt ?? r.createdAt)}` : ''}`}
              />
            ))
          ) : (
            <GroupRow icon="task_alt" tone="good" titleWeight="regular" title={`Set against ${n.invoiceNumber}`} note="It lowers what the family owes on that invoice." />
          )}
        </Group>
      </Columns>
      <Actions>
        <Button title="Download PDF" icon="picture_as_pdf" onPress={() => shareCreditNote(n, inv, family, settings.data)} />
      </Actions>
    </Screen>
  );
}
