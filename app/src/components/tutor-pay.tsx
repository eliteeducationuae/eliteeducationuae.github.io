import { router } from 'expo-router';
import { View } from 'react-native';

import { formatAED } from '@/domain/billing';
import { formatMonth } from '@/domain/dates';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { TutorInvoice, TutorInvoiceStatus } from '@/domain/types';

import { Badge, Card, Row, Txt, type Tone } from './ui';

export const TUTOR_INVOICE_STATUS: Record<TutorInvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved for payment', tone: 'info' },
  rejected: { label: 'Needs changes', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
};

export const periodLabel = (inv: Pick<TutorInvoice, 'periodStart'>) => formatMonth(new Date(`${inv.periodStart}T12:00:00`));

export function TutorInvoiceCard({ inv, tutorName }: { inv: TutorInvoice; tutorName?: string }) {
  const s = TUTOR_INVOICE_STATUS[inv.status];
  const lessons = inv.items.filter((i) => i.lessonId).length;
  return (
    <Card onPress={() => router.push({ pathname: '/tutor-invoices/[id]', params: { id: inv.id } })} accessibilityLabel={`${tutorName ?? ''} ${periodLabel(inv)}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{tutorName ? `${tutorName} · ${periodLabel(inv)}` : periodLabel(inv)}</Txt>
          <Txt variant="muted">
            {inv.number} · {lessons} lesson{lessons === 1 ? '' : 's'}
            {inv.items.length > lessons ? ` + ${inv.items.length - lessons} extra` : ''}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt variant="h3">{formatAED(tutorInvoiceTotal(inv.items))}</Txt>
          <Badge label={s.label} tone={s.tone} />
        </View>
      </Row>
    </Card>
  );
}
