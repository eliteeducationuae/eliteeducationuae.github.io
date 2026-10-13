import { router } from 'expo-router';

import { HandoverBanners } from '@/components/handover';
import { PlansDueCard } from '@/components/plans';
import { HeaderActions } from '@/components/role-tabs';
import { isCancelled, LessonRow, longDay, monthName, needsRecording, studentFirstNames, useHandbookDue, useMyLessons, useMyTutor, weekdayLong } from '@/components/tutor/common';
import { DecisionCard, NextLessonNoir, QuickTiles, RecordNowButton } from '@/components/tutor/today-blocks';
import { Columns, Figure, Figures, Group, Hero, Loading, Notice, Screen } from '@/components/ui';
import { ClearanceBanner } from '@/components/vetting';
import { useBids, useEnrolments, useLookup, useOpportunities, useSettings } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatAED, tutorEarnings } from '@/domain/billing';
import { addDays, formatTime, isSameDay, minutesBetween, startOfDay, startOfMonth, startOfWeek } from '@/domain/dates';
import { countWords, greetingLine } from '@/domain/greeting';
import { plural } from '@/lib/id';

export default function TutorToday() {
  const me = useMe();
  const viewing = !!useViewing();
  const lookup = useLookup();
  const tutor = useMyTutor();
  const settings = useSettings();
  const enrolments = useEnrolments();
  const lessons = useMyLessons();
  const opportunities = useOpportunities();
  const bids = useBids();
  const handbook = useHandbookDue();
  const now = new Date();

  if (lessons.isLoading || !lookup.ready) return <Loading />;
  const mine = lessons.mine;
  const today = startOfDay(now);
  const toRecord = mine.filter((l) => needsRecording(l, now));
  const todays = mine.filter((l) => isSameDay(new Date(l.start), now) && !isCancelled(l));
  const upcoming = mine.filter((l) => l.status === 'scheduled' && new Date(l.start) >= addDays(today, 1) && new Date(l.start) < addDays(today, 8));
  const weekStart = startOfWeek(now);
  const week = mine.filter((l) => new Date(l.start) >= weekStart && new Date(l.start) < addDays(weekStart, 7) && !isCancelled(l));
  const weekHours = week.reduce((s, l) => s + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60;
  const next = mine.find((l) => l.status === 'scheduled' && new Date(l.end) > now);
  // This month's pay so far: lessons recorded (and paid no-shows), at the tutor's own rate.
  const monthStart = startOfMonth(now);
  const monthLessons = mine.filter((l) => new Date(l.start) >= monthStart && new Date(l.start) < now);
  const earned = tutor && settings.data ? tutorEarnings(tutor, monthLessons, settings.data, enrolments.data ?? []) : null;
  const fresh = (opportunities.data ?? []).filter((o) => o.status === 'open' && !(bids.data ?? []).some((b) => b.opportunityId === o.id && b.tutorId === me.tutorId));
  const first = toRecord[0];

  const line = toRecord.length
    ? `You have ${countWords(todays.length, 'lesson')} today and ${countWords(toRecord.length, 'lesson')} to record.`
    : `You have ${countWords(todays.length, 'lesson')} today. All of your lessons are recorded.`;

  const recordPrompt = first
    ? (() => {
        const student = lookup.student(first.studentIds[0]);
        const family = student ? lookup.family(student.familyId)?.name : undefined;
        const isToday = isSameDay(new Date(first.start), now);
        return (
          <DecisionCard
            kicker="To record"
            from={`${isToday ? 'Today' : weekdayLong(first.start)} ${formatTime(first.start)}`}
            title={`Record ${isToday ? 'today’s' : `${weekdayLong(first.start)}’s`} lesson with ${studentFirstNames(first, lookup)}`}
            body={`${family ? `The ${family} family is` : 'The family is'} waiting for the note, and the lesson is billed and paid once it is recorded.`}>
            {!viewing ? <RecordNowButton lessonId={first.id} /> : null}
          </DecisionCard>
        );
      })()
    : null;

  return (
    <Screen topInset onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <Hero kicker={longDay(now)} title={`${greetingLine(now, me.fullName.split(' ')[0])}.`} line={line} right={<HeaderActions search />} />
      {recordPrompt}
      {next ? <NextLessonNoir lesson={next} now={now} viewing={viewing} /> : null}
      <QuickTiles
        tiles={[
          {
            icon: 'edit_note',
            label: 'Record',
            dot: !!first,
            dotLabel: `${plural(toRecord.length, 'lesson')} to record`,
            onPress: () => (first ? router.push({ pathname: '/complete/[id]', params: { id: first.id } }) : router.navigate('/tutor/calendar')),
          },
          { icon: 'schedule', label: 'Availability', onPress: () => router.push('/availability') },
          { icon: 'payments', label: 'My pay', onPress: () => router.push('/pay') },
          { icon: 'school', label: 'Opportunities', dot: fresh.length > 0, dotLabel: 'new students waiting', onPress: () => router.push('/opportunities') },
        ]}
      />
      <Figures>
        <Figure label="Today" value={String(todays.length)} hint={todays.length === 1 ? 'lesson' : 'lessons'} />
        <Figure label="This week" value={plural(Number(weekHours.toFixed(1)), 'hour')} hint={plural(week.length, 'lesson')} onPress={() => router.navigate('/tutor/calendar')} />
        {earned ? (
          <Figure
            label={`${monthName(now)} so far`}
            value={formatAED(earned.amount)}
            hint={`${plural(earned.lessons, 'lesson')} taught`}
            tone="good"
            onPress={() => router.push('/pay')}
          />
        ) : null}
      </Figures>
      <ClearanceBanner />
      {handbook.due ? (
        <Notice tone="info" icon="menu_book" title={`Tutor handbook, version ${handbook.version}`} link={{ label: 'Read the handbook', onPress: () => router.push('/handbook') }}>
          {(handbook.version ?? 1) > 1 ? 'The handbook has been updated. Please read it and acknowledge it.' : 'Please read the handbook and acknowledge it.'}
        </Notice>
      ) : null}
      <HandoverBanners />
      {fresh.length ? (
        <Notice
          tone="info"
          icon="school"
          title={fresh.length === 1 ? 'A new student is looking for a tutor' : `${fresh.length} new students are looking for a tutor`}
          link={{ label: 'View opportunities', onPress: () => router.push('/opportunities') }}>
          {fresh.length === 1
            ? [fresh[0].title, fresh[0].location, `${formatAED(fresh[0].payRate)} an hour`].filter(Boolean).join(' · ')
            : 'Put yourself forward for the ones that suit you. The pay is shown on each role.'}
        </Notice>
      ) : null}
      <Columns>
        {toRecord.length ? (
          <Group title={`To record (${toRecord.length})`} note="Please record these lessons so that families receive their notes and the lessons are billed.">
            {toRecord.map((l) => (
              <LessonRow key={l.id} lesson={l} now={now} />
            ))}
          </Group>
        ) : null}
        <Group title="Today" link={{ label: 'Calendar', onPress: () => router.navigate('/tutor/calendar') }} note={todays.length ? undefined : 'No lessons today. Your next lessons appear here as soon as they are booked.'}>
          {todays.map((l) => (
            <LessonRow key={l.id} lesson={l} now={now} />
          ))}
        </Group>
        <Group title="Coming up" note={upcoming.length ? undefined : 'Nothing booked for the coming week yet.'}>
          {upcoming.slice(0, 6).map((l) => (
            <LessonRow key={l.id} lesson={l} now={now} />
          ))}
        </Group>
        <PlansDueCard lessons={mine} />
      </Columns>
    </Screen>
  );
}
