import { router } from 'expo-router';
import { View } from 'react-native';

import { LessonCard } from '@/components/lessons';
import { Banner, EmptyState, Loading, Screen, Section, Txt } from '@/components/ui';
import { useHomework, useLessons, useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, startOfDay, toDateKey } from '@/domain/dates';
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
      <View>
        <Txt variant="title">Hi {me.fullName.split(' ')[0]}</Txt>
        <Txt variant="muted">
          {due.length ? `${due.length} homework task${due.length === 1 ? '' : 's'} to do.` : 'All homework done. Nice work!'}
        </Txt>
      </View>
      {overdue.length ? (
        <Banner tone="danger" icon="alert">
          {overdue.length} homework task{overdue.length === 1 ? ' is' : 's are'} overdue.{' '}
          <Txt variant="muted" color="accent" onPress={() => router.navigate('/student/homework')} accessibilityRole="link">
            See homework
          </Txt>
        </Banner>
      ) : null}
      <Section title="Upcoming lessons">
        {upcoming.length ? upcoming.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="family" showDate />) : <EmptyState icon="calendar" title="No lessons booked" />}
      </Section>
    </Screen>
  );
}
