import { Redirect, router, Stack } from 'expo-router';

import { REPORT_STATUS, reportProgress, reportSubject, sortReports } from '@/components/reports';
import { EmptyState, Group, GroupRow, Loading, Notice, PageHeader, Screen } from '@/components/ui';
import { useEnrolments, useLookup, useReportCycles, useStudentReports } from '@/data/hooks';
import { useMe } from '@/data/session';
import { daysUntil, formatDate } from '@/domain/dates';
import type { StudentReport } from '@/domain/types';

/** Tutors: the reports you need to write this round. */
export default function TutorReports() {
  const me = useMe();
  const cycles = useReportCycles();
  const reports = useStudentReports();
  const enrolments = useEnrolments();
  const lookup = useLookup();
  if (me.role === 'admin') return <Redirect href="/manage/reports" />;
  if (cycles.isLoading || reports.isLoading) return <Loading />;
  // Each tutor sees their own reports, grouped by student and then subject.
  const mine = sortReports(
    (reports.data ?? []).filter((r) => r.tutorId === me.tutorId),
    (id) => lookup.student(id)?.fullName ?? '',
    enrolments.data ?? [],
  );
  const open = (cycles.data ?? []).filter((c) => c.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const past = (cycles.data ?? []).filter((c) => c.status === 'closed' || !open.includes(c));
  const row = (r: StudentReport) => {
    const s = REPORT_STATUS[r.status];
    const student = lookup.student(r.studentId);
    const { subject } = reportSubject(r, enrolments.data ?? []);
    return (
      <GroupRow
        key={r.id}
        avatar={student?.fullName ?? 'Student'}
        title={student?.fullName ?? 'Student'}
        note={[subject ?? student?.curriculum, r.status === 'draft' ? 'We prepare a draft for you' : null].filter(Boolean).join(' · ')}
        value={s.label}
        valueTone={r.status === 'draft' ? 'accent' : r.status === 'published' ? 'good' : 'muted'}
        valueSize={12.5}
        onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })}
      />
    );
  };

  return (
    <Screen topInset onRefresh={() => reports.refetch()} refreshing={reports.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Reports" title="Reports to write" sub="Open a student, then “Draft for me” to start from this term’s lessons, notes and ratings." />
      {open.length === 0 && mine.length === 0 ? (
        <EmptyState icon="description" title="No reports to write" message="When Elite Education opens a report round, your students will appear here." />
      ) : null}
      {open.map((c) => {
        const list = mine.filter((r) => r.cycleId === c.id).sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1));
        const p = reportProgress(list);
        const days = daysUntil(c.dueDate, new Date());
        return [
          p.written < p.total && days <= 3 ? (
            <Notice key={`${c.id}-due`} tone="warn">
              {`${days < 0 ? 'These reports are overdue.' : days === 0 ? 'These reports are due today.' : `These reports are due in ${days} day${days === 1 ? '' : 's'}.`}`}
            </Notice>
          ) : null,
          <Group key={c.id} title={c.name} meta={`Due ${formatDate(c.dueDate)}`}>
            <GroupRow icon="description" title={`${p.written} of ${p.total} written`} progress={p.percent} titleWeight="regular" />
            {list.map(row)}
          </Group>,
        ];
      })}
      {past.map((c) => {
        const list = mine.filter((r) => r.cycleId === c.id);
        if (list.length === 0) return null;
        return (
          <Group key={c.id} title={`${c.name} (closed)`}>
            {list.map(row)}
          </Group>
        );
      })}
    </Screen>
  );
}
