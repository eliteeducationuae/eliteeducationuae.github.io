import { useState } from 'react';
import { View } from 'react-native';

import { OpportunityCard } from '@/components/opportunities';
import { EmptyState, Loading, Screen, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useBids, useOpportunities, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
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
  const filtered = tab === 'open' ? all.filter((o) => o.status === 'open') : all.filter((o) => myBids.some((b) => b.opportunityId === o.id));
  // Roles in the tutor's own subjects come first; otherwise the order is unchanged.
  const list = [...filtered].sort((a, b) => Number(matches(b)) - Number(matches(a)));
  return (
    <Screen onRefresh={() => opportunities.refetch()} refreshing={opportunities.isRefetching}>
      <Txt variant="muted">New students who are looking for a tutor. Tell us why you would be a great fit; the pay is shown on each role.</Txt>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: `Open (${all.filter((o) => o.status === 'open').length})` },
          { value: 'mine', label: 'My interest' },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon="school" title={tab === 'open' ? 'No open roles at the moment' : 'You have not yet expressed interest in a role'} message="We will notify you as soon as a new student is looking for a tutor." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((o) => (
            <OpportunityCard key={o.id} o={o} match={matches(o)} myBid={myBids.find((b) => b.opportunityId === o.id)} href={`/opportunities/${o.id}`} />
          ))}
        </View>
      )}
    </Screen>
  );
}
