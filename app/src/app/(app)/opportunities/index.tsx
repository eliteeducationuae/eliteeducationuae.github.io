import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { BID_STATUS } from '@/components/opportunities';
import { EmptyState, Group, GroupRow, Loading, PageHeader, Screen, Tabs } from '@/components/ui';
import { useBids, useOpportunities, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { sameSubject } from '@/domain/enrolments';

/** Tutors: new students you can put yourself forward for. */
export default function TutorOpportunities() {
  const me = useMe();
  const opportunities = useOpportunities();
  const bids = useBids();
  const tutors = useTutors();
  const [tab, setTab] = useState<'open' | 'mine'>('open');
  if (opportunities.isLoading || bids.isLoading) return <Loading />;
  const myBids = (bids.data ?? []).filter((b) => b.tutorId === me.tutorId);
  const all = opportunities.data ?? [];
  const mySubjects = tutors.data?.find((t) => t.id === me.tutorId)?.subjects ?? [];
  const matches = (o: (typeof all)[number]) => !!o.subject && mySubjects.some((s) => sameSubject(s, o.subject));
  const open = all.filter((o) => o.status === 'open');
  const filtered = tab === 'open' ? open : all.filter((o) => myBids.some((b) => b.opportunityId === o.id));
  // Roles in the tutor's own subjects come first; otherwise the order is unchanged.
  const list = [...filtered].sort((a, b) => Number(matches(b)) - Number(matches(a)));
  return (
    <Screen topInset onRefresh={() => opportunities.refetch()} refreshing={opportunities.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Opportunities" title="New students" sub="Tell us why you would be a great fit; the pay is shown on each role." />
      <Tabs
        accessibilityLabel="Opportunities"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: `Open (${open.length})` },
          { value: 'mine', label: 'My interest' },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState
          icon="school"
          title={tab === 'open' ? 'No open roles at the moment' : 'You have not yet expressed interest in a role'}
          message="We will let you know as soon as a new student is looking for a tutor."
        />
      ) : (
        <Group>
          {list.map((o) => {
            const mine = myBids.find((b) => b.opportunityId === o.id && b.status !== 'withdrawn');
            return (
              <GroupRow
                key={o.id}
                icon="school"
                title={o.title}
                note={[o.location, o.schedule].filter(Boolean).join(' · ') || undefined}
                value={mine ? BID_STATUS[mine.status].label : matches(o) ? 'Your subjects' : `${formatAED(o.payRate)}/h`}
                valueTone={mine ? (mine.status === 'awarded' || mine.status === 'pending' ? 'good' : 'muted') : 'accent'}
                valueSize={12.5}
                onPress={() => router.push({ pathname: '/opportunities/[id]', params: { id: o.id } })}
              />
            );
          })}
        </Group>
      )}
    </Screen>
  );
}
