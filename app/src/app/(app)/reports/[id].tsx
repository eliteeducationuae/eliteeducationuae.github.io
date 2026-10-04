import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { REPORT_STATUS, reportSubject } from '@/components/reports';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import {
  useAction,
  useEnrolments,
  useHomework,
  useLessons,
  useLookup,
  useNotes,
  useRatings,
  useReportCycles,
  useSettings,
  useStudentReports,
  useTopicLookup,
} from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, formatDate } from '@/domain/dates';
import { enrolmentTitle } from '@/domain/enrolments';
import { RATING_LABELS, type Syllabus } from '@/domain/progress';
import { EFFORT_LABELS, factsForAi, PROGRESS_LABELS, reportFacts, sampleReportDraft } from '@/domain/reports';
import type { ReportCycle, Student, StudentReport } from '@/domain/types';
import { confirm } from '@/lib/confirm';
import { shareStudentReport } from '@/lib/student-report-pdf';

const LESSONS_TO = addDays(new Date(), 60);

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reports = useStudentReports();
  const cycles = useReportCycles();
  const lookup = useLookup();
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  if (reports.isLoading || cycles.isLoading || enrolments.isLoading || !lookup.ready || !topics.ready) return <Loading />;
  const report = reports.data?.find((r) => r.id === id);
  const student = report && lookup.student(report.studentId);
  if (!report || !student) return <Screen><EmptyState title="Report not found" /></Screen>;
  const cycle = cycles.data?.find((c) => c.id === report.cycleId);
  return <Writer key={`${report.id}-${report.status}-${report.updatedAt}`} report={report} student={student} cycle={cycle} />;
}

