import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { stageOf, viaSource } from '@/components/ops/enquiry-stage';
import { NoHeader, StageLabel } from '@/components/ops/parts';
import { RepeatNote, SpamActions, SpamNote } from '@/components/spam';
import { Button, EmptyState, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Tabs, Txt, useWide } from '@/components/ui';
import { useEnquiries } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import { isPossibleSpam, withoutSpam } from '@/domain/spam';
import type { Enquiry, EnquiryStatus } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

type Filter = 'open' | 'enrolled' | 'lost' | 'spam';
const ORDER: EnquiryStatus[] = ['new', 'contacted', 'trial-booked', 'enrolled', 'lost'];

/** The pipeline from first contact to enrolled family. Possible spam is kept in its own view for review. */
export default function Enquiries() {
  const enquiries = useEnquiries();
  const wide = useWide();
  const params = useLocalSearchParams<{ view?: string }>();
  const [filter, setFilter] = useState<Filter>(() => (params.view === 'spam' ? 'spam' : 'open'));
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
      : (filter === 'open' ? open : all.filter((e) => e.status === filter)).sort(
          (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.createdAt.localeCompare(a.createdAt),
        );
  const decided = all.filter((e) => e.status === 'enrolled' || e.status === 'lost');
  const conversion = decided.length ? Math.round((all.filter((e) => e.status === 'enrolled').length / decided.length) * 100) : null;
  const fresh = all.filter((e) => e.status === 'new').length;

  const tabs: { value: Filter; label: string; badge?: number }[] = [
    { value: 'open', label: `Open (${open.length})` },
    { value: 'enrolled', label: 'Enrolled' },
    { value: 'lost', label: 'Lost' },
  ];
  // Kept apart from the pipeline: shown only while something is held, or while it is open.
  if (spam.length || filter === 'spam') tabs.push({ value: 'spam', label: `Possible spam (${spam.length})` });

  return (
    <Screen topInset onRefresh={() => enquiries.refetch()} refreshing={enquiries.isRefetching}>
      <NoHeader />
      <PageHeader back kicker="Families and enquiries" title="Enquiries" sub="Every new lead, from first contact to an enrolled family." />
      <Figures>
        <Figure label="New" value={String(fresh)} hint="awaiting a reply" tone={fresh ? 'warn' : undefined} />
        <Figure label="In progress" value={String(open.length)} hint="open conversations" />
        <Figure label="Conversion" value={conversion === null ? '–' : `${conversion}%`} hint="enrolled vs lost" tone={conversion === null ? undefined : 'good'} />
      </Figures>
      <View style={wide ? { flexDirection: 'row', alignItems: 'flex-end', gap: 20 } : { gap: 14 }}>
        <View style={wide ? { flex: 1 } : undefined}>
          <Tabs value={filter} onChange={setFilter} tabs={tabs} accessibilityLabel="Enquiries" />
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Button title="Log an enquiry" icon="add" variant="secondary" size={wide ? undefined : 'sm'} onPress={() => router.push('/enquire')} />
        </View>
      </View>
      {list.length === 0 && filter === 'spam' ? (
        <EmptyState icon="inbox" title="No possible spam" message="Messages that look automated are kept here so that nothing genuine is lost." />
      ) : list.length === 0 ? (
        <EmptyState icon="inbox" title="No enquiries in this view" message="Enquiries from the website, the app and phone calls you log appear here." />
      ) : (
        <Group>
          {list.map((e) => (
            <EnquiryRow key={e.id} e={e} spamView={filter === 'spam'} />
          ))}
        </Group>
      )}
      {filter === 'spam' && list.length ? (
        <Txt variant="note">Possible spam is left out of the pipeline and its figures. The team was not alerted and no acknowledgement was sent.</Txt>
      ) : null}
    </Screen>
  );
}

function EnquiryRow({ e, spamView }: { e: Enquiry; spamView: boolean }) {
  const theme = useTheme();
  const stage = stageOf(e.status, theme);
  const line = [e.studentName, e.subject, e.phase, e.curriculum, e.yearGroup].filter(Boolean).join(' · ') || 'No student details yet';
  const followUp =
    e.status === 'lost'
      ? e.lostReason
        ? `Lost: ${e.lostReason}`
        : ''
      : e.nextActionAt && e.status !== 'enrolled'
        ? `Follow up ${relativeDay(`${e.nextActionAt}T12:00:00`).toLowerCase()}`
        : '';
  return (
    <GroupRow
      title={e.parentName}
      note={line}
      onPress={() => router.push({ pathname: '/manage/enquiry/[id]', params: { id: e.id } })}
      accessibilityLabel={`${e.parentName}, ${stage.label}, ${line}`}
      right={
        <View style={{ alignItems: 'flex-end', gap: 3, maxWidth: 124 }}>
          <StageLabel label={stage.label} color={stage.color} />
          <Txt variant="small">{relativeDay(e.createdAt)}</Txt>
          <Txt variant="small" style={{ textAlign: 'right' }}>
            {viaSource(e.source)}
          </Txt>
        </View>
      }>
      {e.message ? (
        <Txt variant="note" numberOfLines={2} style={{ fontStyle: 'italic', color: theme.textBody }}>
          “{e.message}”
        </Txt>
      ) : null}
      {followUp ? (
        <Txt variant="note" color={e.status === 'lost' ? 'textMuted' : 'accent'} style={{ fontWeight: '700' }}>
          {followUp}
        </Txt>
      ) : null}
      {spamView ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <SpamNote item={e} />
          <SpamActions kind="enquiry" id={e.id} status={e.spamStatus} />
        </View>
      ) : (
        <RepeatNote repeatCount={e.repeatCount} />
      )}
    </GroupRow>
  );
}
