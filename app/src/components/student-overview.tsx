import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { getSyllabus, topicName } from '@/data/curriculum';
import { useAction, useHomework, useLessons, useLookup, useNotes, useRatings, useSettings } from '@/data/hooks';
import { source } from '@/data';
import { useMe } from '@/data/session';
import { addDays, daysUntil, formatDate, relativeDay, toDateKey } from '@/domain/dates';
import { masteryByTopic } from '@/domain/progress';
import type { Homework, Lesson, LessonNote, Student } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { shareProgressReport } from '@/lib/report';

import { Icon } from './icon';
import { MasteryHeatmap, ProgressSummary } from './progress';
import { Badge, Button, Card, EmptyState, Loading, Row, Section, Segmented, Stat, StatGrid, Txt } from './ui';

const HISTORY_FROM = addDays(new Date(), -365);
const HISTORY_TO = addDays(new Date(), 90);

/** Everything about one student's learning — shared by admin, tutor, parent and student views. */
export function StudentOverview({ student }: { student: Student }) {
  const theme = useTheme();
  const me = useMe();
  const lookup = useLookup();
  const ratings = useRatings(student.id);
  const notes = useNotes({ studentId: student.id });
  const homework = useHomework(student.id);
  const settings = useSettings();
  const lessons = useLessons(HISTORY_FROM, HISTORY_TO);
  const [tab, setTab] = useState<'progress' | 'notes' | 'homework'>('progress');
  const [sharing, setSharing] = useState(false);

  const syllabus = getSyllabus(student.syllabusId);
  const mastery = useMemo(() => masteryByTopic(ratings.data ?? []), [ratings.data]);
  const studentLessons = useMemo(
    () => (lessons.data ?? []).filter((l) => l.studentIds.includes(student.id)),
    [lessons.data, student.id],
  );
  const upcoming = studentLessons.find((l) => l.status === 'scheduled' && new Date(l.start) > new Date());
  const taught = studentLessons.filter((l) => l.status === 'completed' || l.status === 'no-show');
  const attendance = taught.length ? Math.round((taught.filter((l) => l.status === 'completed').length / taught.length) * 100) : null;
  const hw = homework.data ?? [];
  const hwRate = hw.length ? Math.round((hw.filter((h) => h.done).length / hw.length) * 100) : null;
  const daysToExam = student.examDate ? daysUntil(student.examDate, new Date()) : null;

  async function share() {
    if (!syllabus || !settings.data) return;
    setSharing(true);
    try {
      await shareProgressReport({
        student,
        syllabus,
        ratings: ratings.data ?? [],
        notes: notes.data ?? [],
        lessons: studentLessons,
        homework: hw,
        businessName: settings.data.businessName,
      });
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={{ gap: Spacing.four }}>
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{student.fullName}</Txt>
            <Txt variant="muted">
              {syllabus?.name ?? student.curriculum}
              {student.yearGroup ? ` · ${student.yearGroup}` : ''}
              {student.school ? ` · ${student.school}` : ''}
            </Txt>
          </View>
          <Badge label={student.curriculum} tone="gold" />
        </Row>
        {student.currentGrade || student.targetGrade ? (
          <Row gap={Spacing.two}>
            <Txt>
              Working at <Txt style={{ fontWeight: '800' }}>{student.currentGrade ?? '–'}</Txt>
            </Txt>
            <Icon name="forward" size={14} color={theme.textMuted} />
            <Txt>
              Target <Txt style={{ fontWeight: '800', color: theme.success }}>{student.targetGrade ?? '–'}</Txt>
            </Txt>
          </Row>
        ) : null}
        {upcoming ? (
          <Txt variant="muted">
            Next lesson: {relativeDay(upcoming.start)} at {new Date(upcoming.start).toTimeString().slice(0, 5)} with{' '}
            {lookup.tutor(upcoming.tutorId)?.fullName}
          </Txt>
        ) : null}
        {(me.role === 'admin' || me.role === 'tutor') && student.notes ? (
          <View style={{ backgroundColor: theme.warningBg, padding: Spacing.two, borderRadius: 8 }}>
            <Txt variant="small" style={{ color: theme.text }}>
              Tutor notes: {student.notes}
            </Txt>
          </View>
        ) : null}
      </Card>

      <StatGrid>
        <Stat label="Attendance" value={attendance === null ? '–' : `${attendance}%`} hint={`${taught.length} lessons`} />
        <Stat label="Homework" value={hwRate === null ? '–' : `${hwRate}%`} hint="completed" tone={hwRate !== null && hwRate < 60 ? 'warning' : undefined} />
        {daysToExam !== null && daysToExam > 0 ? <Stat label="Exams in" value={`${daysToExam}d`} hint={formatDate(student.examDate!)} /> : null}
      </StatGrid>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'progress', label: 'Progress' },
          { value: 'notes', label: 'Lesson notes' },
          { value: 'homework', label: 'Homework' },
        ]}
      />

      {tab === 'progress' ? (
        ratings.isLoading ? (
          <Loading />
        ) : syllabus ? (
          <View style={{ gap: Spacing.three }}>
            <ProgressSummary syllabus={syllabus} mastery={mastery} />
            <Section title="Topic mastery">
              <MasteryHeatmap syllabus={syllabus} mastery={mastery} />
            </Section>
            <Button title="Share progress report (PDF)" icon="share" variant="secondary" onPress={share} loading={sharing} />
          </View>
        ) : (
          <EmptyState title="No syllabus set" />
        )
      ) : null}

      {tab === 'notes' ? <NotesFeed notes={notes.data ?? []} lessons={studentLessons} loading={notes.isLoading} /> : null}
      {tab === 'homework' ? <HomeworkList items={hw} loading={homework.isLoading} /> : null}
    </View>
  );
}

