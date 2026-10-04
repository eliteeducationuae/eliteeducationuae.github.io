import { router } from 'expo-router';
import { View } from 'react-native';

import { LessonCard } from '@/components/lessons';
import { Banner, EmptyState, Loading, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { useBids, useLessons, useLookup, useOpportunities } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, formatDay, isSameDay, minutesBetween, startOfDay, startOfWeek } from '@/domain/dates';
import { byStart } from '@/domain/scheduling';
import { plural } from '@/lib/id';

const today = startOfDay(new Date());

export default function TutorToday() {
  const me = useMe();
  const lookup = useLookup();
  const lessons = useLessons(addDays(today, -60), addDays(today, 8));
  const opportunities = useOpportunities();
  const bids = useBids();
  const now = new Date();

  if (lessons.isLoading || !lookup.ready) return <Loading />;
  const mine = (lessons.data ?? []).filter((l) => l.tutorId === me.tutorId).sort(byStart);
  const toRecord = mine.filter((l) => l.status === 'scheduled' && new Date(l.end) < now);
  const todays = mine.filter((l) => isSameDay(new Date(l.start), now));
  const upcoming = mine.filter((l) => l.status === 'scheduled' && new Date(l.start) >= addDays(today, 1));
  const week = mine.filter((l) => new Date(l.start) >= startOfWeek(now) && new Date(l.start) < addDays(startOfWeek(now), 7) && l.status !== 'cancelled' && l.status !== 'late-cancel');
  const weekHours = week.reduce((s, l) => s + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60;

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <View>
        <Txt variant="muted">{formatDay(now)}</Txt>
        <Txt variant="title">Hi {me.fullName.split(' ')[0]}</Txt>
      </View>
      <StatGrid>
        <Stat label="Today" value={String(todays.filter((l) => l.status !== 'cancelled').length)} hint={todays.length === 1 ? 'lesson' : 'lessons'} />
        <Stat label="This week" value={`${weekHours.toFixed(1)}h`} hint={plural(week.length, 'lesson')} onPress={() => router.push('/pay')} />
      </StatGrid>
      {(() => {
        const fresh = (opportunities.data ?? []).filter((o) => o.status === 'open' && !(bids.data ?? []).some((b) => b.opportunityId === o.id && b.tutorId === me.tutorId));
        return fresh.length ? (
          <Banner icon="school">
            {fresh.length === 1 ? `New student: ${fresh[0].title}.` : `${fresh.length} new students are looking for a tutor.`}{' '}
            <Txt variant="muted" color="accent" onPress={() => router.push('/opportunities')}>
              Take a look
            </Txt>
          </Banner>
        ) : null;
      })()}
      {toRecord.length ? (
        <Section title={`To record (${toRecord.length})`}>
          <Banner tone="warning" icon="alert">
            Record these so families get their notes and lessons are billed.
          </Banner>
          {toRecord.map((l) => (
            <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" showDate />
          ))}
        </Section>
      ) : null}
      <Section title="Today">
        {todays.length ? todays.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" />) : <EmptyState icon="calendar" title="No lessons today" />}
      </Section>
      <Section title="Coming up">
        {upcoming.length ? upcoming.slice(0, 8).map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" showDate />) : <EmptyState icon="calendar" title="Nothing booked this week" />}
      </Section>
    </Screen>
  );
}
