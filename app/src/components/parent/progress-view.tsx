import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { MasteryColors } from '@/constants/theme';
import {
  useEnrolments,
  useHomework,
  useLessons,
  useLookup,
  useNotes,
  useRatings,
  useReportCycles,
  useResources,
  useSettings,
  useStudentReports,
  useSubmissions,
  useTopicLookup,
} from '@/data/hooks';
import { useViewing } from '@/data/session';
import { addDays, daysUntil, formatTime, toDateKey } from '@/domain/dates';
import { activeEnrolments, enrolmentTitle, lessonSubject, sameSubject } from '@/domain/enrolments';
import { HOMEWORK_STATUS_LABEL, homeworkStatus, resourceAttachment } from '@/domain/homework';
import { masteryByTopic, type Syllabus } from '@/domain/progress';
import type { Enrolment, Homework, Lesson, Student } from '@/domain/types';
import { shareProgressReport } from '@/lib/report';

import { StudentSubjectRates } from '../rates';
import { openAttachment } from '../resources';
import { ratingsForSubject } from '../student-overview';
import { Actions, Button, ChipField, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, Notice, Prose, Tabs, TextLink, Txt } from '../ui';
import { chipFor, dayMonth, firstName, levelLabel, longDay } from './format';
import { openMessages } from './hooks';

const HISTORY_FROM = addDays(new Date(), -365);
const HISTORY_TO = addDays(new Date(), 90);

export type ProgressTab = 'overview' | 'topics' | 'notes' | 'homework' | 'reports';
export const PROGRESS_TABS: { value: ProgressTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'topics', label: 'Topics' },
  { value: 'notes', label: 'Lesson notes' },
  { value: 'homework', label: 'Homework' },
  { value: 'reports', label: 'Reports' },
];

