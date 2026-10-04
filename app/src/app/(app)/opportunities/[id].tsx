import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { subjectLine } from '@/components/catalogue-choice';
import { BID_STATUS, opportunityTone } from '@/components/opportunities';
import { Badge, Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useBids, useOpportunities } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatDate } from '@/domain/dates';

export default function TutorOpportunity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const opportunities = useOpportunities();
  const bids = useBids();
  if (me.role === 'admin') return <Redirect href={{ pathname: '/manage/opportunity/[id]', params: { id } }} />;
  if (opportunities.isLoading || bids.isLoading) return <Loading />;
  const o = opportunities.data?.find((x) => x.id === id);
  if (!o) return <Screen><EmptyState title="This role is no longer available" /></Screen>;
  const mine = bids.data?.find((b) => b.opportunityId === o.id && b.tutorId === me.tutorId);
  return <Detail key={`${o.id}-${mine?.status}`} o={o} mine={mine} />;
}

function Detail({ o, mine }: { o: NonNullable<ReturnType<typeof useOpportunities>['data']>[number]; mine?: NonNullable<ReturnType<typeof useBids>['data']>[number] }) {
  const me = useMe();
  const bid = useAction(source.placeBid);
  const withdraw = useAction(source.withdrawBid);
  const [pitch, setPitch] = useState(mine?.status === 'withdrawn' ? '' : (mine?.pitch ?? ''));
  const [availability, setAvailability] = useState(mine?.availability ?? '');
  const [editing, setEditing] = useState(!mine || mine.status === 'withdrawn');
  const s = mine && mine.status !== 'withdrawn' ? BID_STATUS[mine.status] : opportunityTone(o);
  const won = o.awardedTutorId === me.tutorId;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Opportunity' }} />
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Txt variant="h2" style={{ flex: 1 }}>
            {o.title}
          </Txt>
          <Badge label={s.label} tone={s.tone} />
        </Row>
        {subjectLine(o) ? <Txt variant="label">{subjectLine(o)}</Txt> : null}
        {o.description ? <Txt>{o.description}</Txt> : null}
        {o.schedule ? <Txt variant="muted">When: {o.schedule}</Txt> : null}
        {o.location ? <Txt variant="muted">Where: {o.location}</Txt> : null}
        <Txt variant="h3">{formatAED(o.payRate)} per hour</Txt>
        {o.closesOn && o.status === 'open' ? <Txt variant="small">Closes {formatDate(o.closesOn)}</Txt> : null}
      </Card>

      {won ? (
        <Banner tone="success" icon="check">
          You have been chosen for this student. Elite Education will schedule the first lesson with you shortly.
        </Banner>
      ) : mine?.status === 'declined' || (o.status !== 'open' && !won) ? (
        <Banner icon="sparkle">This role has been filled. Thank you for your interest. New opportunities will appear here as they arise.</Banner>
      ) : null}

      {o.status === 'open' && mine?.status === 'pending' && !editing ? (
        <Card style={{ gap: Spacing.two }}>
          <Txt variant="label">Your pitch</Txt>
          <Txt>{mine.pitch}</Txt>
          {mine.availability ? <Txt variant="muted">Available: {mine.availability}</Txt> : null}
          <Row gap={Spacing.two}>
            <Button title="Edit" size="sm" variant="secondary" onPress={() => setEditing(true)} />
            <Button title="Withdraw" size="sm" variant="ghost" loading={withdraw.isPending} onPress={() => withdraw.mutate([o.id])} />
          </Row>
        </Card>
      ) : null}

      {o.status === 'open' && editing ? (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="h3">I’m interested</Txt>
          <Field
            label="Why you’d be a great fit"
            value={pitch}
            onChangeText={setPitch}
            multiline
            placeholder="Relevant experience, results with similar students, and how you would approach their goals."
          />
          <Field label="When you could teach them" value={availability} onChangeText={setAvailability} placeholder="e.g. Tuesdays after 4pm" />
          <ErrorNote error={bid.error} />
          <Button
            title={mine?.status === 'pending' ? 'Update my interest' : 'Put me forward'}
            variant="gold"
            disabled={!pitch.trim()}
            loading={bid.isPending}
            onPress={async () => {
              await bid.mutateAsync([o.id, pitch, availability]);
              setEditing(false);
            }}
          />
        </Card>
      ) : null}
      <ErrorNote error={withdraw.error} />
    </Screen>
  );
}
