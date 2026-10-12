import { router, Tabs } from 'expo-router';
import { useState } from 'react';

import { FilterChips, RowMeta, SearchField } from '@/components/admin-people/kit';
import { ClosedToggle } from '@/components/closed-accounts';
import { useAtRisk } from '@/components/insights';
import { HeaderActions } from '@/components/role-tabs';
import { Actions, Button, EmptyState, Group, GroupRow, Loading, PageHeader, Screen } from '@/components/ui';
import { useEnrolments, useLookup, useStudents } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { CLOSED_LABEL, closedCount, closedLast, isClosed } from '@/domain/closed-accounts';
import { activeEnrolments, sameSubject, studentSubjects } from '@/domain/enrolments';

const ALL = 'All';

export default function AdminStudents() {
  const students = useStudents();
  const lookup = useLookup();
  const enrolments = useEnrolments();
  const atRisk = useAtRisk();
  const viewing = useViewing();
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<string>(ALL);
  const [showClosed, setShowClosed] = useState(false);

  const all = enrolments.data ?? [];
  // Every subject someone is currently studying, once each, in name order.
  const subjects = [...new Map(all.filter((e) => e.active).map((e) => [e.subject.trim().toLowerCase(), e.subject.trim()])).values()].sort((a, b) =>
    a.localeCompare(b),
  );
  const q = query.trim().toLowerCase();
  const matching = (students.data ?? [])
    .filter((s) => subject === ALL || activeEnrolments(all, s.id).some((e) => sameSubject(e.subject, subject)))
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
  const open = list.filter((s) => !isClosed(s)).length;
  const risky = new Set(atRisk.list.map((r) => r.student.id));

  return (
    <Screen topInset onRefresh={() => students.refetch()} refreshing={students.isRefetching}>
      <Tabs.Screen options={{ headerShown: false }} />
      <PageHeader kicker="People" title="Students" right={<HeaderActions search inbox />} />
      <SearchField placeholder="Student, parent or school" value={query} onChangeText={setQuery} />
      {subjects.length ? <FilterChips options={[ALL, ...subjects]} value={subject} onChange={setSubject} /> : null}
      {students.isLoading ? (
        <Loading />
      ) : list.length === 0 && !closed ? (
        <EmptyState icon="people" title="No students found" message="Please try another name, parent, school or subject, or add a new student." />
      ) : (
        <Group meta={`${open} ${open === 1 ? 'student' : 'students'}`}>
          {list.map((s) => {
            const family = lookup.family(s.familyId);
            const prospect = family?.status === 'prospect';
            return (
              <GroupRow
                key={s.id}
                avatar={s.fullName}
                title={s.fullName}
                note={
                  isClosed(s)
                    ? 'Kept for past lessons and invoices'
                    : [studentSubjects(all, s.id) || 'No subjects yet', s.school, family ? `Parent: ${family.parentName}` : null].filter(Boolean).join(' · ')
                }
                right={
                  isClosed(s) ? (
                    <RowMeta tag={CLOSED_LABEL} />
                  ) : (
                    <RowMeta
                      tag={prospect ? 'Prospect' : risky.has(s.id) ? 'Check on' : undefined}
                      tone={prospect ? 'accent' : 'warn'}
                      meta={s.targetGrade ? `Target ${s.targetGrade}` : undefined}
                    />
                  )
                }
                onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
              />
            );
          })}
        </Group>
      )}
      <ClosedToggle count={closed} showing={showClosed} onToggle={() => setShowClosed((v) => !v)} />
      {viewing ? null : (
        <Actions>
          <Button title="Add a student" icon="add" onPress={() => router.push('/students/edit')} />
        </Actions>
      )}
    </Screen>
  );
}