/** The family's view of one child's learning: overview, topic levels, notes, homework and reports. */
export function ChildProgress({ student, tab, onTab }: { student: Student; tab: ProgressTab; onTab: (t: ProgressTab) => void }) {
  const lookup = useLookup();
  const lessons = useLessons(HISTORY_FROM, HISTORY_TO);
  const notes = useNotes({ studentId: student.id });
  const homework = useHomework(student.id);
  const submissions = useSubmissions({ studentId: student.id });
  const ratings = useRatings(student.id);
  const enrolments = useEnrolments(student.id);
  const reports = useStudentReports();
  const cycles = useReportCycles();
  const topics = useTopicLookup();
  const [open, setOpen] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const studentLessons = useMemo(() => (lessons.data ?? []).filter((l) => l.studentIds.includes(student.id)), [lessons.data, student.id]);
  if (lessons.isLoading || enrolments.isLoading) return <Loading />;

  const subjects = activeEnrolments(enrolments.data ?? [], student.id);
  const lessonById = new Map(studentLessons.map((l) => [l.id, l]));
  const sortedNotes = (notes.data ?? [])
    .filter((n) => lessonById.has(n.lessonId))
    .sort((a, b) => lessonById.get(b.lessonId)!.start.localeCompare(lessonById.get(a.lessonId)!.start));
  const hw = homework.data ?? [];
  const subs = submissions.data ?? [];
  const todayKey = toDateKey(now);
  const published = (reports.data ?? [])
    .filter((r) => r.studentId === student.id && r.status === 'published')
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  const cycleName = (id: string) => cycles.data?.find((c) => c.id === id)?.name ?? 'Progress';
  const tutorName = (id?: string) => (id ? lookup.tutor(id)?.fullName : undefined);
  const subjectOf = (l: Lesson) => lessonSubject(l, enrolments.data ?? []);

  // A child with no subjects and no lessons yet is waiting for their consultation.
  if (!subjects.length && !studentLessons.length) {
    return (
      <>
        <Notice tone="info" icon="favorite" title="Getting started">
          {`We will call you within one working day to arrange ${firstName(student.fullName)}’s complimentary consultation. Lesson notes, homework and progress will appear here once lessons begin.`}
        </Notice>
        <ViewingAware>
          <Actions>
            <Button title="Message us" icon="forum" onPress={() => openMessages(`About ${firstName(student.fullName)}: `)} />
          </Actions>
        </ViewingAware>
      </>
    );
  }

  const taught = studentLessons.filter((l) => l.status === 'completed' || l.status === 'no-show');
  const attendance = taught.length ? Math.round((taught.filter((l) => l.status === 'completed').length / taught.length) * 100) : null;
  const doneHw = hw.filter((h) => h.done || ['submitted', 'reviewed', 'done'].includes(homeworkStatus(h, subs, todayKey)));
  const hwRate = hw.length ? Math.round((doneHw.length / hw.length) * 100) : null;
  const toDo = hw.filter((h) => !doneHw.includes(h)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const finished = hw.filter((h) => doneHw.includes(h)).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const allMastery = masteryByTopic(ratings.data ?? []);
  const practise = [...allMastery.values()].filter((m) => m.rating <= 3).sort((a, b) => a.rating - b.rating).slice(0, 4);
  const daysToExam = student.examDate ? daysUntil(student.examDate, now) : null;
  const firstTaught = taught.length ? [...taught].sort((a, b) => a.start.localeCompare(b.start))[0] : undefined;
  const latestNote = sortedNotes[0];
  const latestLesson = latestNote ? lessonById.get(latestNote.lessonId) : undefined;
  const firstTutor = tutorName(subjects[0]?.tutorId ?? studentLessons[studentLessons.length - 1]?.tutorId);

  const homeworkRow = (h: Homework) => {
    const status = homeworkStatus(h, subs, todayKey);
    const done = doneHw.includes(h);
    const files = (h.attachments ?? []).length;
    return (
      <GroupRow
        key={h.id}
        icon={done ? 'task_alt' : 'edit_note'}
        tone={done ? 'good' : status === 'overdue' ? 'bad' : 'warn'}
        title={h.title}
        note={`${h.createdAt ? `Set ${dayMonth(h.createdAt)} · ` : ''}Due ${longDay(`${h.dueDate}T12:00:00`)}${files ? ` · ${files === 1 ? 'one attachment' : `${files} attachments`}` : ''}`}
        value={HOMEWORK_STATUS_LABEL[status].label}
        valueTone={status === 'overdue' ? 'bad' : done ? 'good' : 'muted'}
        valueSize={13}
        expanded={open === h.id}
        onToggle={() => setOpen(open === h.id ? null : h.id)}
        body={
          <View style={{ gap: 10, alignItems: 'flex-start' }}>
            <Txt style={{ fontSize: 14.5, lineHeight: 22.5 }}>{h.details?.trim() || 'No further instructions.'}</Txt>
            <TextLink label="Open the homework" onPress={() => router.push(`/homework/${h.id}`)} underline />
          </View>
        }
      />
    );
  };

  return (
    <>
      <Tabs tabs={PROGRESS_TABS} value={tab} onChange={onTab} accessibilityLabel={`${firstName(student.fullName)}’s progress`} />

      {tab === 'overview' ? (
        <>
          <Figures>
            <Figure label="Attendance" value={attendance === null ? '–' : `${attendance}%`} hint={firstTaught ? `since ${dayMonth(firstTaught.start)}` : 'no lessons yet'} />
            <Figure label="Homework" value={hwRate === null ? '–' : `${hwRate}%`} hint={hw.length ? 'handed in or done' : 'none set yet'} />
            {student.currentGrade ? (
              <Figure label="Working at" value={student.currentGrade} hint={student.targetGrade ? `target grade ${student.targetGrade}` : undefined} tone="highlight" />
            ) : null}
            {daysToExam !== null && daysToExam > 0 ? (
              <Figure label="Exams in" value={`${daysToExam} ${daysToExam === 1 ? 'day' : 'days'}`} hint={dayMonth(student.examDate!)} />
            ) : null}
          </Figures>
          <Columns>
            {latestNote && latestLesson ? (
              <Prose
                title={`Latest from ${firstName(tutorName(latestLesson.tutorId)) || 'your tutor'}`}
                by={[longDay(latestLesson.start), subjectOf(latestLesson), latestNote.topicIds.map((t) => topics.name(t)).slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
                paragraphs={[latestNote.summary]}
              />
            ) : (
              <Group title="Latest lesson note" note="Notes from each lesson will appear here as soon as they are written." />
            )}
            <Group title="Due soon">
              {toDo.length ? (
                toDo.slice(0, 3).map((h) => (
                  <GroupRow
                    key={h.id}
                    icon="edit_note"
                    tone={h.dueDate < todayKey ? 'bad' : 'warn'}
                    title={h.title}
                    note={`Due ${longDay(`${h.dueDate}T12:00:00`)}`}
                    onPress={() => {
                      setOpen(h.id);
                      onTab('homework');
                    }}
                  />
                ))
              ) : (
                <GroupRow icon="task_alt" tone="good" title="Nothing due" note="All homework is handed in." />
              )}
            </Group>
            {practise.length ? (
              <Group title="Topics to keep practising" link={{ label: 'All topics', onPress: () => onTab('topics') }}>
                {practise.map((m) => (
                  <GroupRow
                    key={m.topicId}
                    title={topics.name(m.topicId)}
                    progress={m.rating * 20}
                    progressColor={MasteryColors[m.rating - 1]}
                    value={levelLabel(m.rating)}
                    valueSize={13}
                  />
                ))}
              </Group>
            ) : null}
            {published.length ? (
              <Group title="Reports">
                {published.slice(0, 2).map((r) => (
                  <GroupRow
                    key={r.id}
                    icon="description"
                    title={`${cycleName(r.cycleId)} report`}
                    note={[r.subject, r.publishedAt ? `sent ${dayMonth(r.publishedAt)}` : ''].filter(Boolean).join(' · ')}
                    onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })}
                  />
                ))}
              </Group>
            ) : null}
          </Columns>
        </>
      ) : null}

      {tab === 'topics' ? <TopicsTab student={student} subjects={subjects} tutor={firstTutor} studentLessons={studentLessons} /> : null}

      {tab === 'notes' ? (
        sortedNotes.length ? (
          <>
            <Group>
              {sortedNotes.map((n) => {
                const l = lessonById.get(n.lessonId)!;
                const mark = n.attendance[student.id];
                const topicNames = n.topicIds.map((t) => topics.name(t)).join(', ');
                return (
                  <GroupRow
                    key={n.lessonId}
                    date={chipFor(l.start)}
                    title={topicNames || subjectOf(l) || 'Lesson'}
                    note={[`${formatTime(l.start)} to ${formatTime(l.end)}`, subjectOf(l) && topicNames ? subjectOf(l) : '', mark === 'absent' ? 'absent' : mark === 'late' ? 'arrived late' : mark ? 'attended' : '', firstName(tutorName(l.tutorId))]
                      .filter(Boolean)
                      .join(' · ')}
                    expanded={open === n.lessonId}
                    onToggle={() => setOpen(open === n.lessonId ? null : n.lessonId)}
                    body={n.summary || 'No summary has been written yet.'}
                  />
                );
              })}
            </Group>
            <ViewingAware>
              <Actions>
                <Button title={`Message ${firstName(firstTutor) || 'us'}`} icon="forum" variant="secondary" onPress={() => openMessages(firstTutor ? `Hello ${firstName(firstTutor)}, ` : undefined)} />
              </Actions>
            </ViewingAware>
          </>
        ) : (
          <EmptyState icon="edit_note" title="No lesson notes yet" message="Notes from each lesson will appear here as soon as they are written." />
        )
      ) : null}

      {tab === 'homework' ? (
        hw.length ? (
          <Columns>
            <Group title="To do">{toDo.length ? toDo.map(homeworkRow) : <GroupRow icon="task_alt" tone="good" title="Nothing to do" note="All homework is handed in." />}</Group>
            <SharedFiles studentId={student.id} />
            {finished.length ? <Group title="Handed in">{finished.map(homeworkRow)}</Group> : null}
          </Columns>
        ) : (
          <>
            <EmptyState icon="edit_note" title="No homework set" message="Homework will appear here as soon as it is set." />
            <SharedFiles studentId={student.id} />
          </>
        )
      ) : null}

      {tab === 'reports' ? (
        published.length ? (
          <Group>
            {published.map((r) => (
              <GroupRow
                key={r.id}
                icon="description"
                title={`${cycleName(r.cycleId)} report`}
                note={[r.subject, tutorName(r.tutorId), r.publishedAt ? `sent ${dayMonth(r.publishedAt)}` : ''].filter(Boolean).join(' · ')}
                onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })}
              />
            ))}
          </Group>
        ) : (
          <EmptyState icon="description" title="No reports yet" message="Reports from your child’s tutors will appear here once they are sent." />
        )
      ) : null}
    </>
  );
}

