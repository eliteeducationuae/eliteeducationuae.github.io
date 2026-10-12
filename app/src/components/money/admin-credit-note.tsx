import { router, Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { Logo } from '@/components/logo';
import { AmountLine, creditNoteKind, creditNoteLineViews, LineTaxTable, rebilledSentence, TaxPartyBlock, vatPercent } from '@/components/tax';
import { EmptyState, Group, GroupRow, Loading, PageHeader, Screen, Txt, useWide } from '@/components/ui';
import { font } from '@/constants/theme';
import { useCreditNote, useInvoice, useLookup, useSettings } from '@/data/hooks';
import { invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { creditNoteDocumentTitle, invoiceCustomer, invoiceDocumentTitle, invoiceSupplier } from '@/domain/tax';
import { useTheme } from '@/hooks/use-theme';
import { shareCreditNote } from '@/lib/credit-note-pdf';
import { aed } from '@/lib/invoice-pdf';

import { ActionList, Split, StatusDot } from './blocks';

/** The office's view of a credit note: the tax document, the invoice it is against, and the PDF. */
export function AdminCreditNote({ id }: { id: string }) {
  const theme = useTheme();
  const wide = useWide();
  const note = useCreditNote(id);
  const invoice = useInvoice(note.data?.invoiceId);
  const settings = useSettings();
  const lookup = useLookup();

  const head = <Stack.Screen options={{ headerShown: false }} />;
  if (note.isLoading || !lookup.ready) {
    return (
      <Screen topInset>
        {head}
        <Loading />
      </Screen>
    );
  }
  const n = note.data;
  if (!n) {
    return (
      <Screen topInset>
        {head}
        <PageHeader back={{ fallback: '/admin/billing' }} kicker="Credit note" title="Credit note not found" />
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
    <Screen topInset onRefresh={() => note.refetch()} refreshing={note.isRefetching}>
      {head}
      <PageHeader
        back={{ fallback: '/admin/billing' }}
        kicker={title}
        title={n.number}
        sub={`${family ? `${family.name} family · ` : ''}against ${n.invoiceNumber}`}
      />
      <Split weights={[3, 2]}>
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surface, padding: wide ? 32 : 20, gap: 22 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <Logo wide width={124} />
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={[font('serif'), { fontSize: 28, lineHeight: 32, color: theme.text, fontVariant: ['tabular-nums'] }]}>{aed(n.total)}</Text>
              <StatusDot label={creditNoteKind(n)} color={theme.textMuted} />
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
            <View style={{ flexGrow: 1, flexBasis: 120, gap: 3 }}>
              <Txt variant="figureLabel">Date of issue</Txt>
              <Txt style={{ fontSize: 15 }}>{formatDate(n.issueDate)}</Txt>
            </View>
            <View style={{ flexGrow: 2, flexBasis: 200, gap: 3 }}>
              <Txt variant="figureLabel">Against</Txt>
              <Txt style={{ fontSize: 15 }}>{`${n.invoiceNumber}${inv ? ` dated ${formatDate(inv.issueDate)}` : ''}`}</Txt>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
            <TaxPartyBlock label="Supplier" party={supplier} />
            <TaxPartyBlock label="Customer" party={customer} />
          </View>
          <View style={{ gap: 4 }}>
            <Txt variant="figureLabel">Reason</Txt>
            <Txt>{n.reason}</Txt>
          </View>
          <LineTaxTable lines={creditNoteLineViews(n)} />
          <View style={{ gap: 6 }}>
            <AmountLine label="Credit excluding VAT" value={aed(n.subtotal)} />
            <AmountLine label={`VAT at ${vatPercent(n.vatRate)}`} value={aed(n.vat)} />
            <AmountLine label="Total credit including VAT" value={aed(n.total)} strong />
          </View>
          {n.rebilled ? <Txt variant="small">{rebilledSentence(n)}</Txt> : null}
        </View>
        <View style={{ gap: 14 }}>
          <Group>
            <GroupRow
              icon="description"
              title={`Against ${(inv ? invoiceDocumentTitle(inv, settings.data) : 'Tax Invoice').toLowerCase()} ${n.invoiceNumber}`}
              note={inv ? `Original total ${aed(invoiceTotals(inv).total)} including VAT` : undefined}
              onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: n.invoiceId } })}
              accessibilityLabel={`Open invoice ${n.invoiceNumber}`}
            />
          </Group>
          <Txt variant="small" style={{ lineHeight: 19 }}>
            A credit note is a permanent tax record and cannot be undone. Its number follows on from the last one, with no gaps.
          </Txt>
          <ActionList items={[{ icon: 'download', label: 'Download PDF', onPress: () => shareCreditNote(n, inv, family, settings.data) }]} />
        </View>
      </Split>
    </Screen>
  );
}
