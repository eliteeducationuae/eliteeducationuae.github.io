import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { ParentReport } from '@/components/parent/report-view';
import { REPORT_STATUS, reportSubject } from '@/components/reports';
import { Actions, Badge, Banner, Button, Card, Chip, ChipField, EmptyState, ErrorNote, Field, FieldsCard, Figure, Figures, Group, GroupRow, Loading, Notice, PageHeader, Prose, Row, Screen, Section, Stat, StatGrid, Txt, useToast } from '@/components/ui';
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
import { useMe, useViewing } from '@/data/session';
import { addDays, formatDate } from '@/domain/dates';
import { enrolmentTitle } from '@/domain/enrolments';
import { RATING_LABELS, type Syllabus } from '@/domain/progress';
import { EFFORT_LABELS, factsForAi, PROGRESS_LABELS, reportFacts, sampleReportDraft } from '@/domain/reports';
import type { ReportCycle, Student, StudentReport } from '@/domain/types';
import { confirm } from '@/lib/confirm';
import { shareStudentReport } from '@/lib/student-report-pdf';

const LESSONS_TO = addDays(new Date(), 60);

/** Families read a published report on their own redesigned page (components/parent/report-view). */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  return me.role === 'parent' ? <ParentReport id={id} /> : <StaffReportScreen />;
}

