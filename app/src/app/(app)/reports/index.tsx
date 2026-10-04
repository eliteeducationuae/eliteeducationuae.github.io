import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { reportProgress, ReportRow } from '@/components/reports';
import { Banner, Card, EmptyState, Loading, ProgressBar, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useReportCycles, useStudentReports } from '@/data/hooks';
import { useMe } from '@/data/session';
import { daysUntil, formatDate } from '@/domain/dates';

/** Tutors: the reports you need to write this round, with a progress bar. */
export default function TutorReports() {
  const me = useMe();
  const cycles = useReportCycles();
  const reports = useStudentReports();
  if (me.role === 'admin') return <Redirect href="/manage/reports" />;
  if (cycles.isLoading || reports.isLoading) return <Loading />;
  const mine = (reports.data ?? []).filter((r) => r.tutorId === me.tutorId);
  const open = (cycles.data ?? []).filter((c) => c.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const past = (cycles.data ?? []).filter((c) => c.status === 'closed' || !open.includes(c));

  return (
    <Screen onRefresh={() => reports.refetch()} refreshing={reports.isRefetching}>
      {open.length === 0 && mine.length === 0 ? (
        <EmptyState icon="doc" title="No reports to write" message="When Elite Education opens a report round, your students will appear here." />
      ) : null}
      {open.map((c) => {
        const list = mine.filter((r) => r.cycleId === c.id).sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1));
        const p = reportProgress(list);
        const days = daysUntil(c.dueDate, new Date());
        return (
          <Section key={c.id} title={c.name}>
            <Card style={{ gap: Spacing.two }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="h3">
                  {p.written} of {p.total} written
                </Txt>
                <Txt variant="muted">Due {formatDate(c.dueDate)}</Txt>
              </Row>
              <ProgressBar value={p.percent} />
              {p.written < p.total && days <= 3 ? (
                <Banner tone="warning" icon="clock">
                  {days < 0 ? 'These are overdue.' : days === 0 ? 'Due today.' : `Due in ${days} day${days === 1 ? '' : 's'}.`} Select a student, then “Draft for me” to begin.
                </Banner>
              ) : null}
            </Card>
            <View style={{ gap: Spacing.two }}>
              {list.map((r) => (
                <ReportRow key={r.id} report={r} />
              ))}
            </View>
          </Section>
        );
      })}
      {past.map((c) => {
        const list = mine.filter((r) => r.cycleId === c.id);
        if (list.length === 0) return null;
        return (
          <Section key={c.id} title={`${c.name} (closed)`}>
            <View style={{ gap: Spacing.two }}>
              {list.map((r) => (
                <ReportRow key={r.id} report={r} />
              ))}
            </View>
          </Section>
        );
      })}
    </Screen>
  );
}
