import { router } from 'expo-router';

import { GreetingCard, NextLessonCard, QuickActions } from '@/components/dashboard';
import { LessonCard } from '@/components/lessons';
import { Banner, EmptyState, Loading, Screen, Section, Txt } from '@/components/ui';
import { useHomework, useLessons, useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, startOfDay, toDateKey } from '@/domain/dates';
import { countWords, greetingLine } from '@/domain/greeting';
import { byStart } from '@/domain/scheduling';

const today = startOfDay(new Date());

export default function StudentHome() {
  const me = useMe();
  const lookup = useLookup();
  const lessons = useLessons(today, addDays(today, 28));
  const homework = useHomework(me.studentId);
  if (lessons.isLoading || !lookup.ready) return <Loading />;
  const now = new Date();
  const upcoming = (lessons.data ?? []).filter((l) => l.status === 'scheduled' && new Date(l.end) > now).sort(byStart);
  const due = (homework.data ?? []).filter((h) => !h.done);
  const overdue = due.filter((h) => h.dueDate < toDateKey(now));

  return (
    <Screen onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <GreetingCard
        date={now}
        title={greetingLine(now, me.fullName.split(' ')[0])}
        subtitle={
          due.length
            ? `You have ${countWords(due.length, 'homework task')} to complete.`
            : 'All homework is complete. Well done.'
        }
      />
      {upcoming[0] ? <NextLessonCard lesson={upcoming[0]} lookup={lookup} perspective="family" now={now} /> : null}
      <QuickActions
        actions={[
          { icon: 'book', label: 'Homework', badge: due.length || undefined, onPress: () => router.navigate('/student/homework') },
          { icon: 'trend', label: 'Progress', onPress: () => router.navigate('/student/progress') },
        ]}
      />
      {overdue.length ? (
        <Banner tone="danger" icon="alert">
          {overdue.length === 1 ? 'One homework task is overdue.' : `${overdue.length} homework tasks are overdue.`}{' '}
          <Txt variant="muted" color="accent" onPress={() => router.navigate('/student/homework')} accessibilityRole="link">
            View homework
          </Txt>
        </Banner>
      ) : null}
      <Section title="Upcoming lessons">
        {upcoming.length ? upcoming.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="family" showDate />) : <EmptyState icon="calendar" title="No lessons booked" message="Your next lessons will appear here as soon as they are booked." />}
      </Section>
    </Screen>
  );
}
