import { router } from 'expo-router';
import { useState } from 'react';

import { NoHeader, RowMeta } from '@/components/admin-people/kit';
import { subjectLine } from '@/components/catalogue-choice';
import { Actions, Button, EmptyState, Group, GroupRow, Loading, PageHeader, Screen, Tabs } from '@/components/ui';
import { useBids, useLookup, useOpportunities } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { formatDate, relativeDay } from '@/domain/dates';

/** Student placements tutors can put themselves forward for. */
export default function Opportunities() {
  const opportunities = useOpportunities();
  const bids = useBids();
  const lookup = useLookup();
  const [filter, setFilter] = useState<'open' | 'filled'>('open');
  if (opportunities.isLoading) return <Loading />;
  const all = opportunities.data ?? [];
  const openCount = all.filter((o) => o.status === 'open').length;
  const list = all.filter((o) => (filter === 'open' ? o.status === 'open' : o.status !== 'open'));
  return (
    <Screen topInset onRefresh={() => opportunities.refetch()} refreshing={opportunities.isRefetching}>
      <NoHeader title="Roles for tutors" />
      <PageHeader
        back={{ fallback: '/admin' }}
        kicker="Growth"
        title="Roles for tutors"
        sub="New students waiting for a tutor. Tutors see the role in their app and explain why they would be a good fit; you set the pay and choose who takes it."
      />
      <Tabs
        accessibilityLabel="Roles"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'open', label: `Open (${openCount})` },
          { value: 'filled', label: 'Filled & closed' },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon="school" title={filter === 'open' ? 'No open roles' : 'Nothing here yet'} message="Post a role from an enquiry or a new student." />
      ) : (
        <Group>
          {list.map((o) => {
            const interested = (bids.data ?? []).filter((b) => b.opportunityId === o.id && b.status === 'pending').length;
            const winner = o.awardedTutorId ? lookup.tutor(o.awardedTutorId)?.fullName : undefined;
            return (
              <GroupRow
                key={o.id}
                icon={o.status === 'awarded' ? 'check_circle' : o.status === 'closed' ? 'block' : 'sell'}
                tone={o.status === 'awarded' ? 'good' : o.status === 'closed' ? 'neutral' : 'gold'}
                title={o.title}
                accessibilityLabel={o.title}
                note={[subjectLine(o), o.schedule, o.location, `${formatAED(o.payRate)}/hr`].filter(Boolean).join(' · ')}
                right={
                  <RowMeta
                    tag={o.status === 'awarded' ? (winner ? `Chosen: ${winner.split(' ')[0]}` : 'Filled') : o.status === 'closed' ? 'Closed' : interested ? `${interested} interested` : 'No interest yet'}
                    tone={o.status === 'awarded' ? 'good' : o.status === 'closed' ? 'muted' : interested ? 'accent' : 'muted'}
                    meta={o.status === 'open' && o.closesOn ? `Closes ${formatDate(o.closesOn)}` : `Posted ${relativeDay(o.createdAt).toLowerCase()}`}
                  />
                }
                onPress={() => router.push({ pathname: '/manage/opportunity/[id]', params: { id: o.id } })}
              />
            );
          })}
        </Group>
      )}
      <Actions>
        <Button title="Post a role" icon="add" onPress={() => router.push('/manage/opportunity-edit')} />
      </Actions>
    </Screen>
  );
}
