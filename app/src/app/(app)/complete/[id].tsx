import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AttachmentEditor } from '@/components/attachments';
import { RatingPicker } from '@/components/progress';
import { Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getSyllabus } from '@/data/curriculum';
import { source } from '@/data';
import { PartialSaveError } from '@/data/source';
import { useAction, useEnrolments, useLesson, useLookup, useRatings, useTopicLookup } from '@/data/hooks';
import { addDays, formatDay, toDateKey } from '@/domain/dates';
import { enrolmentFor, enrolmentTitle, lessonSubject } from '@/domain/enrolments';
import { classworkFolder } from '@/domain/homework';
import { masteryByTopic, type Syllabus } from '@/domain/progress';
import { DEFAULT_UNIT } from '@/domain/topics';
import type { Attachment, AttendanceMark, TopicRating } from '@/domain/types';
import { notify } from '@/lib/confirm';

type Rating = TopicRating['rating'];

/** Record a lesson in one pass: attendance, topics + ratings, summary for the family, homework. */
export default function CompleteLesson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lookup = useLookup();
  const lesson = useLesson(id);
  const allRatings = useRatings();
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const complete = useAction(source.completeLesson);
  const addTopic = useAction(source.addTopic);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<'completed' | 'no-show'>('completed');
  const [attendance, setAttendance] = useState<Record<string, AttendanceMark>>({});
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [summary, setSummary] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [homework, setHomework] = useState<Record<string, string>>({});
  // Optional instructions and attachments per student, revealed on request.
  const [homeworkExtras, setHomeworkExtras] = useState<Record<string, { open: boolean; details: string; attachments: Attachment[] }>>({});
  const [browseUnit, setBrowseUnit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  // 'none' files the topic under the general list; 'new' takes the typed unit; anything else is an existing unit name.
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
  const dueDate = toDateKey(addDays(l ? new Date(l.start) : new Date(), 7));
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

  if (lesson.isLoading || !lookup.ready || enrolments.isLoading || !topics.ready) return <Loading />;
  if (!l) return <Screen><EmptyState title="Lesson not found" /></Screen>;
  if (l.status !== 'scheduled') {
    return (
      <Screen>
        <EmptyState icon="check" title="Already recorded" message="This lesson has already been recorded or cancelled." />
      </Screen>
    );
  }

  const toggleTopic = (tid: string) =>
    setTopicIds((ids) => (ids.includes(tid) ? ids.filter((x) => x !== tid) : [...ids, tid]));
  const key = (studentId: string, topicId: string) => `${studentId}|${topicId}`;
  const mark = (sid: string) => attendance[sid] ?? 'present';
  const presentStudents = students.filter((s) => status === 'completed' && mark(s.id) !== 'absent');

  const unitName = newUnit === 'new' ? typedUnit.trim() || undefined : newUnit === 'none' ? undefined : newUnit;

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

  async function save() {
    try {
      await record();
    } catch (err) {
      // The lesson itself was recorded; only some homework extras were not. Say so and move on,
      // because the lesson cannot be recorded twice.
      if (!(err instanceof PartialSaveError)) return; // shown by ErrorNote
      await queryClient.invalidateQueries();
      notify('Lesson recorded', err.message);
    }
    router.back();
  }

  async function record() {
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
          .filter(([, title]) => title.trim())
          .map(([studentId, title]) => {
            const extras = homeworkExtras[studentId];
            return {
              studentId,
              title,
              dueDate,
              details: extras?.details.trim() || undefined,
              attachments: extras?.attachments ?? [],
            };
          }),
      },
    ]);
  }

  return (
    <Screen
      footer={
        <Button
          title={status === 'completed' ? 'Save and send to the family' : 'Record no-show'}
          icon="check"
          variant="gold"
          style={{ flex: 1 }}
          loading={complete.isPending}
          disabled={status === 'completed' && !summary.trim()}
          onPress={save}
        />
      }>
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'completed', label: 'Lesson happened' },
          { value: 'no-show', label: 'No-show' },
        ]}
      />

      {status === 'no-show' ? (
        <Banner tone="warning" icon="alert">
          The family will be charged according to the no-show policy. Please add a note below if it would be helpful.
        </Banner>
      ) : (
        <>
          <Section title="Attendance">
            {students.map((s) => (
              <Row key={s.id} style={{ justifyContent: 'space-between' }} wrap>
                <Txt variant="h3">{s.fullName}</Txt>
                <Row gap={4}>
                  {(['present', 'late', 'absent'] as const).map((m) => (
                    <Chip key={m} label={m[0].toUpperCase() + m.slice(1)} selected={mark(s.id) === m} onPress={() => setAttendance((a) => ({ ...a, [s.id]: m }))} />
                  ))}
                </Row>
              </Row>
            ))}
          </Section>

          <Section title={heading ? `${heading} topics` : 'Topics covered'}>
            {tree && suggestions.length ? (
              <View style={{ gap: Spacing.one }}>
                <Txt variant="small">Suggested</Txt>
                <Row gap={Spacing.one} wrap>
                  {suggestions.map((t) => (
                    <Chip key={t} label={topics.name(t)} selected={topicIds.includes(t)} onPress={() => toggleTopic(t)} />
                  ))}
                </Row>
              </View>
            ) : null}
            {tree && tree.units.length ? (
              <>
                <Txt variant="small">Browse by unit</Txt>
                <Row gap={Spacing.one} wrap>
                  {tree.units.map((u) => (
                    <Chip key={u.id} label={u.name} selected={browseUnit === u.name} onPress={() => setBrowseUnit(browseUnit === u.name ? null : u.name)} />
                  ))}
                </Row>
              </>
            ) : enrolment ? (
              <Txt variant="muted">No topics have been recorded for {heading} yet. Please add the first topic covered today.</Txt>
            ) : null}
            {tree && browseUnit && tree.units.some((u) => u.name === browseUnit) ? (
              <Card style={{ gap: Spacing.one }}>
                <Row gap={Spacing.one} wrap>
                  {tree.units
                    .find((u) => u.name === browseUnit)!
                    .topics.map((t) => (
                      <Chip key={t.id} label={t.name} selected={topicIds.includes(t.id)} onPress={() => toggleTopic(t.id)} />
                    ))}
                </Row>
              </Card>
            ) : null}
            {/* Topics chosen that are not on show (for example, just added before the list refreshed). */}
            {topicIds.length ? (
              <View style={{ gap: Spacing.one }}>
                <Txt variant="small">Covered today</Txt>
                <Row gap={Spacing.one} wrap>
                  {topicIds.map((t) => (
                    <Chip key={t} label={topics.name(t)} selected onPress={() => toggleTopic(t)} />
                  ))}
                </Row>
              </View>
            ) : null}
            {enrolment ? (
              adding ? (
                <Card style={{ gap: Spacing.two }}>
                  <Field label="Topic name" value={newName} onChangeText={setNewName} placeholder="For example, Rates of reaction" autoFocus />
                  <Txt variant="label">Unit</Txt>
                  <Row gap={Spacing.one} wrap>
                    {(tree?.units ?? []).map((u) => (
                      <Chip key={u.id} label={u.name} selected={newUnit === u.name} onPress={() => setNewUnit(u.name)} />
                    ))}
                    <Chip label="New unit…" selected={newUnit === 'new'} onPress={() => setNewUnit('new')} />
                    <Chip label="No unit" selected={newUnit === 'none'} onPress={() => setNewUnit('none')} />
                  </Row>
                  {newUnit === 'new' ? <Field label="Unit name" value={typedUnit} onChangeText={setTypedUnit} placeholder="For example, Organic chemistry" /> : null}
                  <ErrorNote error={addTopic.error} />
                  <Row gap={Spacing.two}>
                    <Button title="Cancel" variant="ghost" size="sm" onPress={() => setAdding(false)} />
                    <Button
                      title="Add topic"
                      variant="outline"
                      size="sm"
                      loading={addTopic.isPending}
                      disabled={!newName.trim() || (newUnit === 'new' && !typedUnit.trim())}
                      onPress={saveTopic}
                    />
                  </Row>
                </Card>
              ) : (
                <Row>
                  <Chip label="+ Add topic" onPress={() => setAdding(true)} />
                </Row>
              )
            ) : (
              <Txt variant="muted">Add {subject ?? 'this subject'} to the student’s subjects to build a topic list.</Txt>
            )}
          </Section>

          {topicIds.length && presentStudents.length ? (
            <Section title="How secure is each topic? (1–5)">
              {topicIds.map((tid) => (
                <Card key={tid} style={{ gap: Spacing.two }}>
                  <Txt variant="h3">{topics.name(tid)}</Txt>
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
                </Card>
              ))}
            </Section>
          ) : null}
        </>
      )}

      <Section title="Summary for the family">
        <Field
          label="What we covered"
          multiline
          value={summary}
          onChangeText={setSummary}
          placeholder="For example: We reviewed last week’s work, then completed two exam-style questions. The method is now secure, and next time we will extend it to harder problems."
        />
      </Section>

      {status === 'completed' ? (
        <Section title={`Homework · due ${formatDay(dueDate + 'T12:00:00')}`}>
          {presentStudents.map((s) => {
            const extras = homeworkExtras[s.id] ?? { open: false, details: '', attachments: [] };
            const setExtras = (patch: Partial<typeof extras>) => setHomeworkExtras((x) => ({ ...x, [s.id]: { ...extras, ...x[s.id], ...patch } }));
            return (
              <View key={s.id} style={{ gap: Spacing.two }}>
                <Field
                  label={presentStudents.length > 1 ? s.fullName : 'Homework'}
                  value={homework[s.id] ?? ''}
                  onChangeText={(t) => setHomework((h) => ({ ...h, [s.id]: t }))}
                  placeholder="For example, past paper questions 1 to 5"
                />
                {extras.open ? (
                  <Card style={{ gap: Spacing.two }}>
                    <Field
                      label="Details (optional)"
                      multiline
                      value={extras.details}
                      onChangeText={(details) => setExtras({ details })}
                      placeholder="Instructions for the student. For example, show all working and check each answer against the mark scheme."
                    />
                    <AttachmentEditor
                      value={extras.attachments}
                      onChange={(attachments) => setExtras({ attachments })}
                      folder={classworkFolder({ studentId: s.id })}
                      allowLibrary
                      subject={subject}
                    />
                  </Card>
                ) : (
                  <Row>
                    <Button title="Add details or attachments" icon="attach" size="sm" variant="ghost" onPress={() => setExtras({ open: true })} />
                  </Row>
                )}
              </View>
            );
          })}
        </Section>
      ) : null}

      <Field label="Private note (staff only)" value={privateNote} onChangeText={setPrivateNote} placeholder="Not shown to the family" multiline />
      <ErrorNote error={complete.error} />
    </Screen>
  );
}