function Writer({ report, student, cycle }: { report: StudentReport; student: Student; cycle?: ReportCycle }) {
  const me = useMe();
  const lookup = useLookup();
  const settings = useSettings();
  const since = cycle?.startsOn ?? report.updatedAt.slice(0, 10);
  const from = useMemo(() => new Date(`${since}T00:00:00`), [since]);
  const lessons = useLessons(from, LESSONS_TO);
  const notes = useNotes({ studentId: student.id });
  const homework = useHomework(student.id);
  const ratings = useRatings(student.id);
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const save = useAction(source.saveReport);
  const submit = useAction(source.submitReport);
  const setStatus = useAction(source.setReportStatus);

  const [attainment, setAttainment] = useState(report.attainment ?? '');
  const [effort, setEffort] = useState(report.effort);
  const [progress, setProgress] = useState(report.progress);
  const [strengths, setStrengths] = useState(report.strengths ?? '');
  const [nextSteps, setNextSteps] = useState(report.nextSteps ?? '');
  const [comment, setComment] = useState(report.comment ?? '');
  const [aiAssisted, setAiAssisted] = useState(report.aiAssisted);
  const [drafting, setDrafting] = useState(false);
  const [draftSource, setDraftSource] = useState<'ai' | 'sample' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const isAdmin = me.role === 'admin';
  const isAuthor = me.role === 'tutor' && me.tutorId === report.tutorId;
  const editable = report.status !== 'published' && (isAdmin || (isAuthor && (report.status === 'draft' || report.status === 'submitted')));
  const s = REPORT_STATUS[report.status];
  const { subject, enrolment } = reportSubject(report, enrolments.data ?? []);
  // Reports written before subjects existed fall back to the student's original syllabus.
  const tree: Syllabus | undefined = enrolment ? topics.treeFor(enrolment) : topics.builtIn(student.syllabusId);
  const subjectTitle = enrolment ? enrolmentTitle(enrolment) : (subject ?? tree?.name ?? student.curriculum);
  const treeKey = tree ? tree.units.flatMap((u) => u.topics.map((t) => t.id)).join(',') : '';
  const loadingFacts = lessons.isLoading || notes.isLoading || homework.isLoading || ratings.isLoading;
  const facts = useMemo(
    () =>
      reportFacts(
        student,
        { lessons: lessons.data ?? [], notes: notes.data ?? [], homework: homework.data ?? [], ratings: ratings.data ?? [] },
        from.toISOString(),
        { subject, topicIds: treeKey ? new Set(treeKey.split(',')) : undefined },
      ),
    [student, lessons.data, notes.data, homework.data, ratings.data, from, subject, treeKey],
  );
  const fields = { attainment, effort, progress, strengths, nextSteps, comment, aiAssisted };
  const ready = !!effort && !!progress && comment.trim().length > 0;
  const hasText = !!(strengths.trim() || nextSteps.trim() || comment.trim());

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      const context = { subject, curriculum: enrolment?.curriculum ?? student.curriculum, syllabus: tree?.name, attainment, effort, progress };
      const ai = await source.aiAssist?.({ task: 'report-draft', reportId: report.id, facts: factsForAi(facts, topics.name, context) });
      const d = ai && ai.task === 'report-draft' ? ai : sampleReportDraft(facts, topics.name);
      setStrengths(d.strengths);
      setNextSteps(d.nextSteps);
      setComment(d.comment);
      setDraftSource(ai ? 'ai' : 'sample');
      if (ai) setAiAssisted(true);
    } catch (err) {
      setError(err);
    } finally {
      setDrafting(false);
    }
  }

  const runDraft = () =>
    hasText ? confirm('Replace what you have written?', 'The draft will replace the three text boxes below.', draft, 'Replace') : draft();

  const footer =
    isAuthor && report.status === 'draft' ? (
      <Row style={{ gap: Spacing.two, flex: 1 }}>
        <Button title="Save" variant="secondary" style={{ flex: 1 }} loading={save.isPending && !submit.isPending} onPress={() => save.mutateAsync([report.id, fields])} />
        <Button
          title="Submit"
          variant="gold"
          style={{ flex: 2 }}
          disabled={!ready}
          loading={submit.isPending}
          onPress={async () => {
            await save.mutateAsync([report.id, fields]);
            await submit.mutateAsync([report.id]);
          }}
        />
      </Row>
    ) : editable ? (
      <Button title="Save changes" variant="secondary" style={{ flex: 1 }} loading={save.isPending} onPress={() => save.mutateAsync([report.id, fields])} />
    ) : undefined;

  return (
    <Screen footer={footer}>
      <Stack.Screen options={{ title: subject ? `${student.fullName.split(' ')[0]} · ${subject} report` : student.fullName.split(' ')[0] }} />
      <Card style={{ gap: Spacing.one }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{student.fullName}</Txt>
            <Txt variant="muted">
              {[cycle?.name ?? 'Report', subjectTitle].filter(Boolean).join(' · ')}
            </Txt>
            {isAdmin ? <Txt variant="small">Tutor: {lookup.tutor(report.tutorId)?.fullName}</Txt> : null}
          </View>
          <Badge label={s.label} tone={s.tone} />
        </Row>
        {cycle && report.status === 'draft' ? <Txt variant="small">Due {formatDate(cycle.dueDate)}</Txt> : null}
      </Card>

      <Section title="This term at a glance">
        {loadingFacts ? (
          <Loading />
        ) : (
          <Card style={{ gap: Spacing.three }}>
            <StatGrid>
              <Stat label="Lessons attended" value={String(facts.lessonsTaught)} />
              <Stat label="Attendance" value={facts.attendancePercent === null ? '–' : `${facts.attendancePercent}%`} />
              <Stat label="Homework done" value={facts.homeworkPercent === null ? '–' : `${facts.homeworkPercent}%`} />
              <Stat label="Topics covered" value={String(facts.topicsCovered.length)} />
            </StatGrid>
            {facts.improved.length ? (
              <View style={{ gap: 2 }}>
                <Txt variant="label">Strong or improving</Txt>
                <Txt>{facts.improved.map((m) => `${topics.name(m.topicId)} (${RATING_LABELS[m.rating]})`).join(', ')}</Txt>
              </View>
            ) : null}
            {facts.needsWork.length ? (
              <View style={{ gap: 2 }}>
                <Txt variant="label">Needs work</Txt>
                <Txt>{facts.needsWork.map((m) => `${topics.name(m.topicId)} (${RATING_LABELS[m.rating]})`).join(', ')}</Txt>
              </View>
            ) : null}
            {facts.recentNotes.length ? (
              <View style={{ gap: 2 }}>
                <Txt variant="label">Recent lesson notes</Txt>
                {facts.recentNotes.slice(0, 3).map((n, i) => (
                  <Txt key={i} variant="muted" numberOfLines={2}>
                    • {n}
                  </Txt>
                ))}
              </View>
            ) : null}
          </Card>
        )}
      </Section>

      {editable ? (
        <>
          <Section title="Grades">
            <Card style={{ gap: Spacing.three }}>
              <Field label="Working at (grade)" value={attainment} onChangeText={setAttainment} placeholder={student.currentGrade ?? 'For example, 6 or A'} maxLength={20} />
              <GradePicker label="Effort" labels={EFFORT_LABELS} value={effort} onChange={setEffort} />
              <GradePicker label="Progress" labels={PROGRESS_LABELS} value={progress} onChange={setProgress} />
            </Card>
          </Section>

          <Section title="Written report">
            <Card style={{ gap: Spacing.three }}>
              <Button title={drafting ? 'Drafting…' : 'Draft for me'} icon="sparkle" variant="gold" loading={drafting} disabled={loadingFacts} onPress={runDraft} />
              {draftSource === 'sample' ? (
                <Banner icon="sparkle">Sample draft written from this term’s lessons. Please read it through and make it your own before submitting.</Banner>
              ) : draftSource === 'ai' ? (
                <Banner icon="sparkle">This draft was prepared from this term’s lessons, notes and ratings. Please check every sentence and add your own touch.</Banner>
              ) : (
                <Txt variant="muted">We will draft all three sections from the facts above. Please set effort and progress first for a better draft.</Txt>
              )}
              <ErrorNote error={error} />
              <Field label="Strengths" value={strengths} onChangeText={setStrengths} multiline maxLength={3000} />
              <Field label="Next steps" value={nextSteps} onChangeText={setNextSteps} multiline maxLength={3000} />
              <Field label="Overall comment" value={comment} onChangeText={setComment} multiline maxLength={4000} />
              {isAuthor && report.status === 'draft' && !ready ? <Txt variant="small">To submit, choose effort and progress and write an overall comment.</Txt> : null}
              <ErrorNote error={save.error ?? submit.error} />
            </Card>
          </Section>
        </>
      ) : (
        <Section title="Report">
          <Card style={{ gap: Spacing.three }}>
            <Txt variant="muted">
              {report.attainment ? `Working at ${report.attainment} · ` : ''}
              {report.effort ? `Effort: ${EFFORT_LABELS[report.effort]} · ` : ''}
              {report.progress ? `Progress: ${PROGRESS_LABELS[report.progress]}` : ''}
            </Txt>
            {report.strengths ? <Txt>{report.strengths}</Txt> : null}
            {report.nextSteps ? <Txt>{report.nextSteps}</Txt> : null}
            {report.comment ? <Txt>{report.comment}</Txt> : null}
          </Card>
        </Section>
      )}

      {isAdmin ? (
        <Section title="Review">
          <Card style={{ gap: Spacing.two }}>
            {report.status === 'submitted' ? (
              <>
                <Button
                  title="Approve & send to family"
                  variant="gold"
                  icon="check"
                  loading={setStatus.isPending}
                  onPress={async () => {
                    await save.mutateAsync([report.id, fields]);
                    await setStatus.mutateAsync([report.id, 'published']);
                  }}
                />
                <Button title="Approve (send later)" variant="secondary" onPress={async () => {
                  await save.mutateAsync([report.id, fields]);
                  await setStatus.mutateAsync([report.id, 'approved']);
                }} />
              </>
            ) : report.status === 'approved' ? (
              <Button title="Send to family" variant="gold" icon="check" loading={setStatus.isPending} onPress={() => setStatus.mutateAsync([report.id, 'published'])} />
            ) : report.status === 'draft' ? (
              <Txt variant="muted">The tutor has not yet submitted this report.</Txt>
            ) : (
              <Txt variant="muted">Sent to the family {report.publishedAt ? formatDate(report.publishedAt) : ''}.</Txt>
            )}
            {report.status === 'submitted' || report.status === 'approved' ? (
              <Button title="Send back to tutor" variant="ghost" onPress={() => setStatus.mutateAsync([report.id, 'draft'])} />
            ) : null}
            <ErrorNote error={setStatus.error} />
          </Card>
        </Section>
      ) : null}

      {report.status !== 'draft' ? (
        <Button
          title="Preview PDF"
          icon="share"
          variant="secondary"
          onPress={() => shareStudentReport(report, student, lookup.tutor(report.tutorId), cycle, settings.data?.businessName ?? 'Elite Education')}
        />
      ) : null}
    </Screen>
  );
}

function GradePicker({ label, labels, value, onChange }: { label: string; labels: Record<number, string>; value?: number; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <Txt variant="label">{label}</Txt>
      <Row style={{ gap: Spacing.one, flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip key={n} label={labels[n]} selected={value === n} onPress={() => onChange(n)} />
        ))}
      </Row>
    </View>
  );
}
