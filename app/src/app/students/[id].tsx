import { router, Stack, useLocalSearchParams } from 'expo-router';

import { StudentOverview } from '@/components/student-overview';
import { Button, Card, EmptyState, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLookup, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';

export default function StudentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const students = useStudents();
  const lookup = useLookup();
  if (students.isLoading || !lookup.ready) return <Loading />;
  const student = students.data?.find((s) => s.id === id);
  if (!student) return <Screen><EmptyState title="Student not found" /></Screen>;
  const family = lookup.family(student.familyId);

  return (
    <Screen>
      <Stack.Screen options={{ title: student.fullName.split(' ')[0] }} />
      <StudentOverview student={student} />
      {family && (me.role === 'admin' || me.role === 'tutor') ? (
        <Card style={{ gap: 4 }}>
          <Txt variant="label">Family</Txt>
          <Txt variant="h3">{family.parentName}</Txt>
          <Txt variant="muted">
            {family.email}
            {family.phone ? ` · ${family.phone}` : ''}
          </Txt>
        </Card>
      ) : null}
      {me.role === 'admin' ? (
        <Row gap={Spacing.two}>
          <Button
            title="Edit details"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/students/edit', params: { id: student.id } })}
          />
          <Button
            title="Schedule"
            icon="plus"
            variant="gold"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/lesson/new', params: { studentId: student.id } })}
          />
        </Row>
      ) : null}
    </Screen>
  );
}
