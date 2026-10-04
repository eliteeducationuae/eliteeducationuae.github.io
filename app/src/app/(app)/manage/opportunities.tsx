import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { OpportunityCard } from '@/components/opportunities';
import { Button, EmptyState, Loading, Screen, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useBids, useOpportunities } from '@/data/hooks';

/** Student placements tutors can put themselves forward for. */
export default function Opportunities() {
  const opportunities = useOpportunities();
  const bids = useBids();
  const [filter, setFilter] = useState<'open' | 'filled'>('open');
  if (opportunities.isLoading) return <Loading />;
  const list = (opportunities.data ?? []).filter((o) => (filter === 'open' ? o.status === 'open' : o.status !== 'open'));
  return (
    <Screen
      onRefresh={() => opportunities.refetch()}
      refreshing={opportunities.isRefetching}
      footer={<Button title="Post a role" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/manage/opportunity-edit')} />}>
      <Txt variant="muted">Post a new student and your tutors can put themselves forward. You set the pay; they tell you why they’re a good fit.</Txt>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: `Open (${(opportunities.data ?? []).filter((o) => o.status === 'open').length})` },
          { value: 'filled', label: 'Filled & closed' },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon="school" title={filter === 'open' ? 'No open roles' : 'Nothing here yet'} message="Post a role from an enquiry or a new student." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((o) => (
            <OpportunityCard key={o.id} o={o} bids={(bids.data ?? []).filter((b) => b.opportunityId === o.id)} href={`/manage/opportunity/${o.id}`} />
          ))}
        </View>
      )}
    </Screen>
  );
}