/** Hides its children while an admin is viewing the app as this family. */
function ViewingAware({ children }: { children: React.ReactNode }) {
  const viewing = useViewing();
  return viewing ? null : <>{children}</>;
}

/** Files and links the tutors have shared with this child. */
function SharedFiles({ studentId }: { studentId: string }) {
  const resources = useResources({ studentId });
  const list = (resources.data ?? []).filter((r) => r.studentIds.includes(studentId));
  if (!list.length) return null;
  return (
    <Group title="Shared by the tutors">
      {list.map((r) => (
        <GroupRow
          key={r.id}
          icon={r.kind === 'link' ? 'link' : r.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'description'}
          title={r.title}
          note={[r.subject, r.uploadedByName ? `Shared by ${r.uploadedByName}` : ''].filter(Boolean).join(' · ') || undefined}
          action={{ label: 'Open', onPress: () => void openAttachment(resourceAttachment(r)), accessibilityLabel: `Open ${r.title}` }}
        />
      ))}
    </Group>
  );
}

/** Each rated topic with its level, per subject, and the progress report download. */
function TopicsTab({ student, subjects, tutor, studentLessons }: { student: Student; subjects: Enrolment[]; tutor?: string; studentLessons: Lesson[] }) {
  const ratings = useRatings(student.id);
  const topics = useTopicLookup();
  const settings = useSettings();
  const notes = useNotes({ studentId: student.id });
  const homework = useHomework(student.id);
  const enrolments = useEnrolments(student.id);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  if (ratings.isLoading || !topics.ready) return <Loading />;
  const selected = subjects.find((e) => e.id === subjectId) ?? subjects[0];
  const legacy = subjects.length ? undefined : topics.builtIn(student.syllabusId);
  const tree: Syllabus | undefined = selected ? topics.treeFor(selected) : legacy;
  const subjectRatings = tree ? ratingsForSubject(ratings.data ?? [], tree, selected?.subject, topics.subjectOf) : ratings.data ?? [];
  const mastery = masteryByTopic(subjectRatings);
  // In the order of the syllabus, then anything rated outside it.
  const order = tree ? tree.units.flatMap((u) => u.topics.map((t) => t.id)) : [];
  const rated = [...mastery.values()].sort((a, b) => {
    const ia = order.indexOf(a.topicId);
    const ib = order.indexOf(b.topicId);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || topics.name(a.topicId).localeCompare(topics.name(b.topicId));
  });
  const repeated = subjects.some((e, i) => subjects.findIndex((o) => sameSubject(o.subject, e.subject)) !== i);
  const title = selected ? (topics.builtIn(selected.syllabusId)?.name ?? enrolmentTitle(selected)) : legacy?.name;

  async function share() {
    if (!tree || !settings.data) return;
    const subjectLessons = selected
      ? studentLessons.filter((l) => {
          const s = lessonSubject(l, enrolments.data ?? []);
          return !s || sameSubject(s, selected.subject);
        })
      : studentLessons;
    const ids = new Set(subjectLessons.map((l) => l.id));
    setSharing(true);
    try {
      await shareProgressReport({
        student,
        syllabus: tree,
        ratings: subjectRatings,
        notes: (notes.data ?? []).filter((n) => ids.has(n.lessonId)),
        lessons: subjectLessons,
        homework: homework.data ?? [],
        businessName: settings.data.businessName,
        topicName: topics.name,
        subject: title,
      });
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      {subjects.length > 1 ? (
        <ChipField
          label="Subject"
          options={subjects.map((e) => ({ value: e.id, label: repeated ? enrolmentTitle(e) : e.subject }))}
          value={selected?.id}
          onChange={setSubjectId}
        />
      ) : null}
      {/* The family's agreed price for this subject, where there is one (existing rates card). */}
      <StudentSubjectRates enrolment={selected} student={student} />
      {rated.length ? (
        <Group
          title={subjects.length > 1 ? title : undefined}
          note={`${firstName(tutor) || 'The tutor'} rates each topic after the lessons that cover it, from just started to secure.`}>
          {rated.map((m) => (
            <GroupRow
              key={m.topicId}
              title={topics.name(m.topicId)}
              progress={m.rating * 20}
              progressColor={MasteryColors[m.rating - 1]}
              value={levelLabel(m.rating)}
              valueSize={13}
              note={m.trend > 0 ? 'Improving' : m.trend < 0 ? 'Needs another look' : undefined}
            />
          ))}
        </Group>
      ) : (
        <EmptyState icon="monitoring" title="No topics yet" message={`Topics will appear here as ${firstName(student.fullName)}’s tutor records lessons.`} />
      )}
      {tree && tree.units.length && rated.length ? (
        <Actions>
          <Button title="Download progress report (PDF)" icon="download" variant="secondary" loading={sharing} onPress={share} />
        </Actions>
      ) : null}
    </>
  );
}
