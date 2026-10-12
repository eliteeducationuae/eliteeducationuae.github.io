import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { font } from '@/constants/theme';
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
  daysLeftLabel,
  openTasks,
  overdueKeyDates,
  targetSummaryLine,
  upcomingKeyDates,
} from '@/domain/admissions';
import { toDateKey } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Actions, Button, EmptyState, ErrorNote, Figure, Figures, Loading, Notice, PageHeader, Prose, Screen, Txt } from '../ui';
import { caseStatusColor } from './case-card';
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
import { adviserLine, adviserName, firstName, formatDateKey, type CaseTab } from './format';

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
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back={{ fallback: '/admissions' }} kicker="Admissions" title="Case not found" />
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
  // On a phone the other tabs get a compact header (no sub-line or figures) so their content starts high.
  const compact = !overview && width < 600;
  const next = [...overdueKeyDates(data.dates, now), ...upcomingKeyDates(data.dates, now, 3650)][0];
  const open = openTasks(data.tasks, manager ? undefined : 'family');
  const statusColor = caseStatusColor(c.status, theme);
  return (
    <Screen topInset onRefresh={refresh} refreshing={caseQ.isRefetching}>
      <Stack.Screen options={{ headerShown: false, title: `${firstName(studentName)} · Admissions` }} />
      <PageHeader
        back={{ fallback: '/admissions' }}
        kicker={`Admissions · ${CASE_KIND_LABELS[c.kind]}`}
        title={studentName}
        right={
          <Text style={[font('sans', 'bold'), styles.status, { color: statusColor }]} accessibilityLabel={`Status: ${CASE_STATUS_LABELS[c.status]}`}>
            {CASE_STATUS_LABELS[c.status]}
          </Text>
        }
        sub={
          compact ? undefined : (
            <View style={{ gap: 4 }}>
              <Txt style={[font('serif'), { fontSize: 19, lineHeight: 26 }]}>
                {c.title}
              </Txt>
              <Txt variant="muted">{[c.entryYear ? `Entry ${c.entryYear}` : '', adviserLine(data.adviser)].filter(Boolean).join(' · ')}</Txt>
            </View>
          )
        }
      />
      {/* The summary, figures and edit button belong to the overview; other tabs keep the header short. */}
      {overview && (c.status === 'on-hold' || c.status === 'closed') ? (
        <Notice tone={c.status === 'on-hold' ? 'warn' : 'info'} title={CASE_STATUS_LABELS[c.status]}>
          {c.status === 'on-hold' ? 'This case is paused for now.' : 'This case is closed.'}
        </Notice>
      ) : null}
      {overview ? (
        <Figures>
          <Figure
            label="Next date"
            value={next ? formatDateKey(next.dueOn).replace(/ \d{4}$/, '') : '—'}
            hint={next ? daysLeftLabel(next.dueOn, now) : 'None set'}
            tone={next && next.dueOn < toDateKey(now) ? 'bad' : undefined}
          />
          <Figure label={manager ? 'Tasks open' : 'Family tasks'} value={String(open.length)} hint={open.length ? 'to do' : 'All done'} tone={open.length ? 'warn' : 'good'} />
          <Figure label={c.kind.endsWith('university') ? 'Choices' : 'Shortlist'} value={String(data.targets.length)} hint={targetSummaryLine(data.targets, c.kind)} />
          {me.role === 'admin' && awaiting ? <Figure label="To review" value={String(awaiting)} hint="update awaiting approval" tone="highlight" onPress={() => setTab('updates')} /> : null}
        </Figures>
      ) : null}
      {overview && c.summary ? <Prose paragraphs={[c.summary]} /> : null}
      {overview && manager ? (
        <Actions>
          <Button
            title={me.role === 'admin' ? 'Edit case' : 'Edit summary and status'}
            icon="edit"
            variant="secondary"
            onPress={() => router.push({ pathname: '/admissions/edit', params: { id: c.id } })}
          />
        </Actions>
      ) : null}

      <CaseTabs value={tab} onChange={setTab} counts={counts} />
      <Panel {...data} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
});
