import { router } from 'expo-router';
import { useState } from 'react';

import { View } from 'react-native';

import { ClosedToggle } from '@/components/closed-accounts';
import { Avatar, Badge, Button, Chip, EmptyState, Field, ListItem, Loading, Row, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useEnrolments, useLookup, useStudents } from '@/data/hooks';
import { CLOSED_LABEL, closedCount, closedLast, isClosed } from '@/domain/closed-accounts';
import { activeEnrolments, sameSubject, studentSubjects } from '@/domain/enrolments';

export default function AdminStudents() {
  const students = useStudents();
  const lookup = useLookup();
  const enrolments = useEnrolments();
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const all = enrolments.data ?? [];
  // Every subject someone is currently studying, once each, in name order.
  const subjects = [...new Map(all.filter((e) => e.active).map((e) => [e.subject.trim().toLowerCase(), e.subject.trim()])).values()].sort((a, b) =>
    a.localeCompare(b),
  );
  const q = query.trim().toLowerCase();
  const matching = (students.data ?? [])
    .filter((s) => !subject || activeEnrolments(all, s.id).some((e) => sameSubject(e.subject, subject)))
    .filter(
      (s) =>
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        (lookup.family(s.familyId)?.parentName.toLowerCase().includes(q) ?? false) ||
        (s.school?.toLowerCase().includes(q) ?? false),
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  // Records of closed accounts are kept for invoices; they sit last, behind "Show closed".
  const list = closedLast(matching, showClosed);
  const closed = closedCount(matching);

  return (
    <Screen
      onRefresh={() => students.refetch()}
      refreshing={students.isRefetching}
      footer={<Button title="Add student" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/students/edit')} />}>
      <Field label="Search" placeholder="Student, parent or school" value={query} onChangeText={setQuery} autoCorrect={false} />
      {subjects.length ? (
        <Row gap={Spacing.one} wrap>
          <Chip label="All" selected={!subject} onPress={() => setSubject(null)} />
          {subjects.map((x) => (
            <Chip key={x} label={x} selected={sameSubject(subject ?? undefined, x)} onPress={() => setSubject(x)} />
          ))}
        </Row>
      ) : null}
      {students.isLoading ? (
        <Loading />
      ) : list.length === 0 && !closed ? (
        <EmptyState icon="people" title="No students found" message="Please try another name, parent, school or subject, or add a new student." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((s) => (
            <ListItem
              key={s.id}
              title={s.fullName}
              subtitle={
                isClosed(s)
                  ? 'Kept for past lessons and invoices'
                  : `${studentSubjects(all, s.id) || 'No subjects yet'}${s.school ? ` · ${s.school}` : ''}\nParent: ${lookup.family(s.familyId)?.parentName ?? '–'}`
              }
              left={<Avatar name={s.fullName} />}
              right={isClosed(s) ? <Badge label={CLOSED_LABEL} /> : s.targetGrade ? <Badge label={`Target ${s.targetGrade}`} tone="info" /> : undefined}
              onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
            />
          ))}
          <ClosedToggle count={closed} showing={showClosed} onToggle={() => setShowClosed((v) => !v)} />
        </View>
      )}
    </Screen>
  );
}
