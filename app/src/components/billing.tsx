import { router } from 'expo-router';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { displayStatus, formatAED, invoiceTotals, packageRemaining, type DisplayInvoiceStatus } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import type { Invoice, LessonPackage } from '@/domain/types';

import { Badge, Card, ProgressBar, Row, Txt, type Tone } from './ui';

export const INVOICE_STATUS: Record<DisplayInvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Due', tone: 'info' },
  'part-paid': { label: 'Part paid', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' },
};

export function InvoiceCard({ invoice, familyName }: { invoice: Invoice; familyName?: string }) {
  const status = displayStatus(invoice);
  const { total, balance } = invoiceTotals(invoice);
  const s = INVOICE_STATUS[status];
  return (
    <Card
      onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: invoice.id } })}
      accessibilityLabel={`Invoice ${invoice.number}, ${s.label}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{familyName ? `${familyName} · ${invoice.number}` : invoice.number}</Txt>
          <Txt variant="muted">
            Issued {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt variant="h3">{formatAED(total)}</Txt>
          <Badge label={s.label} tone={s.tone} />
        </View>
      </Row>
      {balance > 0 && balance < total ? <Txt variant="small">{formatAED(balance)} outstanding</Txt> : null}
    </Card>
  );
}

export function PackageCard({ pkg }: { pkg: LessonPackage }) {
  const remaining = packageRemaining(pkg);
  const low = remaining <= 2;
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h3">{pkg.name}</Txt>
        <Badge label={`${remaining} left`} tone={remaining === 0 ? 'neutral' : low ? 'warning' : 'success'} />
      </Row>
      <ProgressBar value={(pkg.lessonsUsed / pkg.lessonsTotal) * 100} />
      <Txt variant="small">
        {pkg.lessonsUsed} of {pkg.lessonsTotal} lessons used · bought {formatDate(pkg.purchasedAt)}
        {pkg.expiresAt ? ` · expires ${formatDate(pkg.expiresAt)}` : ''}
      </Txt>
    </Card>
  );
}
