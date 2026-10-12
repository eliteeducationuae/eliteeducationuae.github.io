import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useEnrolments, useHomework, useLessons, useLookup, useNotes, useRatings, useReportCycles, useSettings, useStudentReports, useTopicLookup } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { addDays } from '@/domain/dates';
import { enrolmentTitle } from '@/domain/enrolments';
import { EFFORT_LABELS, PROGRESS_LABELS, reportFacts } from '@/domain/reports';
import type { ReportCycle, Student, StudentReport } from '@/domain/types';
import { shareStudentReport } from '@/lib/student-report-pdf';

import { reportSubject } from '../reports';
import { Actions, Button, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, PageHeader, Prose, Screen } from '../ui';
import { dayMonth, firstName, levelLabel } from './format';
import { openMessages } from './hooks';

const LESSONS_TO = addDays(new Date(), 60);

/** A published report, as the family reads it. Drafts and reports still under review are never shown. */
export function ParentReport({ id }: { id: string }) {
  const reports = useStudentReports();
  const cycles = useReportCycles();
  const lookup = useLookup();
  const header = <Stack.Screen options={{ headerShown: false, title: 'Report' }} />;
  if (reports.isLoading || cycles.isLoading || !lookup.ready) return <Loading />;
  const report = reports.data?.find((r) => r.id === id && r.status === 'published');
  const student = report && lookup.student(report.studentId);
  if (!report || !student) {
    return (
      <Screen topInset>
        {header}
        <PageHeader back={{ fallback: '/parent/progress' }} kicker="Report" title="Report not found" />
        <EmptyState icon="description" title="Report not found" message="Reports appear under Progress once they are sent to you." />
      </Screen>
    );
  }
  return (
    <>
      {header}
      <ReportBody report={report} student={student} cycle={cycles.data?.find((c) => c.id === report.cycleId)} />
    </>
  );
}

/** Split a block of tutor text into lines: one per line break or bullet, so lists read as lists. */
function lines(text?: string): string[] {
  return (text ?? '')
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean);
}

function ReportBody({ report, student, cycle }: { report: StudentReport; student: Student; cycle?: ReportCycle }) {
  const viewing = useViewing();
  const lookup = useLookup();
  const settings = useSettings();
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const since = cycle?.startsOn ?? report.updatedAt.slice(0, 10);
  const from = useMemo(() => new Date(`${since}T00:00:00`), [since]);
  const lessons = useLessons(from, LESSONS_TO);
  const notes = useNotes({ studentId: student.id });
  const homework = useHomework(student.id);
  const ratings = useRatings(student.id);
  const { subject, enrolment } = reportSubject(report, enrolments.data ?? []);
  const facts = reportFacts(
    student,
    { lessons: lessons.data ?? [], notes: notes.data ?? [], homework: homework.data ?? [], ratings: ratings.data ?? [] },
    from.toISOString(),
    { subject },
  );
  const tutor = lookup.tutor(report.tutorId);
  const child = firstName(student.fullName);
  const subjectTitle = enrolment ? enrolmentTitle(enrolment) : subject;
  const going = lines(report.strengths);
  const next = lines(report.nextSteps);

  return (
    <Screen topInset>
      <PageHeader
        back={{ fallback: '/parent/progress' }}
        kicker={`Report · ${cycle?.name ?? 'Progress'}`}
        title={`${child}’s ${cycle?.name ?? 'progress'} report`}
        sub={[subjectTitle, tutor ? `written by ${tutor.fullName}` : '', report.publishedAt ? `sent ${dayMonth(report.publishedAt)}` : ''].filter(Boolean).join(' · ')}
      />
      <Figures>
        {report.attainment ? <Figure label="Working at" value={report.attainment} hint={student.targetGrade ? `target grade ${student.targetGrade}` : undefined} tone="highlight" /> : null}
        {report.effort ? <Figure label="Effort" value={EFFORT_LABELS[report.effort]} /> : null}
        {report.progress ? <Figure label="Progress" value={PROGRESS_LABELS[report.progress]} /> : null}
        {lessons.isLoading ? null : (
          <Figure
            label="Attendance"
            value={facts.attendancePercent === null ? '–' : `${facts.attendancePercent}%`}
            hint={`${facts.lessonsTaught === 1 ? 'one lesson' : `${facts.lessonsTaught} lessons`} this period`}
          />
        )}
      </Figures>
      {report.comment ? <Prose title="Summary" paragraphs={lines(report.comment).length > 1 ? lines(report.comment) : [report.comment]} /> : null}
      <Columns>
        {going.length ? (
          <Group title="Going well">
            {going.map((k) => (
              <GroupRow key={k} icon="check" tone="good" title={k} titleWeight="regular" />
            ))}
          </Group>
        ) : null}
        {next.length ? (
          <Group title="Next steps">
            {next.map((k) => (
              <GroupRow key={k} icon="arrow_forward" title={k} titleWeight="regular" />
            ))}
          </Group>
        ) : null}
        {facts.needsWork.length || facts.improved.length ? (
          <Group title="Topics this period">
            {[...facts.improved, ...facts.needsWork].slice(0, 6).map((m) => (
              <GroupRow key={m.topicId} title={topics.name(m.topicId)} titleWeight="regular" value={levelLabel(m.rating)} valueSize={13} />
            ))}
          </Group>
        ) : null}
      </Columns>
      <Actions>
        <Button
          title="Download PDF"
          icon="download"
          onPress={() => shareStudentReport(report, student, tutor, cycle, settings.data?.businessName ?? 'Elite Education')}
        />
        {viewing ? null : (
          <Button
            title={`Message ${firstName(tutor?.fullName) || 'us'}`}
            icon="forum"
            variant="secondary"
            onPress={() => openMessages(tutor ? `Hello ${firstName(tutor.fullName)}, thank you for ${child}’s report. ` : undefined)}
          />
        )}
      </Actions>
    </Screen>
  );
}
