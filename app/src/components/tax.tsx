import { router } from 'expo-router';
import { Switch, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { formatDate, formatLineDescription } from '@/domain/dates';
import { paymentLabel } from '@/domain/payments';
import { invoiceLineTaxes, round2 } from '@/domain/tax';
import type { CreditNote, CreditNoteRef, Invoice, Refund, RefundStatus, TaxParty } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { aed, pct } from '@/lib/invoice-pdf';

import { Badge, Card, Row, Txt, type Tone } from './ui';

/** Screens at least this wide show tax lines as a table rather than stacked rows. */
const TABLE_MIN_WIDTH = 720;

export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  succeeded: { label: 'Refunded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** 'Re-invoiced' when every line's lesson was returned to be invoiced again, 'Part re-invoiced' when some were, else 'Credit'. */
export function creditNoteKind(note: Pick<CreditNoteRef, 'subtotal' | 'rebilled' | 'rebilledNet'>): string {
  if (!note.rebilled) return 'Credit';
  return note.rebilledNet !== undefined && note.rebilledNet < note.subtotal ? 'Part re-invoiced' : 'Re-invoiced';
}

/** Explains which lessons on a credit note were returned to be invoiced again. */
export function rebilledSentence(note: Pick<CreditNote, 'lines'>): string {
  const marked = note.lines.map((l, i) => (l.rebilled ? i + 1 : 0)).filter(Boolean);
  if (marked.length === 0 || marked.length === note.lines.length) {
    return 'The lessons on this credit note were returned to be invoiced again.';
  }
  const which = marked.length === 1 ? `line ${marked[0]}` : `lines ${marked.slice(0, -1).join(', ')} and ${marked[marked.length - 1]}`;
  return `The lesson${marked.length === 1 ? '' : 's'} on ${which} of this credit note ${marked.length === 1 ? 'was' : 'were'} returned to be invoiced again. The other lines are a credit.`;
}

/** A VAT rate as printed, e.g. 0.05 -> '5%'. */
export const vatPercent = pct;

/** Simple email check for invite forms. */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Parse an AED amount as typed ('1,050.00' or '1050'); NaN when blank or invalid. */
export function parseAmount(s: string): number {
  const t = s.replace(/,/g, '').trim();
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? round2(n) : NaN;
}

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const s = REFUND_STATUS[status];
  return <Badge label={s.label} tone={s.tone} />;
}

/** One credit note in a list, opening the note. */
export function CreditNoteCard({
  note,
  familyName,
  invoiceNumber,
}: {
  note: CreditNoteRef & Partial<Pick<CreditNote, 'reason' | 'invoiceNumber'>>;
  familyName?: string;
  invoiceNumber?: string;
}) {
  const against = invoiceNumber ?? note.invoiceNumber;
  return (
    <Card
      onPress={() => router.push({ pathname: '/credit-note/[id]', params: { id: note.id } })}
      accessibilityLabel={`Credit note ${note.number}, ${aed(note.total)}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{familyName ? `${familyName} · ${note.number}` : note.number}</Txt>
          <Txt variant="muted">
            Issued {formatDate(note.issueDate)}
            {against ? ` · against ${against}` : ''}
          </Txt>
          {note.reason ? (
            <Txt variant="small" numberOfLines={2}>
              {note.reason}
            </Txt>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt variant="h3">{aed(note.total)}</Txt>
          <Badge label={creditNoteKind(note)} tone="neutral" />
        </View>
      </Row>
    </Card>
  );
}

/** One refund: amount, method, status, reference and date. */
export function RefundRow({ refund, invoiceNumber, onPress }: { refund: Refund; invoiceNumber?: string; onPress?: () => void }) {
  const date = refund.settledAt ?? refund.createdAt;
  return (
    <Card style={{ gap: Spacing.one }} onPress={onPress} accessibilityLabel={`Refund of ${aed(refund.amount)}, ${REFUND_STATUS[refund.status].label}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt>
            {formatDate(date)} · {refund.method === 'card' ? 'Card refund' : paymentLabel({ method: refund.method, reference: refund.reference })}
          </Txt>
          {invoiceNumber ? <Txt variant="small">Against {invoiceNumber}</Txt> : null}
          {refund.reason ? <Txt variant="small">{refund.reason}</Txt> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt variant="h3">{aed(refund.amount)}</Txt>
          <RefundStatusBadge status={refund.status} />
        </View>
      </Row>
      {refund.status === 'failed' && refund.failureReason ? <Txt variant="small" color="danger">{refund.failureReason}</Txt> : null}
      {refund.status === 'pending' ? <Txt variant="small">The refund is being processed by Stripe.</Txt> : null}
    </Card>
  );
}

/** Supplier or customer details as printed on a tax document. */
export function TaxPartyBlock({ label, party }: { label: string; party?: TaxParty }) {
  if (!party) return null;
  return (
    <View style={{ gap: 2, flexGrow: 1, flexBasis: 220 }}>
      <Txt variant="label">{label}</Txt>
      <Txt variant="h3">{party.name}</Txt>
      {party.address ? <Txt variant="muted">{party.address}</Txt> : null}
      {party.trn ? <Txt variant="muted">TRN {party.trn}</Txt> : null}
      {party.email ? <Txt variant="muted">{party.email}</Txt> : null}
    </View>
  );
}

export interface TaxLineView {
  description: string;
  /** e.g. '2 × AED 400.00'; omitted for credit note lines. */
  quantity?: string;
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
}

/** Lines with net, VAT rate, VAT and gross: a table on wide screens, stacked rows on phones. */
export function LineTaxTable({ lines }: { lines: TaxLineView[] }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= TABLE_MIN_WIDTH;
  const num = { fontVariant: ['tabular-nums' as const], textAlign: 'right' as const };
  if (wide) {
    const showQty = lines.some((l) => l.quantity);
    const cols = [
      { key: 'net', label: 'Net', flex: 1.1 },
      { key: 'rate', label: 'VAT rate', flex: 0.7 },
      { key: 'vat', label: 'VAT', flex: 1 },
      { key: 'gross', label: 'Gross', flex: 1.1 },
    ];
    return (
      <View style={{ gap: Spacing.two }}>
        <Row gap={Spacing.two} style={{ paddingBottom: Spacing.one, borderBottomWidth: 1, borderBottomColor: theme.text }}>
          <Txt variant="label" style={{ flex: 2.6 }}>
            Description
          </Txt>
          {showQty ? (
            <Txt variant="label" style={{ flex: 1.4, textAlign: 'right' }}>
              Quantity × price
            </Txt>
          ) : null}
          {cols.map((c) => (
            <Txt key={c.key} variant="label" style={{ flex: c.flex, textAlign: 'right' }}>
              {c.label}
            </Txt>
          ))}
        </Row>
        {lines.map((l, i) => (
          <Row key={i} gap={Spacing.two} style={{ alignItems: 'flex-start', paddingBottom: Spacing.two, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <Txt style={{ flex: 2.6 }}>{l.description}</Txt>
            {showQty ? <Txt style={[num, { flex: 1.4 }]}>{l.quantity ?? ''}</Txt> : null}
            <Txt style={[num, { flex: 1.1 }]}>{aed(l.net)}</Txt>
            <Txt style={[num, { flex: 0.7 }]}>{vatPercent(l.vatRate)}</Txt>
            <Txt style={[num, { flex: 1 }]}>{aed(l.vat)}</Txt>
            <Txt style={[num, { flex: 1.1 }]}>{aed(l.gross)}</Txt>
          </Row>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: Spacing.three }}>
      {lines.map((l, i) => (
        <View key={i} style={{ gap: 2, paddingBottom: Spacing.two, borderBottomWidth: i === lines.length - 1 ? 0 : 1, borderBottomColor: theme.border }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
            <Txt style={{ flex: 1 }}>{l.description}</Txt>
            <Txt variant="h3" style={num}>
              {aed(l.gross)}
            </Txt>
          </Row>
          {l.quantity ? <Txt variant="small">{l.quantity}</Txt> : null}
          <Txt variant="small">
            Net {aed(l.net)} · VAT {vatPercent(l.vatRate)} {aed(l.vat)}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** A label and an amount on one line, for totals. */
export function AmountLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'success' | 'danger' | 'warning' }) {
  return (
    <Row style={{ justifyContent: 'space-between' }} gap={Spacing.three}>
      <Txt variant={strong ? 'h3' : 'muted'} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant={strong ? 'h3' : 'body'} color={tone} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
    </Row>
  );
}

/** A thin rule between groups of totals. */
export function Rule() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

/** An invoice's lines for LineTaxTable. */
export function invoiceLineViews(inv: Pick<Invoice, 'items' | 'vatRate'>): TaxLineView[] {
  return invoiceLineTaxes(inv).map((l) => ({
    description: formatLineDescription(l.description),
    quantity: `${l.quantity} × ${aed(l.unitPrice)}`,
    net: l.net,
    vatRate: l.vatRate,
    vat: l.vat,
    gross: l.gross,
  }));
}

/** A credit note's lines for LineTaxTable. */
export function creditNoteLineViews(note: Pick<CreditNote, 'lines' | 'vatRate'>): TaxLineView[] {
  return note.lines.map((l) => ({ description: formatLineDescription(l.description), net: l.net, vatRate: note.vatRate, vat: l.vat, gross: round2(l.net + l.vat) }));
}

/** A labelled on/off switch with an optional explanation underneath. */
export function SwitchRow({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one }}>
      <Row style={{ justifyContent: 'space-between' }} gap={Spacing.three}>
        <Txt style={{ flex: 1 }}>{label}</Txt>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={label}
          trackColor={{ true: theme.primary, false: theme.surfaceAlt }}
          thumbColor={value ? theme.gold : undefined}
        />
      </Row>
      {hint ? <Txt variant="small">{hint}</Txt> : null}
    </View>
  );
}

/** Label for an invoice balance: 'Balance due', or the amount the family is owed when negative. */
export function balanceLine(balance: number): { label: string; value: string } {
  return balance < 0 ? { label: 'In credit, to be refunded', value: aed(-balance) } : { label: 'Balance due', value: aed(balance) };
}
