import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { AmountLine, creditNoteKind, creditNoteLineViews, LineTaxTable, rebilledSentence, Rule, TaxPartyBlock, vatPercent } from '@/components/tax';
import { Badge, Button, Card, EmptyState, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useCreditNote, useInvoice, useLookup, useSettings } from '@/data/hooks';
import { invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { creditNoteDocumentTitle, invoiceCustomer, invoiceDocumentTitle, invoiceSupplier } from '@/domain/tax';
import { shareCreditNote } from '@/lib/credit-note-pdf';
import { aed } from '@/lib/invoice-pdf';

/** A credit note against a tax invoice. Read by the office, the accountant and the family. */
export default function CreditNotePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = useCreditNote(id);
  const invoice = useInvoice(note.data?.invoiceId);
  const settings = useSettings();
  const lookup = useLookup();

  if (note.isLoading || !lookup.ready) return <Loading />;
  const n = note.data;
  if (!n) {
    return (
      <Screen>
        <EmptyState title="Credit note not found" />
      </Screen>
    );
  }
  const inv = invoice.data ?? undefined;
  const family = lookup.family(n.familyId);
  const title = creditNoteDocumentTitle(n, settings.data);
  const supplier = n.supplier ?? invoiceSupplier(inv ?? {}, settings.data);
  const customer = n.customer ?? invoiceCustomer(inv ?? {}, family);

  return (
    <Screen onRefresh={() => note.refetch()} refreshing={note.isRefetching}>
      <Stack.Screen options={{ title }} />
      <Card style={{ gap: Spacing.three }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label">{title}</Txt>
            <Txt variant="h2">{n.number}</Txt>
            <Txt variant="muted">Issued {formatDate(n.issueDate)}</Txt>
          </View>
          <View style={{ alignItems: 'flex-end', gap: Spacing.one }}>
            <Txt variant="h3">{aed(n.total)}</Txt>
            <Badge label={creditNoteKind(n)} tone="neutral" />
          </View>
        </Row>
        <Card
          onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: n.invoiceId } })}
          accessibilityLabel={`Open invoice ${n.invoiceNumber}`}
          style={{ gap: 2 }}>
          <Txt>
            Against {(inv ? invoiceDocumentTitle(inv, settings.data) : 'Tax Invoice').toLowerCase()} {n.invoiceNumber}
            {inv ? ` dated ${formatDate(inv.issueDate)}` : ''}
          </Txt>
          {inv ? <Txt variant="small">Original invoice total {aed(invoiceTotals(inv).total)} including VAT</Txt> : null}
        </Card>
      </Card>

      <Card style={{ gap: Spacing.three }}>
        <Row gap={Spacing.four} wrap style={{ alignItems: 'flex-start' }}>
          <TaxPartyBlock label="Supplier" party={supplier} />
          <TaxPartyBlock label="Customer" party={customer} />
        </Row>
      </Card>

      <Section title="Reason">
        <Card>
          <Txt>{n.reason}</Txt>
        </Card>
      </Section>

      <Section title="Credited">
        <Card style={{ gap: Spacing.three }}>
          <LineTaxTable lines={creditNoteLineViews(n)} />
          <Rule />
          <View style={{ gap: Spacing.one }}>
            <AmountLine label="Credit excluding VAT" value={aed(n.subtotal)} />
            <AmountLine label={`VAT at ${vatPercent(n.vatRate)}`} value={aed(n.vat)} />
            <AmountLine label="Total credit including VAT" value={aed(n.total)} strong />
          </View>
          {n.rebilled ? <Txt variant="small">{rebilledSentence(n)}</Txt> : null}
        </Card>
      </Section>

      <Button title="Download PDF" icon="share" variant="secondary" onPress={() => shareCreditNote(n, inv, family, settings.data)} />
    </Screen>
  );
}
