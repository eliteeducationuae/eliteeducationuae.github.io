import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ENQUIRY_STATUS } from '@/components/enquiries';
import { RepeatNote, SpamActions, SpamNote } from '@/components/spam';
import { Badge, Button, Card, EmptyState, Loading, Row, Screen, Segmented, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useEnquiries } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import { isPossibleSpam, withoutSpam } from '@/domain/spam';
import type { EnquiryStatus } from '@/domain/types';

type Filter = 'open' | 'enrolled' | 'lost' | 'spam';

/** The pipeline from first contact to enrolled family. */
export default function Enquiries() {
  const enquiries = useEnquiries();
  const [filter, setFilter] = useState<Filter>('open');
  if (enquiries.isLoading) return <Loading />;
  // Possible spam is kept for review but left out of the pipeline and its figures.
  const all = withoutSpam(enquiries.data ?? []);
  const spam = (enquiries.data ?? [])
    .filter(isPossibleSpam)
    .sort((a, b) => (a.spamStatus === b.spamStatus ? 0 : a.spamStatus === 'suspected' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt));
  const open = all.filter((e) => e.status === 'new' || e.status === 'contacted' || e.status === 'trial-booked');
  const list =
    filter === 'spam'
      ? spam
      : (filter === 'open' ? open : all.filter((e) => e.status === filter)).sort((a, b) => {
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
          { value: 'spam', label: `Possible spam (${spam.length})` },
        ]}
      />
      {list.length === 0 && filter === 'spam' ? (
        <EmptyState icon="inbox" title="No possible spam" message="Messages that look automated are kept here so that nothing genuine is lost." />
      ) : list.length === 0 ? (
        <EmptyState icon="inbox" title="No enquiries in this view" message="Enquiries from the website, the app and phone calls you log appear here." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((e) => (
            <Card key={e.id} onPress={() => router.push({ pathname: '/manage/enquiry/[id]', params: { id: e.id } })} accessibilityLabel={e.parentName}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="h3">{e.parentName}</Txt>
                  <Txt variant="muted" numberOfLines={1}>
                    {[e.studentName, e.subject, e.phase, e.curriculum, e.yearGroup].filter(Boolean).join(' · ') || 'No student details yet'}
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
              {filter === 'spam' ? (
                <>
                  <SpamNote item={e} />
                  <SpamActions kind="enquiry" id={e.id} status={e.spamStatus} />
                </>
              ) : (
                <RepeatNote repeatCount={e.repeatCount} />
              )}
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
