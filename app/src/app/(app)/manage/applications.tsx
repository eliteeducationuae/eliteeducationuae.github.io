import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { APPLICATION_STATUS } from '@/components/hiring';
import { Badge, Card, EmptyState, Loading, Row, Screen, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApplications } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';

/** People who applied to teach with Elite Education. */
export default function Applications() {
  const applications = useApplications();
  const [filter, setFilter] = useState<'open' | 'done'>('open');
  if (applications.isLoading) return <Loading />;
  const all = applications.data ?? [];
  const open = all.filter((a) => a.status === 'applied' || a.status === 'interview' || a.status === 'offer');
  const list = (filter === 'open' ? open : all.filter((a) => !open.includes(a))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      {list.length === 0 ? (
        <EmptyState icon="school" title="No applications here" />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((a) => (
            <Card key={a.id} onPress={() => router.push({ pathname: '/manage/application/[id]', params: { id: a.id } })} accessibilityLabel={a.fullName}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="h3">{a.fullName}</Txt>
                  <Txt variant="muted">{[a.curricula.join(', '), a.qualifications].filter(Boolean).join(' · ')}</Txt>
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
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
