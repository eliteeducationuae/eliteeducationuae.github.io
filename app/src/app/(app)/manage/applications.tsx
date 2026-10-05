import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { APPLICATION_STATUS } from '@/components/hiring';
import { RepeatNote, SpamActions, SpamFilterChip, SpamNote } from '@/components/spam';
import { Badge, Card, EmptyState, Loading, Row, Screen, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApplications } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import { isPossibleSpam, withoutSpam } from '@/domain/spam';

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
    <Screen onRefresh={() => applications.refetch()} refreshing={applications.isRefetching}>
      <Txt variant="muted">Applications from the “Teach with us” form on the website and in the app.</Txt>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: `In progress (${open.length})` },
          { value: 'done', label: 'Hired & closed' },
        ]}
      />
      <SpamFilterChip count={spam.length} selected={filter === 'spam'} onPress={() => setFilter(filter === 'spam' ? 'open' : 'spam')} />
      {list.length === 0 && filter === 'spam' ? (
        <EmptyState icon="school" title="No possible spam" message="Applications that look automated are kept here so that nothing genuine is lost." />
      ) : list.length === 0 ? (
        <EmptyState icon="school" title="No applications here" message="Applications from the website and the app will appear here." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((a) => (
            <Card key={a.id} onPress={() => router.push({ pathname: '/manage/application/[id]', params: { id: a.id } })} accessibilityLabel={a.fullName}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="h3">{a.fullName}</Txt>
                  <Txt variant="muted" numberOfLines={2}>{[a.subjects, a.curricula.join(', '), (a.phases ?? []).join(', '), a.qualifications].filter(Boolean).join(' · ')}</Txt>
                  {a.experience ? (
                    <Txt variant="small" numberOfLines={2}>
                      {a.experience}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={APPLICATION_STATUS[a.status].label} tone={APPLICATION_STATUS[a.status].tone} />
                  <Txt variant="small">{relativeDay(a.createdAt)}</Txt>
                </View>
              </Row>
              {filter === 'spam' ? (
                <>
                  <SpamNote item={a} />
                  <SpamActions kind="application" id={a.id} status={a.spamStatus} />
                </>
              ) : (
                <RepeatNote repeatCount={a.repeatCount} />
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
