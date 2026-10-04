import { router } from 'expo-router';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { formatAED } from '@/domain/billing';
import { formatDate, relativeDay } from '@/domain/dates';
import type { BidStatus, Opportunity, OpportunityBid } from '@/domain/types';

import { Badge, Card, Row, Txt, type Tone } from './ui';

export const BID_STATUS: Record<BidStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Interested', tone: 'info' },
  awarded: { label: 'Chosen', tone: 'success' },
  declined: { label: 'Not this time', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export function opportunityTone(o: Opportunity): { label: string; tone: Tone } {
  if (o.status === 'awarded') return { label: 'Filled', tone: 'success' };
  if (o.status === 'closed') return { label: 'Closed', tone: 'neutral' };
  return { label: 'Open', tone: 'gold' };
}

/** A role card, for both the admin list and the tutor list. */
export function OpportunityCard({ o, bids, myBid, href }: { o: Opportunity; bids?: OpportunityBid[]; myBid?: OpportunityBid; href: string }) {
  const s = myBid ? BID_STATUS[myBid.status] : opportunityTone(o);
  const interested = bids?.filter((b) => b.status === 'pending').length ?? 0;
  return (
    <Card onPress={() => router.push(href as never)} accessibilityLabel={o.title}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{o.title}</Txt>
          <Txt variant="muted" numberOfLines={1}>
            {[o.schedule, o.location].filter(Boolean).join(' · ') || o.curriculum || ''}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Badge label={s.label} tone={s.tone} />
          <Txt variant="h3">{formatAED(o.payRate)}/hr</Txt>
        </View>
      </Row>
      <Row gap={Spacing.two}>
        <Txt variant="small">Posted {relativeDay(o.createdAt).toLowerCase()}</Txt>
        {o.closesOn && o.status === 'open' ? <Txt variant="small">· closes {formatDate(o.closesOn)}</Txt> : null}
        {bids && o.status === 'open' ? <Txt variant="small" color={interested ? 'success' : undefined}>· {interested} interested</Txt> : null}
      </Row>
    </Card>
  );
}
