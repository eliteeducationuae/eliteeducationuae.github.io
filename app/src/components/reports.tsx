import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useLookup, useReportCycles, useSettings, useStudentReports } from '@/data/hooks';
import { formatDate } from '@/domain/dates';
import { EFFORT_LABELS, PROGRESS_LABELS } from '@/domain/reports';
import type { ReportCycle, ReportStatus, Student, StudentReport } from '@/domain/types';
import { shareStudentReport } from '@/lib/student-report-pdf';

import { Badge, Button, Card, Row, Section, Txt, type Tone } from './ui';

export const REPORT_STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  draft: { label: 'To write', tone: 'neutral' },
  submitted: { label: 'Waiting for review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  published: { label: 'Sent to family', tone: 'success' },
};

/** How far through a set of reports a tutor (or everyone) is: written = submitted or later. */
export function reportProgress(reports: StudentReport[]) {
  const written = reports.filter((r) => r.status !== 'draft').length;
  return { written, total: reports.length, percent: reports.length ? Math.round((written / reports.length) * 100) : 0 };
}

export function ReportRow({ report, subtitle }: { report: StudentReport; subtitle?: string }) {
  const lookup = useLookup();
  const s = REPORT_STATUS[report.status];
  const student = lookup.student(report.studentId);
  return (
    <Card onPress={() => router.push({ pathname: '/reports/[id]', params: { id: report.id } })} accessibilityLabel={`Report for ${student?.fullName ?? 'student'}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{student?.fullName ?? 'Student'}</Txt>
          <Txt variant="muted">{subtitle ?? `${student?.curriculum ?? ''}${report.aiAssisted ? ' · AI-assisted' : ''}`}</Txt>
        </View>
        <Badge label={s.label} tone={s.tone} />
      </Row>
    </Card>
  );
}

/** A finished report, as families see it. */
export function ReportBody({ report }: { report: StudentReport }) {
  return (
    <View style={{ gap: Spacing.three }}>
      <Row style={{ gap: Spacing.two, flexWrap: 'wrap' }}>
        {report.attainment ? <Badge label={`Working at ${report.attainment}`} tone="gold" /> : null}
        {report.effort ? <Badge label={`Effort: ${EFFORT_LABELS[report.effort]}`} tone="info" /> : null}
        {report.progress ? <Badge label={`Progress: ${PROGRESS_LABELS[report.progress]}`} tone="success" /> : null}
      </Row>
      {report.strengths ? (
        <View style={{ gap: 2 }}>
          <Txt variant="label">Strengths</Txt>
          <Txt>{report.strengths}</Txt>
        </View>
      ) : null}
      {report.nextSteps ? (
        <View style={{ gap: 2 }}>
          <Txt variant="label">Next steps</Txt>
          <Txt>{report.nextSteps}</Txt>
        </View>
      ) : null}
      {report.comment ? (
        <View style={{ gap: 2 }}>
          <Txt variant="label">Overall</Txt>
          <Txt>{report.comment}</Txt>
        </View>
      ) : null}
    </View>
  );
}

/** Published reports for one student — the family's Progress tab. */
export function PublishedReports({ student }: { student: Student }) {
  const reports = useStudentReports();
  const cycles = useReportCycles();
  const settings = useSettings();
  const lookup = useLookup();
  const [open, setOpen] = useState<string | null>(null);
  const list = (reports.data ?? [])
    .filter((r) => r.studentId === student.id && r.status === 'published')
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  if (list.length === 0) return null;
  const cycle = (id: string): ReportCycle | undefined => cycles.data?.find((c) => c.id === id);
  const shown = open ?? list[0].id;
  return (
    <Section title="Reports">
      <View style={{ gap: Spacing.two }}>
        {list.map((r) => (
          <Card key={r.id} style={{ gap: Spacing.three }} onPress={shown === r.id ? undefined : () => setOpen(r.id)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{cycle(r.cycleId)?.name ?? 'Report'}</Txt>
                <Txt variant="muted">
                  {lookup.tutor(r.tutorId)?.fullName}
                  {r.publishedAt ? ` · ${formatDate(r.publishedAt)}` : ''}
                </Txt>
              </View>
              {shown !== r.id ? <Badge label="Read" tone="info" /> : null}
            </Row>
            {shown === r.id ? (
              <>
                <ReportBody report={r} />
                <Button
                  title="Download PDF"
                  icon="share"
                  variant="secondary"
                  size="sm"
                  onPress={() => shareStudentReport(r, student, lookup.tutor(r.tutorId), cycle(r.cycleId), settings.data?.businessName ?? 'Elite Education')}
                />
              </>
            ) : null}
          </Card>
        ))}
      </View>
    </Section>
  );
}
