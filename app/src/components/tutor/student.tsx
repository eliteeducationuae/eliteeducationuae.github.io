/**
 * A student's page as their tutor sees it (2026 redesign): Overview, Notes, Homework and Topics. Topic ratings
 * are read-only here (they are set when a lesson is recorded). The family appears by name and relationship
 * only: tutors never see a family's email address or phone number.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { StudentSubjectRates } from '@/components/rates';
import { SharedResources } from '@/components/resources';
import { Actions, Button, Columns, EmptyState, Figure, Figures, Group, GroupRow, Loading, PageHeader, Prose, Screen, Tabs, Txt } from '@/components/ui';
import { MasteryColors } from '@/constants/theme';
import { useEnrolments, useFamilyContacts, useHandovers, useHomework, useLessons, useLookup, useNotes, useRatings, useSubmissions, useTopicLookup } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { RELATIONSHIP_LABELS } from '@/domain/contacts';
import { addDays, formatDay, toDateKey } from '@/domain/dates';
import { activeEnrolments, enrolmentTitle, sameSubject, studentSubjects } from '@/domain/enrolments';
import { dueLabel, HOMEWORK_STATUS_LABEL, homeworkStatus } from '@/domain/homework';
import { masteryByTopic, RATING_LABELS } from '@/domain/progress';
import type { Student } from '@/domain/types';

import { firstName, LessonRow } from './common';

type Tab = 'overview' | 'notes' | 'homework' | 'topics';
const HISTORY_FROM = addDays(new Date(), -365);
const HISTORY_TO = addDays(new Date(), 60);

export function TutorStudentPage({ student }: { student: Student }) {
  const me = useMe();
  const viewing = !!useViewing();
  const lookup = useLookup();
  const enrolments = useEnrolments(student.id);
  const notes = useNotes({ studentId: student.id });
  const homework = useHomework(student.id);
  const submissions = useSubmissions({ studentId: student.id });
  const ratings = useRatings(student.id);
  const topics = useTopicLookup();
  const lessons = useLessons(HISTORY_FROM, HISTORY_TO);
  const handovers = useHandovers({ studentId: student.id });
  const contacts = useFamilyContacts(student.familyId);
  const [tab, setTab] = useState<Tab>('overview');
  const [now] = useState(() => new Date());

  const first = firstName(student.fullName);
  const family = lookup.family(student.familyId);
  const subjects = activeEnrolments(enrolments.data ?? [], student.id);
  const mySubjects = subjects.filter((e) => !e.tutorId || e.tutorId === me.tutorId);
  const studentLessons = useMemo(() => (lessons.data ?? []).filter((l) => l.studentIds.includes(student.id)).sort((a, b) => a.start.localeCompare(b.start)), [lessons.data, student.id]);
  const taught = studentLessons.filter((l) => l.status === 'completed' || l.status === 'no-show');
  const attendance = taught.length ? Math.round((taught.filter((l) => l.status === 'completed').length / taught.length) * 100) : null;
  const hw = homework.data ?? [];
  const hwRate = hw.length ? Math.round((hw.filter((h) => h.done).length / hw.length) * 100) : null;
  const upcoming = studentLessons.filter((l) => new Date(l.end) > now && l.status === 'scheduled').slice(0, 3);
  const recent = studentLessons.filter((l) => new Date(l.end) <= now).slice(-3).reverse();
  const handover = (handovers.data ?? []).find((h) => h.fromTutorId === me.tutorId);
  const lessonById = new Map(studentLessons.map((l) => [l.id, l]));
  const noteList = [...(notes.data ?? [])].sort((a, b) => (lessonById.get(b.lessonId)?.start ?? b.createdAt).localeCompare(lessonById.get(a.lessonId)?.start ?? a.createdAt));
  const today = toDateKey(now);

  const setHomework = () => router.push(`/homework/new?studentId=${student.id}`);

  return (
    <Screen topInset onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <PageHeader
        back={{ fallback: '/tutor/students' }}
        kicker={studentSubjects(enrolments.data ?? [], student.id) || student.curriculum || 'Student'}
        title={student.fullName}
        sub={[student.yearGroup, student.school, family ? `The ${family.name} family` : null].filter(Boolean).join(' · ')}
      />
      <Tabs
        accessibilityLabel={`${first}’s pages`}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'notes', label: 'Notes' },
          { value: 'homework', label: 'Homework' },
          { value: 'topics', label: 'Topics' },
        ]}
      />

      {tab === 'overview' ? (
        <>
          <Figures>
            <Figure label="Attendance" value={attendance === null ? '–' : `${attendance}%`} hint={`${taught.length} lessons`} />
            <Figure label="Homework" value={hwRate === null ? '–' : `${hwRate}%`} hint="completed" tone={hwRate !== null && hwRate < 60 ? 'warn' : undefined} />
            <Figure
              label="Working at"
              value={student.currentGrade ?? '–'}
              hint={student.targetGrade ? `target ${student.targetGrade}` : 'no target set'}
              tone="highlight"
            />
          </Figures>
          <Columns>
            {student.notes ? <Prose title={`About ${first}`} paragraphs={[student.notes]} /> : null}
            <Group title="Lessons" note={upcoming.length || recent.length ? undefined : 'No lessons yet.'}>
              {[...upcoming, ...recent].map((l) => (
                <LessonRow key={l.id} lesson={l} now={now} />
              ))}
            </Group>
            {(contacts.data ?? []).length ? (
              <Group title="Family" meta="Message them in the app">
                {(contacts.data ?? []).map((c) => (
                  <GroupRow key={c.id} avatar={c.name} title={c.name} note={`${RELATIONSHIP_LABELS[c.relationship]}${c.isPrimary ? ' · main contact' : ''}`} />
                ))}
              </Group>
            ) : null}
          </Columns>
          {mySubjects.length ? (
            <Columns>
              {mySubjects.map((e) => (
                <View key={e.id} style={{ gap: 10 }}>
                  <Txt variant="groupTitle">{enrolmentTitle(e)}</Txt>
                  <StudentSubjectRates enrolment={e} student={student} />
                </View>
              ))}
            </Columns>
          ) : null}
          <Actions>
            {!viewing ? <Button title="Set homework" icon="assignment" onPress={setHomework} /> : null}
            {!viewing && family ? (
              <Button
                title={`Message the ${family.name} family`}
                icon="forum"
                variant="secondary"
                onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: family.id } })}
              />
            ) : null}
            {handover ? (
              <Button title="Handover note" icon="swap_horiz" variant="secondary" onPress={() => router.push({ pathname: '/handover/[id]', params: { id: handover.id } })} />
            ) : null}
          </Actions>
        </>
      ) : null}

      {tab === 'notes' ? (
        notes.isLoading ? (
          <Loading />
        ) : noteList.length ? (
          <Group>
            {noteList.map((n) => {
              const l = lessonById.get(n.lessonId);
              const names = n.topicIds.map((t) => topics.name(t));
              return (
                <GroupRow
                  key={n.lessonId}
                  icon="notes"
                  title={names.length ? names.slice(0, 3).join(', ') : 'Lesson note'}
                  note={l ? `${formatDay(l.start)}${l.tutorId !== me.tutorId ? ` · ${lookup.tutor(l.tutorId)?.fullName ?? 'another tutor'}` : ''}` : undefined}
                  body={[n.summary || 'No summary was written.', n.privateNote ? `For the office only: ${n.privateNote}` : ''].filter(Boolean).join('\n\n')}
                />
              );
            })}
          </Group>
        ) : (
          <EmptyState icon="notes" title="No lesson notes yet" message="Notes appear here as soon as lessons are recorded." />
        )
      ) : null}

      {tab === 'homework' ? (
        <>
          {homework.isLoading ? (
            <Loading />
          ) : hw.length ? (
            <Group>
              {[...hw]
                .sort((a, b) => Number(a.done) - Number(b.done) || b.dueDate.localeCompare(a.dueDate))
                .map((h) => {
                  const s = homeworkStatus(h, submissions.data ?? [], today);
                  const open = s === 'due' || s === 'overdue';
                  return (
                    <GroupRow
                      key={h.id}
                      icon={open ? 'assignment' : 'task_alt'}
                      tone={s === 'overdue' ? 'bad' : open ? 'warn' : 'good'}
                      title={h.title}
                      note={[dueLabel(h.dueDate, now), (h.attachments ?? []).length ? `${(h.attachments ?? []).length} attachment${(h.attachments ?? []).length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                      value={HOMEWORK_STATUS_LABEL[s].label}
                      valueTone={s === 'overdue' ? 'bad' : open ? 'accent' : 'good'}
                      valueSize={12.5}
                      accessibilityLabel={`${h.title}, ${dueLabel(h.dueDate, now).replace(/^Due/, 'due')}, ${HOMEWORK_STATUS_LABEL[s].label}`}
                      onPress={() => router.push(`/homework/${h.id}`)}
                    />
                  );
                })}
            </Group>
          ) : (
            <EmptyState icon="assignment" title="No homework set" message="Homework will appear here as soon as it is set." />
          )}
          <SharedResources studentId={student.id} />
          {!viewing ? (
            <Actions>
              <Button title="Set homework" icon="assignment" onPress={setHomework} />
            </Actions>
          ) : null}
        </>
      ) : null}

      {tab === 'topics' ? (
        ratings.isLoading || !topics.ready ? (
          <Loading />
        ) : (
          <TopicsTab student={student} ratings={ratings.data ?? []} subjects={mySubjects.length ? mySubjects : subjects} />
        )
      ) : null}
    </Screen>
  );
}

function TopicsTab({
  student,
  ratings,
  subjects,
}: {
  student: Student;
  ratings: NonNullable<ReturnType<typeof useRatings>['data']>;
  subjects: ReturnType<typeof activeEnrolments>;
}) {
  const topics = useTopicLookup();
  const mastery = masteryByTopic(ratings);
  const rated = [...mastery.values()];
  if (!rated.length) {
    return <EmptyState icon="bar_chart" title="No topics rated yet" message={`Ratings appear here as you record ${firstName(student.fullName)}’s lessons.`} />;
  }
  // One group per subject the tutor teaches; ratings that belong to no listed subject go under "Other topics".
  const groups = subjects.map((e) => ({
    title: enrolmentTitle(e),
    items: rated.filter((m) => sameSubject(topics.subjectOf(m.topicId), e.subject)),
  }));
  const placed = new Set(groups.flatMap((g) => g.items.map((m) => m.topicId)));
  const other = rated.filter((m) => !placed.has(m.topicId));
  const all = [...groups, ...(other.length ? [{ title: groups.length ? 'Other topics' : 'Topics', items: other }] : [])].filter((g) => g.items.length);
  return (
    <>
      {all.map((g, i) => (
        <Group key={g.title} title={g.title} note={i === 0 ? 'Ratings come from your lesson records. The family sees them in their app.' : undefined}>
          {[...g.items]
            .sort((a, b) => b.rating - a.rating)
            .map((m) => {
              const r = Math.min(5, Math.max(1, Math.round(m.rating)));
              return (
                <GroupRow
                  key={m.topicId}
                  title={topics.name(m.topicId)}
                  progress={r * 20}
                  progressColor={MasteryColors[r - 1]}
                  value={RATING_LABELS[r]}
                  valueTone="text"
                  valueSize={13}
                />
              );
            })}
        </Group>
      ))}
    </>
  );
}
