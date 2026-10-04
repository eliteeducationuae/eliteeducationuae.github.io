import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAction, useEnrolments, useHomework, useLessons, useLookup, useNotes, useRatings, useSettings, useTopicLookup } from '@/data/hooks';
import { source } from '@/data';
import { useMe } from '@/data/session';
import { addDays, daysUntil, formatDate, relativeDay, toDateKey } from '@/domain/dates';
import { activeEnrolments, enrolmentDetail, enrolmentTitle, lessonSubject, sameSubject, studentSubjects } from '@/domain/enrolments';
import { masteryByTopic, type Syllabus } from '@/domain/progress';
import type { Enrolment, Homework, Lesson, LessonNote, Student, TopicRating } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { shareProgressReport } from '@/lib/report';

import { Icon } from './icon';
import { MasteryHeatmap, ProgressSummary } from './progress';
import { Badge, Button, Card, Chip, EmptyState, Loading, Row, Section, Segmented, Stat, StatGrid, Txt } from './ui';

const HISTORY_FROM = addDays(new Date(), -365);
const HISTORY_TO = addDays(new Date(), 90);

/** Ratings that belong to one subject: topics in its tree, or topics the lookup files under that subject. */
export function ratingsForSubject(
  ratings: TopicRating[],
  tree: Syllabus,
  subject: string | undefined,
  subjectOf: (topicId: string) => string | undefined,
): TopicRating[] {
  const inTree = new Set(tree.units.flatMap((u) => u.topics.map((t) => t.id)));
  return ratings.filter((r) => inTree.has(r.topicId) || (!!subject && sameSubject(subjectOf(r.topicId), subject)));
}

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

  const enrolments = useEnrolments(student.id);
  const topics = useTopicLookup();
  const [subjectId, setSubjectId] = useState<string | null>(null);

  const allEnrolments = enrolments.data ?? [];
  const subjects = activeEnrolments(allEnrolments, student.id);
  const selected: Enrolment | undefined = subjects.find((e) => e.id === subjectId) ?? subjects[0];
  // Students recorded before subjects existed keep their original syllabus until they are given one.
  const legacy = subjects.length ? undefined : topics.builtIn(student.syllabusId);
  const tree: Syllabus | undefined = selected ? topics.treeFor(selected) : legacy;
  const subjectRatings = tree ? ratingsForSubject(ratings.data ?? [], tree, selected?.subject, topics.subjectOf) : [];
  const mastery = masteryByTopic(subjectRatings);
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
  const firstName = student.fullName.split(' ')[0];
  const subtitle = [studentSubjects(allEnrolments, student.id) || legacy?.name || student.curriculum, student.yearGroup, student.school]
    .filter(Boolean)
    .join(' · ');
  const badge = student.phase ?? subjects[0]?.curriculum ?? student.curriculum;
  const selectedTitle = selected ? enrolmentTitle(selected) : legacy?.name;
  const selectedDetail = selected ? enrolmentDetail(selected, selected.tutorId ? lookup.tutor(selected.tutorId)?.fullName : undefined) : '';

  async function share() {
    if (!tree || !settings.data) return;
    // Lessons (and their notes) for this subject, plus older lessons whose subject was never recorded.
    const subjectLessons = selected
      ? studentLessons.filter((l) => {
          const s = lessonSubject(l, allEnrolments);
          return !s || sameSubject(s, selected.subject);
        })
      : studentLessons;
    const lessonIds = new Set(subjectLessons.map((l) => l.id));
    setSharing(true);
    try {
      await shareProgressReport({
        student,
        syllabus: tree,
        ratings: subjectRatings,
        notes: (notes.data ?? []).filter((n) => lessonIds.has(n.lessonId)),
        lessons: subjectLessons,
        homework: hw,
        businessName: settings.data.businessName,
        topicName: topics.name,
        subject: selectedTitle,
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
            {subtitle ? <Txt variant="muted">{subtitle}</Txt> : null}
          </View>
          {badge ? <Badge label={badge} tone="gold" /> : null}
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
        {daysToExam !== null && daysToExam > 0 ? <Stat label="Exams in" value={`${daysToExam} ${daysToExam === 1 ? 'day' : 'days'}`} hint={formatDate(student.examDate!)} /> : null}
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
        ratings.isLoading || enrolments.isLoading || !topics.ready ? (
          <Loading />
        ) : tree ? (
          <View style={{ gap: Spacing.three }}>
            {subjects.length > 1 && subjects.length <= 3 ? (
              <Segmented value={selected!.id} onChange={setSubjectId} options={subjects.map((e) => ({ value: e.id, label: e.subject }))} />
            ) : subjects.length > 3 ? (
              <Row gap={Spacing.one} wrap>
                {subjects.map((e) => (
                  <Chip key={e.id} label={e.subject} selected={selected?.id === e.id} onPress={() => setSubjectId(e.id)} />
                ))}
              </Row>
            ) : null}
            {selected ? (
              <View style={{ gap: 2 }}>
                <Txt variant="h3">{selectedTitle}</Txt>
                {selectedDetail ? <Txt variant="small">{selectedDetail}</Txt> : null}
              </View>
            ) : null}
            {tree.units.length ? (
              <>
                <ProgressSummary syllabus={tree} mastery={mastery} />
                <Section title="Topic mastery">
                  <MasteryHeatmap syllabus={tree} mastery={mastery} />
                </Section>
                <Button title="Share progress report (PDF)" icon="share" variant="secondary" onPress={share} loading={sharing} />
              </>
            ) : (
              <EmptyState title="No topics yet" message={`Topics will appear here as ${firstName}’s tutor records lessons.`} />
            )}
          </View>
        ) : (
          <EmptyState title="No subjects yet" message={`Topics will appear here as ${firstName}’s tutor records lessons.`} />
        )
      ) : null}

      {tab === 'notes' ? <NotesFeed notes={notes.data ?? []} lessons={studentLessons} loading={notes.isLoading} /> : null}
      {tab === 'homework' ? <HomeworkList items={hw} loading={homework.isLoading} /> : null}
    </View>
  );
}

