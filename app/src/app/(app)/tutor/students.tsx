import { router } from 'expo-router';

import { HeaderActions } from '@/components/role-tabs';
import { Actions, Button, EmptyState, Group, GroupRow, Loading, PageHeader, Screen } from '@/components/ui';
import { useEnrolments, useHandovers, useLookup, useStudents } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { withoutClosed } from '@/domain/closed-accounts';
import { studentSubjects } from '@/domain/enrolments';
import { countWords } from '@/domain/greeting';

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The tutor's current students (the data source shows only students they teach now). */
export default function TutorStudents() {
  const me = useMe();
  const viewing = !!useViewing();
  const students = useStudents();
  const enrolments = useEnrolments();
  const handovers = useHandovers();
  const lookup = useLookup();
  if (students.isLoading) return <Loading />;
  const list = withoutClosed(students.data).sort((a, b) => a.fullName.localeCompare(b.fullName));
  // A student moving to another tutor carries a short reminder.
  const moving = new Map((handovers.data ?? []).filter((h) => h.fromTutorId === me.tutorId).map((h) => [h.studentId, h]));
  return (
    <Screen topInset onRefresh={() => students.refetch()} refreshing={students.isRefetching}>
      <PageHeader
        kicker="Students"
        title="My students"
        sub={list.length ? `${capitalise(countWords(list.length, 'student'))} this term.` : undefined}
        right={<HeaderActions search />}
      />
      {list.length === 0 ? (
        <EmptyState icon="group" title="No students yet" message="Your students will appear here as soon as lessons with them are booked." />
      ) : (
        <Group>
          {list.map((s) => {
            const h = moving.get(s.id);
            const to = h ? lookup.tutor(h.toTutorId)?.fullName : undefined;
            return (
              <GroupRow
                key={s.id}
                avatar={s.fullName}
                title={s.fullName}
                note={[
                  studentSubjects(enrolments.data ?? [], s.id) || 'No subjects yet',
                  s.targetGrade ? `Target ${s.targetGrade}` : null,
                  h ? `moving to ${to ?? 'a new tutor'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
              />
            );
          })}
        </Group>
      )}
      <Actions>
        {!viewing ? <Button title="Set homework" icon="assignment" onPress={() => router.push('/homework/new')} /> : null}
        <Button title="Resource library" icon="folder" variant="secondary" onPress={() => router.push('/resources')} />
      </Actions>
    </Screen>
  );
}
