import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader, RowMeta, type TagTone } from '@/components/admin-people/kit';
import { APPLICATION_STATUS } from '@/components/hiring';
import { RepeatNote, SpamActions, SpamFilterChip, SpamNote } from '@/components/spam';
import { EmptyState, Group, GroupRow, Loading, PageHeader, Screen, Tabs } from '@/components/ui';
import { useApplications } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import { isPossibleSpam, withoutSpam } from '@/domain/spam';
import type { ApplicationStatus } from '@/domain/types';

const STAGE_TONE: Record<ApplicationStatus, TagTone> = { applied: 'accent', interview: 'warn', offer: 'good', hired: 'good', rejected: 'muted' };

/** People who applied to teach with Elite Education. */
export default function Applications() {
  const applications = useApplications();
  const params = useLocalSearchParams<{ view?: string }>();
  const [filter, setFilter] = useState<'open' | 'done' | 'spam'>(() => (params.view === 'spam' ? 'spam' : 'open'));
  if (applications.isLoading) return <Loading />;
  // Possible spam is kept for review but left out of the hiring lists.
  const all = withoutSpam(applications.data ?? []);
  const spam = (applications.data ?? [])
    .filter(isPossibleSpam)
    .sort((a, b) => (a.spamStatus === b.spamStatus ? 0 : a.spamStatus === 'suspected' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt));
  const open = all.filter((a) => a.status === 'applied' || a.status === 'interview' || a.status === 'offer');
  const list = filter === 'spam' ? spam : (filter === 'open' ? open : all.filter((a) => !open.includes(a))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Screen topInset onRefresh={() => applications.refetch()} refreshing={applications.isRefetching}>
      <NoHeader title="Hiring" />
      <PageHeader
        back={{ fallback: '/admin' }}
        kicker="Team"
        title="Hiring"
        sub="Applications from the “Teach with us” form on the website and in the app. Open an applicant to review, move them on and hire."
      />
      <Tabs
        accessibilityLabel="Applications"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'open', label: `In progress (${open.length})` },
          { value: 'done', label: 'Hired & closed' },
        ]}
      />
      <View style={{ flexDirection: 'row' }}>
        <SpamFilterChip count={spam.length} selected={filter === 'spam'} onPress={() => setFilter(filter === 'spam' ? 'open' : 'spam')} />
      </View>
      {list.length === 0 && filter === 'spam' ? (
        <EmptyState icon="school" title="No possible spam" message="Applications that look automated are kept here so that nothing genuine is lost." />
      ) : list.length === 0 ? (
        <EmptyState icon="school" title="No applications here" message="Applications from the website and the app will appear here." />
      ) : (
        <Group title={filter === 'spam' ? 'Possible spam' : undefined}>
          {list.map((a) => (
            <GroupRow
              key={a.id}
              avatar={a.fullName}
              title={a.fullName}
              accessibilityLabel={a.fullName}
              note={[a.subjects, a.curricula.join(', '), (a.phases ?? []).join(', '), a.qualifications].filter(Boolean).join(' · ')}
              right={<RowMeta tag={APPLICATION_STATUS[a.status].label} tone={STAGE_TONE[a.status]} meta={relativeDay(a.createdAt)} />}
              onPress={() => router.push({ pathname: '/manage/application/[id]', params: { id: a.id } })}>
              {filter === 'spam' ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <SpamNote item={a} />
                  <SpamActions kind="application" id={a.id} status={a.spamStatus} />
                </View>
              ) : (
                <RepeatNote repeatCount={a.repeatCount} />
              )}
            </GroupRow>
          ))}
        </Group>
      )}
    </Screen>
  );
}