export function NotesFeed({ notes, lessons, loading, limit }: { notes: LessonNote[]; lessons: Lesson[]; loading?: boolean; limit?: number }) {
  const lookup = useLookup();
  const topics = useTopicLookup();
  const enrolments = useEnrolments();
  const me = useMe();
  const theme = useTheme();
  if (loading) return <Loading />;
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const sorted = [...notes]
    .filter((n) => byId.has(n.lessonId))
    .sort((a, b) => byId.get(b.lessonId)!.start.localeCompare(byId.get(a.lessonId)!.start))
    .slice(0, limit);
  if (sorted.length === 0) return <EmptyState icon="doc" title="No lesson notes yet" message="Notes from each lesson will appear here as soon as they are written." />;
  return (
    <View style={{ gap: Spacing.two }}>
      {sorted.map((n) => {
        const l = byId.get(n.lessonId)!;
        const subject = lessonSubject(l, enrolments.data ?? []);
        return (
          <Card key={n.lessonId} accent={lookup.tutor(l.tutorId)?.color}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="h3" style={{ flexShrink: 1 }}>
                {relativeDay(l.start)}
                {subject ? ` · ${subject}` : ''}
              </Txt>
              <Txt variant="small">{lookup.tutor(l.tutorId)?.fullName}</Txt>
            </Row>
            <Txt>{n.summary}</Txt>
            {n.topicIds.length ? (
              <Row gap={4} wrap>
                {n.topicIds.map((t) => (
                  <Badge key={t} label={topics.name(t)} tone="neutral" />
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
  if (items.length === 0) return <EmptyState icon="book" title="No homework set" message="Homework will appear here as soon as it is set." />;
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