export function NotesFeed({ notes, lessons, loading, limit }: { notes: LessonNote[]; lessons: Lesson[]; loading?: boolean; limit?: number }) {
  const lookup = useLookup();
  const me = useMe();
  const theme = useTheme();
  if (loading) return <Loading />;
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const sorted = [...notes]
    .filter((n) => byId.has(n.lessonId))
    .sort((a, b) => byId.get(b.lessonId)!.start.localeCompare(byId.get(a.lessonId)!.start))
    .slice(0, limit);
  if (sorted.length === 0) return <EmptyState icon="doc" title="No lesson notes yet" message="Notes appear here after each lesson." />;
  return (
    <View style={{ gap: Spacing.two }}>
      {sorted.map((n) => {
        const l = byId.get(n.lessonId)!;
        return (
          <Card key={n.lessonId} accent={lookup.tutor(l.tutorId)?.color}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="h3">{relativeDay(l.start)}</Txt>
              <Txt variant="small">{lookup.tutor(l.tutorId)?.fullName}</Txt>
            </Row>
            <Txt>{n.summary}</Txt>
            {n.topicIds.length ? (
              <Row gap={4} wrap>
                {n.topicIds.map((t) => (
                  <Badge key={t} label={topicName(t)} tone="neutral" />
                ))}
              </Row>
            ) : null}
            {n.privateNote && (me.role === 'admin' || me.role === 'tutor') ? (
              <Txt variant="small" style={{ color: theme.warning }}>
                Private: {n.privateNote}
              </Txt>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

export function HomeworkList({ items, loading, canTick = true }: { items: Homework[]; loading?: boolean; canTick?: boolean }) {
  const theme = useTheme();
  const toggle = useAction(source.setHomeworkDone);
  if (loading) return <Loading />;
  if (items.length === 0) return <EmptyState icon="book" title="No homework set" />;
  const today = toDateKey(new Date());
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done) || b.dueDate.localeCompare(a.dueDate));
  return (
    <View style={{ gap: Spacing.two }}>
      {sorted.map((h) => {
        const overdue = !h.done && h.dueDate < today;
        return (
          <Card
            key={h.id}
            onPress={canTick ? () => toggle.mutate([h.id, !h.done]) : undefined}
            accessibilityLabel={`${h.title}, ${h.done ? 'done' : 'not done'}`}>
            <Row gap={Spacing.three}>
              <Icon name={h.done ? 'check' : 'circle'} size={24} color={h.done ? theme.success : theme.textMuted} />
              <View style={{ flex: 1 }}>
                <Txt style={h.done && { textDecorationLine: 'line-through', color: theme.textMuted }}>{h.title}</Txt>
                <Txt variant="small">Due {relativeDay(h.dueDate + 'T12:00:00')}</Txt>
              </View>
              {overdue ? <Badge label="Overdue" tone="danger" /> : null}
            </Row>
          </Card>
        );
      })}
    </View>
  );
}
