import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NoHeader, RowMeta, type TagTone } from '@/components/admin-people/kit';
import { HeaderActions } from '@/components/role-tabs';
import { REPORT_STATUS, ReportBody, reportProgress, reportSubject, sortReports } from '@/components/reports';
import {
  Actions,
  Button,
  ChipField,
  Columns,
  EmptyState,
  ErrorNote,
  Field,
  FieldsCard,
  Group,
  GroupRow,
  Loading,
  PageHeader,
  ProgressBar,
  Screen,
  Tabs,
  Txt,
  useToast,
} from '@/components/ui';
import { font, tabular } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useLookup, useReportCycles, useStudentReports } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { addDays, formatDate, toDateKey } from '@/domain/dates';
import type { ReportStatus, StudentReport } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';

type Filter = 'submitted' | 'approved' | 'draft' | 'published';

const TAG: Record<ReportStatus, { tag: string; tone: TagTone }> = {
  submitted: { tag: 'To review', tone: 'warn' },
  approved: { tag: 'Approved', tone: 'text' },
  draft: { tag: 'Not written', tone: 'muted' },
  published: { tag: 'Sent', tone: 'good' },
};

/** Admin: open a report round, watch tutors' progress, review and send reports to families. */
export default function AdminReports() {
  // Also the admin's Reports tab on desktop (admin/reports re-exports this screen): no Back pill there.
  const tab = usePathname().startsWith('/admin');
  const theme = useTheme();
  const toast = useToast();
  const viewing = useViewing();
  const cycles = useReportCycles();
  const reports = useStudentReports();
  const lookup = useLookup();
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('submitted');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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
  const progress = reportProgress(inCycle);
  const first = (r: StudentReport) => lookup.student(r.studentId)?.fullName.split(' ')[0] ?? 'The student';
  const tutorFirst = (r: StudentReport) => lookup.tutor(r.tutorId)?.fullName.split(' ')[0] ?? 'the tutor';

  async function publishAll() {
    const n = approved.length;
    for (const r of approved) await publish.mutateAsync([r.id, 'published']);
    toast(`${n} ${n === 1 ? 'report' : 'reports'} sent. Families have been notified.`);
  }
  async function setStatus(r: StudentReport, status: 'draft' | 'approved' | 'published', message: string) {
    await publish.mutateAsync([r.id, status]);
    setOpenId(null);
    toast(message);
  }

  return (
    <Screen topInset onRefresh={() => reports.refetch()} refreshing={reports.isRefetching}>
      <NoHeader title={tab ? undefined : 'Student reports'} />
      <PageHeader
        back={tab ? undefined : { fallback: '/admin' }}
        kicker="Student reports"
        title={cycle && !creating ? cycle.name : 'Report rounds'}
        right={tab ? <HeaderActions search inbox /> : undefined}
      />

      {sorted.length > 1 && !creating ? (
        <ChipField options={sorted.slice(0, 6).map((c) => ({ value: c.id, label: c.name }))} value={cycle?.id} onChange={(id) => setCycleId(id)} />
      ) : null}

      {creating || sorted.length === 0 ? <NewCycle onDone={() => setCreating(false)} onCancel={sorted.length ? () => setCreating(false) : undefined} /> : null}

      {cycle && !creating ? (
        <>
          <Columns>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }} accessible accessibilityLabel={`${progress.written} of ${inCycle.length} written`}>
                <Text style={[font('serif'), tabular, { fontSize: 56, lineHeight: 60, color: theme.text }]}>{progress.written}</Text>
                <Text style={[font('serif'), { fontSize: 21, color: theme.textMuted }]}>of {inCycle.length} written</Text>
              </View>
              <ProgressBar label="Reports written" value={progress.percent} />
              <Txt variant="note">
                Lessons since {formatDate(cycle.startsOn)} · due {formatDate(cycle.dueDate)} · {count('published')} sent to families
              </Txt>
            </View>
            <View style={{ gap: 12 }}>
              {[...byTutor.entries()].map(([tutorId, rs]) => {
                const p = reportProgress(rs);
                return (
                  <View key={tutorId} style={{ gap: 6 }} accessible accessibilityLabel={`${lookup.tutor(tutorId)?.fullName ?? 'Tutor'}: ${p.written} of ${p.total} written`}>
                    <View style={styles.tutorLine}>
                      <Txt style={{ fontSize: 14.5 }}>{lookup.tutor(tutorId)?.fullName ?? 'Tutor'}</Txt>
                      <Txt variant="note" style={tabular}>
                        {p.written} of {p.total}
                      </Txt>
                    </View>
                    <ProgressBar label={`${lookup.tutor(tutorId)?.fullName ?? 'Tutor'}, reports written`} value={p.percent} color={theme.text} />
                  </View>
                );
              })}
              {byTutor.size === 0 ? <Txt variant="muted">No students had lessons in this period.</Txt> : null}
            </View>
          </Columns>

          <Tabs
            accessibilityLabel="Reports"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setOpenId(null);
            }}
            tabs={[
              { value: 'submitted', label: `To review (${count('submitted')})` },
              { value: 'approved', label: `Approved (${count('approved')})` },
              { value: 'draft', label: `Not written (${count('draft')})` },
              { value: 'published', label: 'Sent' },
            ]}
          />
          {filter === 'approved' && approved.length && !viewing ? (
            <Actions>
              <Button
                title={`Send all ${approved.length} to families`}
                icon="send"
                loading={publish.isPending}
                onPress={() => confirm('Send reports?', `${approved.length} families will be notified that a new report is ready.`, publishAll, 'Send')}
              />
            </Actions>
          ) : null}
          <ErrorNote error={publish.error} />
          {list.length === 0 ? (
            <EmptyState icon="doc" title="No reports in this view" message="Reports appear here as tutors write and submit them." />
          ) : (
            <Group>
              {list.map((r) => {
                const { subject } = reportSubject(r, enrolments.data ?? []);
                const student = lookup.student(r.studentId);
                return (
                  <GroupRow
                    key={r.id}
                    title={student?.fullName ?? 'Student'}
                    accessibilityLabel={`Report for ${student?.fullName ?? 'student'}`}
                    note={[subject ?? student?.curriculum, lookup.tutor(r.tutorId)?.fullName, r.aiAssisted ? 'AI-assisted' : null].filter(Boolean).join(' · ')}
                    right={<RowMeta {...TAG[r.status]} />}
                    expanded={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                    body={
                      <View style={{ gap: 14 }}>
                        {r.status === 'draft' ? (
                          <Txt variant="muted">{`${tutorFirst(r)} has not submitted this report yet.`}</Txt>
                        ) : (
                          <ReportBody report={r} />
                        )}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                          {r.status === 'submitted' && !viewing ? (
                            <Button title="Approve" size="sm" icon="check" onPress={() => void setStatus(r, 'approved', `${first(r)}’s report is approved.`)} />
                          ) : null}
                          {r.status === 'approved' && !viewing ? (
                            <Button title="Send to family" size="sm" icon="send" onPress={() => void setStatus(r, 'published', `${first(r)}’s report is sent. The family has been notified.`)} />
                          ) : null}
                          {(r.status === 'submitted' || r.status === 'approved') && !viewing ? (
                            <Button
                              title="Send back to tutor"
                              size="sm"
                              variant="secondary"
                              onPress={() => void setStatus(r, 'draft', `${first(r)}’s report is back with ${tutorFirst(r)}.`)}
                            />
                          ) : null}
                          <Button title="Open the report" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })} />
                        </View>
                      </View>
                    }
                  />
                );
              })}
            </Group>
          )}
          <Txt variant="note">{`${REPORT_STATUS.published.label}: families see the report in their app and can download it as a PDF.`}</Txt>
          {viewing ? null : (
            <Actions>
              <Button title="Open a new report round" icon="add" variant="secondary" onPress={() => setCreating(true)} />
            </Actions>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function NewCycle({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const open = useAction(source.openReportCycle);
  const toast = useToast();
  const [today] = useState(() => new Date());
  const [tried, setTried] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(toDateKey(addDays(today, -60)));
  const [due, setDue] = useState(toDateKey(addDays(today, 14)));
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const valid = !!name.trim() && dateOk(startsOn) && dateOk(due);
  return (
    <>
      <FieldsCard title="Open a report round">
        <Txt variant="muted">Each student taught since the start date receives a draft report for every subject they study, assigned to that subject’s tutor.</Txt>
        <Field label="Name" value={name} onChangeText={setName} placeholder="For example, Term 1 2026" error={tried && !name.trim()} />
        <Field label="Lessons since (YYYY-MM-DD)" value={startsOn} onChangeText={setStartsOn} error={tried && !dateOk(startsOn) ? 'Please write the date as YYYY-MM-DD.' : undefined} />
        <Field label="Due (YYYY-MM-DD)" value={due} onChangeText={setDue} error={tried && !dateOk(due) ? 'Please write the date as YYYY-MM-DD.' : undefined} />
        <ErrorNote error={open.error} />
      </FieldsCard>
      <Actions>
        <Button
          title="Open round"
          icon="check"
          loading={open.isPending}
          onPress={async () => {
            setTried(true);
            if (!valid) return;
            await open.mutateAsync([name, startsOn, due]);
            toast(`${name.trim()} is open. Tutors can start writing.`);
            onDone();
          }}
        />
        {onCancel ? <Button title="Cancel" variant="secondary" onPress={onCancel} /> : null}
      </Actions>
    </>
  );
}

const styles = StyleSheet.create({
  tutorLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
});
