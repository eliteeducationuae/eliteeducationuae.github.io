import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import {
  useAdmissionsCase,
  useAdmissionsDocuments,
  useAdmissionsEvents,
  useAdmissionsKeyDates,
  useAdmissionsTargets,
  useAdmissionsTasks,
  useAdvisoryUpdates,
  useLookup,
} from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  canManageCase,
  CASE_KIND_LABELS,
  CASE_STATUS_LABELS,
  openTasks,
  overdueKeyDates,
} from '@/domain/admissions';
import { useTheme } from '@/hooks/use-theme';

import { Badge, Button, Card, EmptyState, ErrorNote, Loading, Row, Screen, Txt } from '../ui';
import {
  DatesPanel,
  DocumentsPanel,
  OverviewPanel,
  TargetsPanel,
  TasksPanel,
  TimelinePanel,
  UpdatesPanel,
  type CaseData,
} from './case-panels';
import { CaseTabs } from './case-tabs';
import { adviserLine, adviserName, caseStatusTone, firstName, type CaseTab } from './format';

/** The whole case page: a noir header, then seven tabs. `initialTab` comes from `?tab=` in deep links. */
export function CaseDetail({ id, initialTab }: { id: string; initialTab: CaseTab }) {
  const me = useMe();
  const theme = useTheme();
  const lookup = useLookup();
  const caseQ = useAdmissionsCase(id);
  const targets = useAdmissionsTargets(id);
  const dates = useAdmissionsKeyDates({ caseId: id });
  const tasks = useAdmissionsTasks(id);
  const documents = useAdmissionsDocuments(id);
  const updates = useAdvisoryUpdates(id);
  const events = useAdmissionsEvents(id);
  const [tab, setTab] = useState<CaseTab>(initialTab);
  const [now] = useState(() => new Date());
  const { width } = useWindowDimensions();

  if (caseQ.isLoading || !lookup.ready) return <Loading />;
  const c = caseQ.data;
  if (!c) {
    return (
      <Screen>
        <ErrorNote error={caseQ.error} />
        <EmptyState icon="school" title="Case not found" message="This admissions case may have been closed, or it is not shared with you." />
      </Screen>
    );
  }

  const student = lookup.student(c.studentId);
  const studentName = student?.fullName ?? 'Student';
  const manager = canManageCase(me, c);
  const data: CaseData = {
    c,
    me,
    student,
    studentName,
    adviser: adviserName(c, lookup),
    targets: targets.data ?? [],
    dates: dates.data ?? [],
    tasks: tasks.data ?? [],
    documents: documents.data ?? [],
    updates: updates.data ?? [],
    events: events.data ?? [],
    now,
    manager,
    isAdmin: me.role === 'admin',
    setTab,
  };
  const awaiting = data.updates.filter((u) => u.status === 'submitted').length;
  const counts: Partial<Record<CaseTab, number>> = {
    dates: overdueKeyDates(data.dates, now).length || undefined,
    tasks: openTasks(data.tasks, manager ? undefined : 'family').length || undefined,
    updates: me.role === 'admin' ? awaiting || undefined : undefined,
  };
  const refresh = () => {
    caseQ.refetch();
    targets.refetch();
    dates.refetch();
    tasks.refetch();
    documents.refetch();
    updates.refetch();
    events.refetch();
  };

  const Panel = {
    overview: OverviewPanel,
    targets: TargetsPanel,
    dates: DatesPanel,
    tasks: TasksPanel,
    documents: DocumentsPanel,
    updates: UpdatesPanel,
    timeline: TimelinePanel,
  }[tab];

  const overview = tab === 'overview';
  // On a phone the other tabs get a compact header (one label line, a shorter title) so their content starts high.
  const compact = !overview && width < 600;
  return (
    <Screen onRefresh={refresh} refreshing={caseQ.isRefetching}>
      <Stack.Screen options={{ title: `${firstName(studentName)} · Admissions` }} />
      <Card variant="hero" style={{ gap: compact ? Spacing.one : Spacing.two, padding: compact ? Spacing.three : Spacing.four }}>
        <Row style={{ justifyContent: 'space-between', alignItems: compact ? 'center' : 'flex-start' }} gap={Spacing.two}>
          <Txt variant="label" style={{ flex: 1 }} numberOfLines={compact ? 1 : undefined}>
            {studentName} · {CASE_KIND_LABELS[c.kind]}
          </Txt>
          <Badge label={CASE_STATUS_LABELS[c.status]} tone={caseStatusTone(c.status)} />
        </Row>
        <Txt
          variant="title"
          style={overview ? { fontSize: 26, lineHeight: 33 } : compact ? { fontSize: 19, lineHeight: 25 } : { fontSize: 21, lineHeight: 27 }}
          numberOfLines={compact ? 2 : undefined}
          accessibilityRole="header">
          {c.title}
        </Txt>
        {compact ? null : (
          <>
            <View style={[styles.rule, { backgroundColor: theme.gold }]} />
            <Txt variant="muted">
              {[c.entryYear ? `Entry ${c.entryYear}` : '', adviserLine(data.adviser)].filter(Boolean).join(' · ')}
            </Txt>
          </>
        )}
        {/* The summary and edit button belong to the overview; other tabs keep the header short so their content shows first. */}
        {overview && c.summary ? <Txt>{c.summary}</Txt> : null}
        {overview && manager ? (
          <Row gap={Spacing.two} style={{ marginTop: Spacing.one }}>
            <Button
              title={me.role === 'admin' ? 'Edit case' : 'Edit summary and status'}
              size="sm"
              variant="outline"
              onPress={() => router.push({ pathname: '/admissions/edit', params: { id: c.id } })}
            />
          </Row>
        ) : null}
      </Card>

      <CaseTabs value={tab} onChange={setTab} counts={counts} />
      <Panel {...data} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rule: { width: 28, height: 2 },
});
