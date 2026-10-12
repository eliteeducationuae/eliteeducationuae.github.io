import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { subjectLine } from '@/components/catalogue-choice';
import { Actions, Button, EmptyState, ErrorNote, Field, FieldsCard, Figure, Figures, Loading, Notice, PageHeader, Prose, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useBids, useOpportunities } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
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
  if (!o) {
    return (
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back kicker="Opportunity" title="Opportunity" />
        <EmptyState title="This role is no longer available" />
      </Screen>
    );
  }
  const mine = bids.data?.find((b) => b.opportunityId === o.id && b.tutorId === me.tutorId);
  return <Detail key={`${o.id}-${mine?.status}`} o={o} mine={mine} />;
}

function Detail({ o, mine }: { o: NonNullable<ReturnType<typeof useOpportunities>['data']>[number]; mine?: NonNullable<ReturnType<typeof useBids>['data']>[number] }) {
  const me = useMe();
  const viewing = !!useViewing();
  const toast = useToast();
  const bid = useAction(source.placeBid);
  const withdraw = useAction(source.withdrawBid);
  const [pitch, setPitch] = useState(mine?.status === 'withdrawn' ? '' : (mine?.pitch ?? ''));
  const [availability, setAvailability] = useState(mine?.availability ?? '');
  const [editing, setEditing] = useState(!mine || mine.status === 'withdrawn');
  const [tried, setTried] = useState(false);
  const won = o.awardedTutorId === me.tutorId;

  return (
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Opportunity" title={o.title} sub={[o.location, o.schedule].filter(Boolean).join(' · ') || subjectLine(o)} />
      <Figures>
        <Figure label="Pay" value={formatAED(o.payRate)} hint="an hour" tone="highlight" />
        {o.closesOn && o.status === 'open' ? <Figure label="Closes" value={formatDate(o.closesOn)} /> : null}
      </Figures>
      {o.description ? <Prose title="About the student" paragraphs={[o.description]} /> : null}
      {subjectLine(o) ? <Prose title="Subject" paragraphs={[subjectLine(o)!]} /> : null}

      {won ? (
        <Notice tone="good" title="You have been chosen">
          Elite Education will schedule the first lesson with you shortly.
        </Notice>
      ) : mine?.status === 'declined' || (o.status !== 'open' && !won) ? (
        <Notice tone="info">This role has been filled. Thank you for your interest. New opportunities will appear here as they arise.</Notice>
      ) : null}

      {o.status === 'open' && mine?.status === 'pending' && !editing ? (
        <>
          <Notice tone="good" title="Interest sent">
            Thank you. The office will be in touch if the family would like to meet you.
          </Notice>
          <Prose title="Your pitch" paragraphs={[mine.pitch, ...(mine.availability ? [`Available: ${mine.availability}`] : [])]} />
          {!viewing ? (
            <Actions>
              <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} />
              <Button
                title="Withdraw"
                variant="secondary"
                loading={withdraw.isPending}
                onPress={async () => {
                  await withdraw.mutateAsync([o.id]);
                  toast('Interest withdrawn');
                }}
              />
            </Actions>
          ) : null}
        </>
      ) : null}

      {o.status === 'open' && editing && !viewing ? (
        <>
          <FieldsCard>
            <Field
              label="Why you would be a great fit"
              value={pitch}
              onChangeText={setPitch}
              multiline
              error={tried && !pitch.trim()}
              placeholder="Your experience with this subject and age group, and how you would approach their goals."
            />
            <Field label="When you could teach them" value={availability} onChangeText={setAvailability} placeholder="e.g. Tuesdays after 16:00" />
          </FieldsCard>
          <ErrorNote error={bid.error} />
          <Actions>
            <Button
              title={mine?.status === 'pending' ? 'Update my interest' : 'Put myself forward'}
              icon="send"
              loading={bid.isPending}
              onPress={async () => {
                setTried(true);
                if (!pitch.trim()) return;
                await bid.mutateAsync([o.id, pitch, availability]);
                setEditing(false);
                toast('Interest sent to the office');
              }}
            />
          </Actions>
        </>
      ) : null}
      <ErrorNote error={withdraw.error} />
    </Screen>
  );
}
