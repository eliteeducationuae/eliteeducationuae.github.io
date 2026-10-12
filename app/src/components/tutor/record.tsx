/**
 * Record a lesson, as its tutor (2026 redesign): attendance, topics with ratings, the note for the family,
 * homework and a private note for the office, in one pass. The tutor never sets the lesson's length or a
 * late-cancellation: those bill the family and stay with the office.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AttachmentEditor } from '@/components/attachments';
import { RatingPicker } from '@/components/progress';
import { Actions, Button, Chip, ChipField, EmptyState, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Row, Screen, Txt, useToast } from '@/components/ui';
import { getSyllabus } from '@/data/curriculum';
import { source } from '@/data';
import { PartialSaveError } from '@/data/source';
import { useAction, useEnrolments, useLesson, useLessonPlan, useLookup, useRatings, useResources, useTopicLookup } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { addDays, formatDay, formatTime, toDateKey } from '@/domain/dates';
import { enrolmentFor, enrolmentTitle, lessonSubject } from '@/domain/enrolments';
import { classworkFolder } from '@/domain/homework';
import { isPlanEmpty, prefillFromPlan, type RecordPrefill } from '@/domain/plans';
import { masteryByTopic, type Syllabus } from '@/domain/progress';
import { DEFAULT_UNIT } from '@/domain/topics';
import type { Attachment, AttendanceMark, TopicRating } from '@/domain/types';
import { confirm } from '@/lib/confirm';

import { firstName, lessonPay, lessonWhere, longDay, monthName, studentFirstNames, useMyTutor } from './common';

type Rating = TopicRating['rating'];

const ATTENDANCE: { value: AttendanceMark; label: string }[] = [
  { value: 'present', label: 'Attended' },
  { value: 'late', label: 'Arrived late' },
  { value: 'absent', label: 'Absent' },
];

/** Loads the lesson and its plan, then the form (which starts from the plan when there is one). */
export function TutorRecordPage({ id }: { id: string }) {
  const lookup = useLookup();
  const lesson = useLesson(id);
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const plan = useLessonPlan(id);
  const resources = useResources();
  if (lesson.isLoading || !lookup.ready || enrolments.isLoading || !topics.ready || plan.isLoading || resources.isLoading) return <Loading />;
  const prefill = prefillFromPlan(plan.data, lesson.data?.studentIds ?? [], resources.data ?? []);
  return <RecordForm key={plan.data?.updatedAt ?? 'none'} id={id} prefill={prefill} planned={!isPlanEmpty(plan.data)} />;
}

