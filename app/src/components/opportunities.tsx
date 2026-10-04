import { router } from 'expo-router';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { formatAED } from '@/domain/billing';
import { formatDate, relativeDay } from '@/domain/dates';
import { tutorTeaches } from '@/domain/enrolments';
import type { BidStatus, Opportunity, OpportunityBid, Tutor } from '@/domain/types';

import { subjectLine, teachesCurriculum } from './catalogue-choice';

import { Badge, Card, Row, Txt, type Tone } from './ui';

export const BID_STATUS: Record<BidStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Interested', tone: 'info' },
  awarded: { label: 'Chosen', tone: 'success' },
  declined: { label: 'Not this time', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** The default title of a new role: 'Year 11 IGCSE Chemistry — Zara'. */
export function opportunityTitle(x: { yearGroup?: string; curriculum?: string; subject?: string; firstName?: string }): string {
  const what = [x.curriculum?.trim(), x.subject?.trim()].filter(Boolean).join(' ') || 'Tuition';
  return `${x.yearGroup?.trim() ? `${x.yearGroup.trim()} ` : ''}${what} — ${x.firstName?.trim() || 'new student'}`;
}

/** Whether a tutor suits a role: they teach its subject, and its curriculum when one is set. */
export function tutorFits(t: Pick<Tutor, 'subjects' | 'curricula'>, o: Pick<Opportunity, 'subject' | 'curriculum'>): boolean {
  return tutorTeaches(t, o.subject) && teachesCurriculum(t.curricula, o.curriculum);
}

/** 'teaches Chemistry and IGCSE', 'does not usually teach Chemistry', or '' when the role names nothing. */
export function fitNote(t: Pick<Tutor, 'subjects' | 'curricula'>, o: Pick<Opportunity, 'subject' | 'curriculum'>): string {
  const subject = o.subject?.trim();
  const curriculum = o.curriculum?.trim();
  if (!subject && !curriculum) return '';
  const subjectOk = tutorTeaches(t, subject);
  const curriculumOk = teachesCurriculum(t.curricula, curriculum);
  if (subjectOk && curriculumOk) return `teaches ${[subject, curriculum].filter(Boolean).join(' and ')}`;
  if (!subjectOk && subject) return `does not usually teach ${subject}`;
  return `${subject ? `teaches ${subject}, ` : ''}not usually ${curriculum}`;
}

export function opportunityTone(o: Opportunity): { label: string; tone: Tone } {
  if (o.status === 'awarded') return { label: 'Filled', tone: 'success' };
  if (o.status === 'closed') return { label: 'Closed', tone: 'neutral' };
  return { label: 'Open', tone: 'gold' };
}

/** A role card, for both the admin list and the tutor list. */
export function OpportunityCard({
  o,
  bids,
  myBid,
  href,
  match,
}: {
  o: Opportunity;
  bids?: OpportunityBid[];
  myBid?: OpportunityBid;
  href: string;
  /** Shows 'Matches your subjects' (the tutor's own list). */
  match?: boolean;
}) {
  const s = myBid ? BID_STATUS[myBid.status] : opportunityTone(o);
  const interested = bids?.filter((b) => b.status === 'pending').length ?? 0;
  return (
    <Card onPress={() => router.push(href as never)} accessibilityLabel={o.title}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{o.title}</Txt>
          <Txt variant="muted" numberOfLines={1}>
            {[subjectLine(o), o.schedule, o.location].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Badge label={s.label} tone={s.tone} />
          {match ? <Badge label="Matches your subjects" tone="gold" /> : null}
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
