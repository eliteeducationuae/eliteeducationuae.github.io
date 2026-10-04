import { router, Stack, useLocalSearchParams } from 'expo-router';

import { RiskNote, riskTone, useAtRisk } from '@/components/insights';
import { StudentOverview } from '@/components/student-overview';
import { Badge, Button, Card, EmptyState, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLookup, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';

export default function StudentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const students = useStudents();
  const lookup = useLookup();
  const atRisk = useAtRisk();
  if (students.isLoading || !lookup.ready) return <Loading />;
  const student = students.data?.find((s) => s.id === id);
  if (!student) return <Screen><EmptyState title="Student not found" /></Screen>;
  const family = lookup.family(student.familyId);
  const risk = atRisk.list.find((r) => r.studentId === student.id);

  return (
    <Screen>
      <Stack.Screen options={{ title: student.fullName.split(' ')[0] }} />
      {risk && me.role === 'admin' ? (
        <Card style={{ gap: Spacing.one }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="h3">Worth a conversation</Txt>
            <Badge label={`Risk ${risk.score}`} tone={riskTone(risk.score)} />
          </Row>
          <RiskNote risk={risk} />
        </Card>
      ) : null}
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