function StaffReportScreen() {
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
  const [tried, setTried] = useState(false);
  const toast = useToast();
  const viewing = !!useViewing();

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

  const title = subject ? `${student.fullName.split(' ')[0]} · ${subject}` : student.fullName;
  const drafted =
    draftSource === 'sample'
      ? 'Sample draft written from this term’s lessons. Please read it through and make it your own before submitting.'
      : draftSource === 'ai'
        ? 'This draft was prepared from this term’s lessons, notes and ratings. Please check every sentence and add your own touch.'
        : null;

  return (
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back
        kicker={`Reports${cycle ? ` · ${cycle.name}` : ''}`}
        title={title}
        sub={[subjectTitle, isAdmin ? `Tutor: ${lookup.tutor(report.tutorId)?.fullName ?? ''}` : null, cycle && report.status === 'draft' ? `Due ${formatDate(cycle.dueDate)}` : s.label]
          .filter(Boolean)
          .join(' · ')}
      />
      {report.status === 'submitted' && isAuthor ? (
        <Notice tone="good" title="Submitted for review">
          The office will read it and send it to the family. You will be told if any changes are suggested.
        </Notice>
      ) : null}
      {report.status === 'published' ? <Notice tone="good" title="Sent to the family">{report.publishedAt ? `Sent on ${formatDate(report.publishedAt)}.` : ''}</Notice> : null}

      <Group title="This term at a glance" />
      {loadingFacts ? (
        <Loading />
      ) : (
        <>
          <Figures>
            <Figure label="Lessons attended" value={String(facts.lessonsTaught)} />
            <Figure label="Attendance" value={facts.attendancePercent === null ? '–' : `${facts.attendancePercent}%`} />
            <Figure label="Homework done" value={facts.homeworkPercent === null ? '–' : `${facts.homeworkPercent}%`} />
            <Figure label="Topics covered" value={String(facts.topicsCovered.length)} />
          </Figures>
          {facts.improved.length || facts.needsWork.length || facts.recentNotes.length ? (
            <Group>
              {facts.improved.length ? (
                <GroupRow icon="trending_up" tone="good" title="Strong or improving" note={facts.improved.map((m) => `${topics.name(m.topicId)} (${RATING_LABELS[m.rating]})`).join(', ')} />
              ) : null}
              {facts.needsWork.length ? (
                <GroupRow icon="flag" tone="warn" title="Needs work" note={facts.needsWork.map((m) => `${topics.name(m.topicId)} (${RATING_LABELS[m.rating]})`).join(', ')} />
              ) : null}
              {facts.recentNotes.length ? <GroupRow icon="notes" title="Recent lesson notes" note={facts.recentNotes.slice(0, 3).join(' / ')} /> : null}
            </Group>
          ) : null}
        </>
      )}

      {editable ? (
        <>
          <FieldsCard title="Grades">
            <Field label="Working at (grade)" value={attainment} onChangeText={setAttainment} placeholder={student.currentGrade ?? 'For example, 6 or A'} maxLength={20} />
            <ChipField
              label="Effort"
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: EFFORT_LABELS[n] }))}
              value={effort ? String(effort) : null}
              onChange={(v) => setEffort(Number(v))}
              error={tried && !effort}
            />
            <ChipField
              label="Progress"
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: PROGRESS_LABELS[n] }))}
              value={progress ? String(progress) : null}
              onChange={(v) => setProgress(Number(v))}
              error={tried && !progress}
            />
          </FieldsCard>

          <FieldsCard title="Written report">
            {drafted ? (
              <Notice tone="info" icon="auto_awesome">
                {drafted}
              </Notice>
            ) : (
              <Txt variant="note">We will draft all three sections from the facts above. Please set effort and progress first for a better draft.</Txt>
            )}
            <Row>
              <Button title={drafting ? 'Drafting…' : 'Draft for me'} icon="auto_awesome" size="sm" variant="secondary" loading={drafting} disabled={loadingFacts} onPress={runDraft} />
            </Row>
            <ErrorNote error={error} />
            <Field label="Strengths" value={strengths} onChangeText={setStrengths} multiline maxLength={3000} />
            <Field label="Next steps" value={nextSteps} onChangeText={setNextSteps} multiline maxLength={3000} />
            <Field label="Overall comment" value={comment} onChangeText={setComment} multiline maxLength={4000} error={tried && !comment.trim()} />
          </FieldsCard>
          <ErrorNote error={save.error ?? submit.error} />
          {!viewing ? (
            <Actions>
              {isAuthor && report.status === 'draft' ? (
                <Button
                  title="Submit for review"
                  icon="send"
                  loading={submit.isPending}
                  onPress={async () => {
                    setTried(true);
                    if (!ready) return;
                    await save.mutateAsync([report.id, fields]);
                    await submit.mutateAsync([report.id]);
                    toast('Report submitted. Thank you.');
                  }}
                />
              ) : null}
              <Button
                title={isAuthor && report.status === 'draft' ? 'Save draft' : 'Save changes'}
                icon="save"
                variant="secondary"
                loading={save.isPending && !submit.isPending}
                onPress={async () => {
                  await save.mutateAsync([report.id, fields]);
                  toast(isAuthor && report.status === 'draft' ? 'Draft saved' : 'Changes saved');
                }}
              />
            </Actions>
          ) : null}
        </>
      ) : (
        <Prose title="Report">
          <Txt variant="note">
            {[report.attainment ? `Working at ${report.attainment}` : null, report.effort ? `Effort: ${EFFORT_LABELS[report.effort]}` : null, report.progress ? `Progress: ${PROGRESS_LABELS[report.progress]}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
          {report.strengths ? <Txt>{report.strengths}</Txt> : null}
          {report.nextSteps ? <Txt>{report.nextSteps}</Txt> : null}
          {report.comment ? <Txt>{report.comment}</Txt> : null}
        </Prose>
      )}

      {isAdmin ? (
        <Group
          title="Review"
          note={
            report.status === 'submitted'
              ? 'Approve it to send now, or approve it and send it later with the rest of the round.'
              : report.status === 'approved'
                ? 'Approved. It reaches the family when you send it.'
                : report.status === 'draft'
                  ? 'The tutor has not yet submitted this report.'
                  : `Sent to the family ${report.publishedAt ? formatDate(report.publishedAt) : ''}.`
          }
        />
      ) : null}
      {isAdmin && (report.status === 'submitted' || report.status === 'approved') && !viewing ? (
        <Actions>
          {report.status === 'submitted' ? (
            <>
              <Button
                title="Approve & send to family"
                icon="send"
                loading={setStatus.isPending}
                onPress={async () => {
                  await save.mutateAsync([report.id, fields]);
                  await setStatus.mutateAsync([report.id, 'published']);
                  toast(`${student.fullName.split(' ')[0]}’s report is sent. The family has been notified.`);
                }}
              />
              <Button
                title="Approve (send later)"
                icon="check"
                variant="secondary"
                onPress={async () => {
                  await save.mutateAsync([report.id, fields]);
                  await setStatus.mutateAsync([report.id, 'approved']);
                  toast(`${student.fullName.split(' ')[0]}’s report is approved.`);
                }}
              />
            </>
          ) : (
            <Button
              title="Send to family"
              icon="send"
              loading={setStatus.isPending}
              onPress={async () => {
                await setStatus.mutateAsync([report.id, 'published']);
                toast(`${student.fullName.split(' ')[0]}’s report is sent. The family has been notified.`);
              }}
            />
          )}
          <Button title="Send back to tutor" variant="secondary" onPress={() => setStatus.mutateAsync([report.id, 'draft'])} />
        </Actions>
      ) : null}
      {isAdmin ? <ErrorNote error={setStatus.error} /> : null}

      {report.status !== 'draft' ? (
        <Actions>
          <Button
            title="Preview PDF"
            icon="share"
            variant="secondary"
            onPress={() => shareStudentReport(report, student, lookup.tutor(report.tutorId), cycle, settings.data?.businessName ?? 'Elite Education')}
          />
        </Actions>
      ) : null}
    </Screen>
  );
}