function RecordForm({ id, prefill, planned }: { id: string; prefill: RecordPrefill; planned: boolean }) {
  const viewing = !!useViewing();
  const toast = useToast();
  const lookup = useLookup();
  const tutor = useMyTutor();
  const lesson = useLesson(id);
  const allRatings = useRatings();
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const complete = useAction(source.completeLesson);
  const addTopic = useAction(source.addTopic);
  const queryClient = useQueryClient();

  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<'completed' | 'no-show'>('completed');
  const [attendance, setAttendance] = useState<Record<string, AttendanceMark>>({});
  const [topicIds, setTopicIds] = useState<string[]>(prefill.topicIds);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [summary, setSummary] = useState(prefill.summary);
  const [privateNote, setPrivateNote] = useState('');
  const [homework, setHomework] = useState<Record<string, string>>(prefill.homework);
  const [homeworkExtras, setHomeworkExtras] = useState<Record<string, { open: boolean; details: string; attachments: Attachment[] }>>(prefill.homeworkExtras);
  const [dueDays, setDueDays] = useState('7');
  const [browseUnit, setBrowseUnit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState<string>('none');
  const [typedUnit, setTypedUnit] = useState('');

  const l = lesson.data;
  const students = (l?.studentIds ?? []).map((sid) => lookup.student(sid)).filter((s) => !!s);
  const first = students[0];
  const subject = l ? lessonSubject(l, enrolments.data ?? []) : undefined;
  const enrolment = first ? enrolmentFor(enrolments.data ?? [], first.id, subject) : undefined;
  const legacy = !enrolment && first ? (first.syllabusId ? getSyllabus(first.syllabusId) : undefined) : undefined;
  const tree: Syllabus | undefined = enrolment ? topics.treeFor(enrolment) : legacy;
  const heading = enrolment ? enrolmentTitle(enrolment) : (tree?.name ?? subject);
  const base = l ? new Date(l.start) : new Date();
  const dueDate = toDateKey(addDays(base, Number(dueDays)));
  const firstId = first?.id;

  // Suggest where to pick up: the topics after the most recently rated one, plus anything still shaky.
  const suggestions = ((): string[] => {
    if (!tree || !firstId) return [];
    const all = tree.units.flatMap((u) => u.topics.map((t) => t.id));
    const inTree = new Set(all);
    const mine = (allRatings.data ?? []).filter((r) => r.studentId === firstId && inTree.has(r.topicId));
    const latest = [...mine].sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))[0];
    const at = latest ? all.indexOf(latest.topicId) : -1;
    const next = all.slice(at + 1, at + 4);
    const shaky = [...masteryByTopic(mine).values()].filter((m) => m.rating <= 2).map((m) => m.topicId).slice(0, 3);
    return [...new Set([...next, ...shaky])];
  })();

  if (!l) {
    return (
      <Screen topInset>
        <PageHeader back={{ fallback: '/tutor' }} kicker="Record lesson" title="Lesson not found" />
        <EmptyState title="Lesson not found" />
      </Screen>
    );
  }
  const names = studentFirstNames(l, lookup);
  if (l.status !== 'scheduled') {
    return (
      <Screen topInset>
        <PageHeader back={{ fallback: '/tutor' }} kicker="Record lesson" title={`${names} · ${longDay(l.start)}`} />
        <EmptyState icon="task_alt" title="Already recorded" message="This lesson has already been recorded or cancelled." />
      </Screen>
    );
  }

  const toggleTopic = (tid: string) => setTopicIds((ids) => (ids.includes(tid) ? ids.filter((x) => x !== tid) : [...ids, tid]));
  const key = (studentId: string, topicId: string) => `${studentId}|${topicId}`;
  const mark = (sid: string) => attendance[sid] ?? 'present';
  const presentStudents = students.filter((s) => status === 'completed' && mark(s.id) !== 'absent');
  const unitName = newUnit === 'new' ? typedUnit.trim() || undefined : newUnit === 'none' ? undefined : newUnit;
  const pay = lessonPay(l, tutor, enrolments.data ?? []);
  const familyNames = [...new Set(students.map((s) => lookup.family(s.familyId)?.name).filter(Boolean))];
  const summaryMissing = status === 'completed' && !summary.trim();
  const dueOptions = [
    { value: '3', label: formatDay(addDays(base, 3)) },
    { value: '7', label: formatDay(addDays(base, 7)) },
    { value: '14', label: formatDay(addDays(base, 14)) },
  ];

  async function saveTopic() {
    if (!enrolment || !newName.trim()) return;
    const topic = await addTopic.mutateAsync([{ enrolmentId: enrolment.id, name: newName.trim(), unit: unitName }]);
    setTopicIds((ids) => (ids.includes(topic.id) ? ids : [...ids, topic.id]));
    setBrowseUnit(topic.unit?.trim() || unitName || DEFAULT_UNIT);
    setAdding(false);
    setNewName('');
    setNewUnit('none');
    setTypedUnit('');
  }

  /** A first draft of the note from the chosen topics and homework (a template; the tutor edits it). */
  function draftNote() {
    const who = names;
    const covered = topicIds.map((t) => topics.name(t));
    const list = covered.length > 1 ? `${covered.slice(0, -1).join(', ')} and ${covered[covered.length - 1]}` : covered[0];
    const set = Object.entries(homework).filter(([, t]) => t.trim());
    const hw = set.length ? ` Homework: ${set.map(([, t]) => t.trim()).join('; ')}, due ${formatDay(dueDate + 'T12:00:00')}.` : '';
    const text = `${who} ${list ? `worked on ${list}` : 'worked hard this lesson'}.${hw}`;
    if (summary.trim()) confirm('Replace your note?', 'The draft will replace what you have written so far.', () => setSummary(text), 'Replace');
    else setSummary(text);
  }

  async function save() {
    setTried(true);
    if (summaryMissing) return;
    try {
      await complete.mutateAsync([
        {
          lessonId: l!.id,
          status,
          attendance: Object.fromEntries(students.map((s) => [s.id, status === 'no-show' ? 'absent' : mark(s.id)])),
          summary,
          privateNote,
          topicIds: status === 'completed' ? topicIds : [],
          ratings: Object.entries(ratings)
            .map(([k, rating]) => {
              const [studentId, topicId] = k.split('|');
              return { studentId, topicId, rating };
            })
            .filter((r) => topicIds.includes(r.topicId) && presentStudents.some((s) => s.id === r.studentId)),
          homework: Object.entries(homework)
            .filter(([sid, title]) => title.trim() && presentStudents.some((s) => s.id === sid))
            .map(([studentId, title]) => {
              const extras = homeworkExtras[studentId];
              return { studentId, title, dueDate, details: extras?.details.trim() || undefined, attachments: extras?.attachments ?? [] };
            }),
        },
      ]);
    } catch (err) {
      // The lesson itself was recorded; only some homework extras were not. Say so and move on.
      if (!(err instanceof PartialSaveError)) return; // shown by ErrorNote
      await queryClient.invalidateQueries();
      toast(`Recorded. ${err.message}`);
      router.back();
      return;
    }
    const month = monthName(new Date(l!.start));
    toast(
      status === 'completed'
        ? `Recorded. ${familyNames.length === 1 ? `The ${familyNames[0]} family has` : 'The family has'} the note${pay ? ` and ${formatAED(pay.amount)} is on your ${month} pay` : ''}.`
        : 'Recorded as a no-show.',
    );
    if (router.canGoBack()) router.back();
    else router.replace('/tutor');
  }

  return (
    <Screen topInset>
      <PageHeader
        back={{ fallback: '/tutor' }}
        kicker="Record lesson"
        title={`${names} · ${longDay(l.start)}`}
        sub={[`${formatTime(l.start)} to ${formatTime(l.end)}`, heading, lessonWhere(l)].filter(Boolean).join(' · ')}
      />
      {planned ? (
        <Notice tone="info" icon="edit_note">
          Pre-filled from your lesson plan. Please check it before sending.
        </Notice>
      ) : null}

      <FieldsCard title="Attendance">
        <ChipField
          label="The lesson"
          options={[
            { value: 'completed', label: 'Took place' },
            { value: 'no-show', label: 'Student did not attend' },
          ]}
          value={status}
          onChange={(v) => setStatus(v as 'completed' | 'no-show')}
        />
        {status === 'completed'
          ? students.map((s) => (
              <ChipField
                key={s.id}
                label={students.length > 1 ? s.fullName : `${firstName(s.fullName)}`}
                options={ATTENDANCE}
                value={mark(s.id)}
                onChange={(m) => setAttendance((a) => ({ ...a, [s.id]: m }))}
              />
            ))
          : null}
      </FieldsCard>
      {status === 'no-show' ? (
        <Notice tone="warn">The family is charged according to the no-show policy. Please add a note below if it would help.</Notice>
      ) : null}

      {status === 'completed' ? (
        <FieldsCard title="What you covered">
          <View style={{ gap: 8 }}>
            <Txt variant="label">{heading ? `${heading} topics` : 'Topics'}</Txt>
            {tree && suggestions.length ? (
              <>
                <Txt variant="small">Suggested</Txt>
                <Row gap={8} wrap>
                  {suggestions.map((t) => (
                    <Chip key={t} label={topics.name(t)} selected={topicIds.includes(t)} onPress={() => toggleTopic(t)} />
                  ))}
                </Row>
              </>
            ) : null}
            {tree && tree.units.length ? (
              <>
                <Txt variant="small">Browse by unit</Txt>
                <Row gap={8} wrap>
                  {tree.units.map((u) => (
                    <Chip key={u.id} label={u.name} selected={browseUnit === u.name} onPress={() => setBrowseUnit(browseUnit === u.name ? null : u.name)} />
                  ))}
                </Row>
              </>
            ) : enrolment ? (
              <Txt variant="note">No topics have been recorded for {heading} yet. Please add the first topic covered today.</Txt>
            ) : null}
            {tree && browseUnit && tree.units.some((u) => u.name === browseUnit) ? (
              <Row gap={8} wrap>
                {tree.units
                  .find((u) => u.name === browseUnit)!
                  .topics.map((t) => (
                    <Chip key={t.id} label={t.name} selected={topicIds.includes(t.id)} onPress={() => toggleTopic(t.id)} />
                  ))}
              </Row>
            ) : null}
            {topicIds.length ? (
              <>
                <Txt variant="small">Covered today</Txt>
                <Row gap={8} wrap>
                  {topicIds.map((t) => (
                    <Chip key={t} label={topics.name(t)} selected onPress={() => toggleTopic(t)} />
                  ))}
                </Row>
              </>
            ) : null}
            {enrolment ? (
              adding ? (
                <View style={{ gap: 12 }}>
                  <Field label="Topic name" value={newName} onChangeText={setNewName} placeholder="For example, Rates of reaction" autoFocus />
                  <ChipField
                    label="Unit"
                    options={[...(tree?.units ?? []).map((u) => u.name), { value: 'new', label: 'New unit…' }, { value: 'none', label: 'No unit' }]}
                    value={newUnit}
                    onChange={setNewUnit}
                  />
                  {newUnit === 'new' ? <Field label="Unit name" value={typedUnit} onChangeText={setTypedUnit} placeholder="For example, Organic chemistry" /> : null}
                  <ErrorNote error={addTopic.error} />
                  <Row gap={10}>
                    <Button title="Cancel" variant="ghost" size="sm" onPress={() => setAdding(false)} />
                    <Button
                      title="Add topic"
                      variant="secondary"
                      size="sm"
                      loading={addTopic.isPending}
                      disabled={!newName.trim() || (newUnit === 'new' && !typedUnit.trim())}
                      onPress={saveTopic}
                    />
                  </Row>
                </View>
              ) : (
                <Row>
                  <Chip label="+ Add topic" onPress={() => setAdding(true)} />
                </Row>
              )
            ) : (
              <Txt variant="note">Add {subject ?? 'this subject'} to the student’s subjects to build a topic list.</Txt>
            )}
          </View>
          {topicIds.length && presentStudents.length
            ? topicIds.map((tid) => (
                <View key={tid} style={{ gap: 8 }}>
                  <Txt variant="label">{`How secure is ${topics.name(tid)}? (1 to 5)`}</Txt>
                  {presentStudents.map((s) => (
                    <View key={s.id} style={{ gap: 4 }}>
                      {presentStudents.length > 1 ? <Txt variant="small">{s.fullName}</Txt> : null}
                      <RatingPicker
                        label={`${topics.name(tid)} for ${s.fullName}`}
                        value={ratings[key(s.id, tid)]}
                        onChange={(r) => setRatings((x) => ({ ...x, [key(s.id, tid)]: r }))}
                      />
                    </View>
                  ))}
                </View>
              ))
            : null}
        </FieldsCard>
      ) : null}

      <FieldsCard title={status === 'completed' ? 'For the family' : 'Note'}>
        <Field
          label={status === 'completed' ? 'Note for the family' : 'Note (optional)'}
          multiline
          value={summary}
          onChangeText={setSummary}
          error={tried && summaryMissing}
          placeholder="What you covered, how it went and what comes next"
          hint={status === 'completed' ? `Sent to the family and shown in ${names}’s progress.` : undefined}
        />
        {status === 'completed' ? (
          <Row>
            <Button title="Draft the note from my topics" icon="auto_awesome" size="sm" variant="secondary" onPress={draftNote} />
          </Row>
        ) : null}
      </FieldsCard>

      {status === 'completed' && presentStudents.length ? (
        <FieldsCard title="Homework">
          {presentStudents.map((s) => {
            const extras = homeworkExtras[s.id] ?? { open: false, details: '', attachments: [] };
            const setExtras = (patch: Partial<typeof extras>) => setHomeworkExtras((x) => ({ ...x, [s.id]: { ...extras, ...x[s.id], ...patch } }));
            return (
              <View key={s.id} style={{ gap: 12 }}>
                <Field
                  label={presentStudents.length > 1 ? `Homework for ${firstName(s.fullName)}` : 'Homework'}
                  value={homework[s.id] ?? ''}
                  onChangeText={(t) => setHomework((h) => ({ ...h, [s.id]: t }))}
                  placeholder="Leave empty for no homework"
                />
                {extras.open ? (
                  <View style={{ gap: 12 }}>
                    <Field
                      label="Details (optional)"
                      multiline
                      value={extras.details}
                      onChangeText={(details) => setExtras({ details })}
                      placeholder="Instructions for the student. For example, show all working and check each answer against the mark scheme."
                    />
                    <AttachmentEditor value={extras.attachments} onChange={(attachments) => setExtras({ attachments })} folder={classworkFolder({ studentId: s.id })} allowLibrary subject={subject} />
                  </View>
                ) : (
                  <Row>
                    <Button title="Add details or attachments" icon="attach" size="sm" variant="ghost" onPress={() => setExtras({ open: true })} />
                  </Row>
                )}
              </View>
            );
          })}
          <ChipField label="Due" options={dueOptions} value={dueDays} onChange={setDueDays} />
        </FieldsCard>
      ) : null}

      <FieldsCard title="For the office only">
        <Field label="Private note (optional)" value={privateNote} onChangeText={setPrivateNote} placeholder="Anything the office should know. The family does not see this." multiline />
      </FieldsCard>

      <ErrorNote error={complete.error} />
      {!viewing ? (
        <Actions>
          <Button
            title={status === 'completed' ? 'Record and send to the family' : 'Record the no-show'}
            icon={status === 'completed' ? 'send' : 'check'}
            loading={complete.isPending}
            onPress={save}
          />
        </Actions>
      ) : null}
    </Screen>
  );
}
