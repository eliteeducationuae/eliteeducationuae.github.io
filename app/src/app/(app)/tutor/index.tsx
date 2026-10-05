import { router } from 'expo-router';

import { GreetingCard, NextLessonCard, QuickActions } from '@/components/dashboard';
import { HandoverBanners } from '@/components/handover';
import { LessonCard } from '@/components/lessons';
import { PlansDueCard } from '@/components/plans';
import { Banner, EmptyState, Loading, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { useBids, useLessons, useLookup, useOpportunities } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, isSameDay, minutesBetween, startOfDay, startOfWeek } from '@/domain/dates';
import { countWords, greetingLine } from '@/domain/greeting';
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
  const todayCount = todays.filter((l) => l.status !== 'cancelled' && l.status !== 'late-cancel').length;
  const next = mine.find((l) => l.status === 'scheduled' && new Date(l.end) > now);
  const weekHours = week.reduce((s, l) => s + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60;

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <GreetingCard
        date={now}
        title={greetingLine(now, me.fullName.split(' ')[0])}
        subtitle={
          toRecord.length
            ? `You have ${countWords(todayCount, 'lesson')} today and ${countWords(toRecord.length, 'lesson')} to record.`
            : `You have ${countWords(todayCount, 'lesson')} today. All of your lessons are recorded.`
        }
      />
      {next ? <NextLessonCard lesson={next} lookup={lookup} perspective="tutor" now={now} /> : null}
      <QuickActions
        actions={[
          {
            icon: 'check',
            label: 'Record lessons',
            badge: toRecord.length || undefined,
            onPress: () =>
              toRecord.length
                ? router.push({ pathname: '/complete/[id]', params: { id: toRecord[0].id } })
                : router.navigate('/tutor/calendar'),
          },
          { icon: 'clock', label: 'Availability', onPress: () => router.push('/availability') },
          { icon: 'money', label: 'My pay', onPress: () => router.push('/pay') },
          { icon: 'school', label: 'Opportunities', onPress: () => router.push('/opportunities') },
        ]}
      />
      <StatGrid>
        <Stat label="Today" value={String(todays.filter((l) => l.status !== 'cancelled').length)} hint={todays.length === 1 ? 'lesson' : 'lessons'} />
        <Stat label="This week" value={plural(Number(weekHours.toFixed(1)), 'hour')} hint={plural(week.length, 'lesson')} onPress={() => router.push('/pay')} />
      </StatGrid>
      <PlansDueCard lessons={mine} />
      <HandoverBanners />
      {(() => {
        const fresh = (opportunities.data ?? []).filter((o) => o.status === 'open' && !(bids.data ?? []).some((b) => b.opportunityId === o.id && b.tutorId === me.tutorId));
        return fresh.length ? (
          <Banner icon="school">
            {fresh.length === 1 ? `A new student is looking for a tutor: ${fresh[0].title}.` : `${fresh.length} new students are looking for a tutor.`}{' '}
            <Txt variant="muted" color="accent" onPress={() => router.push('/opportunities')}>
              View opportunities
            </Txt>
          </Banner>
        ) : null;
      })()}
      {toRecord.length ? (
        <Section title={`To record (${toRecord.length})`}>
          <Banner tone="warning" icon="alert">
            Please record these lessons so that families receive their notes and the lessons are billed.
          </Banner>
          {toRecord.map((l) => (
            <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" showDate />
          ))}
        </Section>
      ) : null}
      <Section title="Today">
        {todays.length ? todays.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" />) : <EmptyState icon="calendar" title="No lessons scheduled today" message="Your next lessons will appear here as soon as they are booked." />}
      </Section>
      <Section title="Coming up">
        {upcoming.length ? upcoming.slice(0, 8).map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" showDate />) : <EmptyState icon="calendar" title="Nothing booked for the coming week" message="New bookings will appear here as soon as they are confirmed." />}
      </Section>
    </Screen>
  );
}
