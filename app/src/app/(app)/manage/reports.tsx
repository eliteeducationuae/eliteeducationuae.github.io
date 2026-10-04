import { useState } from 'react';
import { View } from 'react-native';

import { reportProgress, ReportRow, sortReports } from '@/components/reports';
import { Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, ProgressBar, Row, Screen, Section, Segmented, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useLookup, useReportCycles, useStudentReports } from '@/data/hooks';
import { addDays, formatDate, toDateKey } from '@/domain/dates';
import type { StudentReport } from '@/domain/types';
import { confirm } from '@/lib/confirm';

type Filter = 'submitted' | 'approved' | 'draft' | 'published';

/** Admin: open a report round, watch tutors' progress, review and send reports to families. */
export default function AdminReports() {
  const cycles = useReportCycles();
  const reports = useStudentReports();
  const lookup = useLookup();
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('submitted');
  const [creating, setCreating] = useState(false);
  const publish = useAction(source.setReportStatus);
  const enrolments = useEnrolments();
  if (cycles.isLoading || reports.isLoading || !lookup.ready) return <Loading />;

  const sorted = [...(cycles.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cycle = sorted.find((c) => c.id === cycleId) ?? sorted[0];
  const inCycle = (reports.data ?? []).filter((r) => r.cycleId === cycle?.id);
  const count = (f: Filter) => inCycle.filter((r) => r.status === f).length;
  const list = sortReports(
    inCycle.filter((r) => r.status === filter),
    (id) => lookup.student(id)?.fullName ?? '',
    enrolments.data ?? [],
  );
  const byTutor = new Map<string, StudentReport[]>();
  for (const r of inCycle) byTutor.set(r.tutorId, [...(byTutor.get(r.tutorId) ?? []), r]);
  const approved = inCycle.filter((r) => r.status === 'approved');

  async function publishAll() {
    for (const r of approved) await publish.mutateAsync([r.id, 'published']);
  }

  return (
    <Screen onRefresh={() => reports.refetch()} refreshing={reports.isRefetching}>
      {creating || sorted.length === 0 ? (
        <NewCycle onDone={() => setCreating(false)} onCancel={sorted.length ? () => setCreating(false) : undefined} />
      ) : (
        <Button title="Open a new report round" icon="plus" variant="secondary" onPress={() => setCreating(true)} />
      )}

      {cycle ? (
        <>
          {sorted.length > 1 ? (
            <Row style={{ gap: Spacing.one, flexWrap: 'wrap' }}>
              {sorted.slice(0, 6).map((c) => (
                <Chip key={c.id} label={c.name} selected={c.id === cycle.id} onPress={() => setCycleId(c.id)} />
              ))}
            </Row>
          ) : null}
          <Card style={{ gap: Spacing.two }}>
            <Txt variant="h2">{cycle.name}</Txt>
            <Txt variant="muted">
              Lessons since {formatDate(cycle.startsOn)} · due {formatDate(cycle.dueDate)}
            </Txt>
            <ProgressBar value={reportProgress(inCycle).percent} />
            <Txt variant="small">
              {reportProgress(inCycle).written} of {inCycle.length} written · {count('published')} sent to families
            </Txt>
          </Card>

          <StatGrid>
            <Stat label="To review" value={String(count('submitted'))} tone="warning" onPress={() => setFilter('submitted')} />
            <Stat label="Approved" value={String(count('approved'))} tone="info" onPress={() => setFilter('approved')} />
          </StatGrid>

          <Section title="Tutors">
            <Card style={{ gap: Spacing.three }}>
              {[...byTutor.entries()].map(([tutorId, rs]) => {
                const p = reportProgress(rs);
                return (
                  <View key={tutorId} style={{ gap: Spacing.one }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt>{lookup.tutor(tutorId)?.fullName ?? 'Tutor'}</Txt>
                      <Txt variant="muted">
                        {p.written}/{p.total}
                      </Txt>
                    </Row>
                    <ProgressBar value={p.percent} />
                  </View>
                );
              })}
              {byTutor.size === 0 ? <Txt variant="muted">No students had lessons in this period.</Txt> : null}
            </Card>
          </Section>

          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'submitted', label: `Review (${count('submitted')})` },
              { value: 'approved', label: 'Approved' },
              { value: 'draft', label: 'Not written' },
              { value: 'published', label: 'Sent' },
            ]}
          />
          {filter === 'approved' && approved.length ? (
            <Button
              title={`Send all ${approved.length} to families`}
              variant="gold"
              icon="check"
              loading={publish.isPending}
              onPress={() => confirm('Send reports?', `${approved.length} families will be notified that a new report is ready.`, publishAll, 'Send')}
            />
          ) : null}
          <ErrorNote error={publish.error} />
          {list.length === 0 ? (
            <EmptyState icon="doc" title="No reports in this view" message="Reports appear here as tutors write and submit them." />
          ) : (
            <View style={{ gap: Spacing.two }}>
              {list.map((r) => (
                <ReportRow key={r.id} report={r} showTutor />
              ))}
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function NewCycle({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const open = useAction(source.openReportCycle);
  const today = new Date();
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(toDateKey(addDays(today, -60)));
  const [due, setDue] = useState(toDateKey(addDays(today, 14)));
  const valid = name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(due);
  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Open a report round</Txt>
      <Txt variant="muted">Each student taught since the start date receives a draft report for every subject they study, assigned to that subject’s tutor.</Txt>
      <Field label="Name" value={name} onChangeText={setName} placeholder="For example, Term 1 2026" />
      <Field label="Lessons since (YYYY-MM-DD)" value={startsOn} onChangeText={setStartsOn} />
      <Field label="Due (YYYY-MM-DD)" value={due} onChangeText={setDue} />
      <ErrorNote error={open.error} />
      <Button
        title="Open round"
        variant="gold"
        disabled={!valid}
        loading={open.isPending}
        onPress={async () => {
          await open.mutateAsync([name, startsOn, due]);
          onDone();
        }}
      />
      {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
    </Card>
  );
}
