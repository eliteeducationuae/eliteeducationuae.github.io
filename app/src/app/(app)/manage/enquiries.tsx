import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ENQUIRY_STATUS } from '@/components/enquiries';
import { Badge, Button, Card, EmptyState, Loading, Row, Screen, Segmented, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useEnquiries } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import type { EnquiryStatus } from '@/domain/types';

type Filter = 'open' | 'enrolled' | 'lost';

/** The pipeline from first contact to enrolled family. */
export default function Enquiries() {
  const enquiries = useEnquiries();
  const [filter, setFilter] = useState<Filter>('open');
  if (enquiries.isLoading) return <Loading />;
  const all = enquiries.data ?? [];
  const open = all.filter((e) => e.status === 'new' || e.status === 'contacted' || e.status === 'trial-booked');
  const list = (filter === 'open' ? open : all.filter((e) => e.status === filter)).sort((a, b) => {
    const order: EnquiryStatus[] = ['new', 'contacted', 'trial-booked', 'enrolled', 'lost'];
    return order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt.localeCompare(a.createdAt);
  });
  const decided = all.filter((e) => e.status === 'enrolled' || e.status === 'lost');
  const conversion = decided.length ? Math.round((all.filter((e) => e.status === 'enrolled').length / decided.length) * 100) : null;

  return (
    <Screen
      onRefresh={() => enquiries.refetch()}
      refreshing={enquiries.isRefetching}
      footer={<Button title="Add enquiry" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/enquire')} />}>
      <StatGrid>
        <Stat label="New" value={String(all.filter((e) => e.status === 'new').length)} tone="warning" />
        <Stat label="In progress" value={String(open.length)} />
        <Stat label="Conversion" value={conversion === null ? '–' : `${conversion}%`} hint="enrolled vs lost" tone="success" />
      </StatGrid>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: `Open (${open.length})` },
          { value: 'enrolled', label: 'Enrolled' },
          { value: 'lost', label: 'Lost' },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing here" message="Enquiries from the website, the app and phone calls you log appear here." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((e) => (
            <Card key={e.id} onPress={() => router.push({ pathname: '/manage/enquiry/[id]', params: { id: e.id } })} accessibilityLabel={e.parentName}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="h3">{e.parentName}</Txt>
                  <Txt variant="muted" numberOfLines={1}>
                    {[e.studentName, e.curriculum, e.yearGroup].filter(Boolean).join(' · ') || 'No student details yet'}
                  </Txt>
                  {e.message ? (
                    <Txt variant="small" numberOfLines={2}>
                      {e.message}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={ENQUIRY_STATUS[e.status].label} tone={ENQUIRY_STATUS[e.status].tone} />
                  <Txt variant="small">{relativeDay(e.createdAt)}</Txt>
                  <Txt variant="small">via {e.source}</Txt>
                </View>
              </Row>
              {e.nextActionAt && e.status !== 'enrolled' && e.status !== 'lost' ? (
                <Txt variant="small" color="warning">
                  Follow up {relativeDay(`${e.nextActionAt}T12:00:00`).toLowerCase()}
                </Txt>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
