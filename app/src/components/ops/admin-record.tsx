import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { getSyllabus } from '@/data/curriculum';
import { source } from '@/data';
import { PartialSaveError } from '@/data/source';
import { useAction, useEnrolments, useLesson, useLookup, useRatings, useTopicLookup } from '@/data/hooks';
import { addDays, formatDay, formatTime, toDateKey } from '@/domain/dates';
import { enrolmentFor, enrolmentTitle, lessonSubject } from '@/domain/enrolments';
import { classworkFolder } from '@/domain/homework';
import type { RecordPrefill } from '@/domain/plans';
import { masteryByTopic, type Syllabus } from '@/domain/progress';
import { DEFAULT_UNIT } from '@/domain/topics';
import type { Attachment, AttendanceMark, TopicRating } from '@/domain/types';

import { AttachmentEditor } from '../attachments';
import { RatingPicker } from '../progress';
import {
  Actions,
  Button,
  Chip,
  Columns,
  EmptyState,
  ErrorNote,
  Field,
  FieldsCard,
  Group,
  GroupRow,
  Loading,
  Notice,
  PageHeader,
  Row,
  Screen,
  Segmented,
  Txt,
  useToast,
} from '../ui';
import { NoHeader } from './parts';

type Rating = TopicRating['rating'];
const MARKS: AttendanceMark[] = ['present', 'late', 'absent'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * The admin's "Record lesson" page (the redesign's record view): attendance, topics and how secure each is on the
 * left; the summary for the family, homework and a private note on the right. Same save as the tutor's page.
 */
export function AdminRecordForm({ id, prefill, planned }: { id: string; prefill: RecordPrefill; planned: boolean }) {
  const toast = useToast();
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
  const [topicIds, setTopicIds] = useState<string[]>(prefill.topicIds);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [summary, setSummary] = useState(prefill.summary);
  const [privateNote, setPrivateNote] = useState('');
  const [homework, setHomework] = useState<Record<string, string>>(prefill.homework);
  const [homeworkExtras, setHomeworkExtras] = useState<Record<string, { open: boolean; details: string; attachments: Attachment[] }>>(prefill.homeworkExtras);
  const [browseUnit, setBrowseUnit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  // 'none' files the topic under the general list; 'new' takes the typed unit; anything else is an existing unit name.
  const [newUnit, setNewUnit] = useState<string>('none');
  const [typedUnit, setTypedUnit] = useState('');
  const [tried, setTried] = useState(false);

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
  if (!l) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back kicker="Record lesson" title="Lesson not found" />
        <EmptyState title="Lesson not found" />
      </Screen>
    );
  }
  if (l.status !== 'scheduled') {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back kicker="Record lesson" title="Already recorded" />
        <EmptyState icon="check" title="Already recorded" message="This lesson has already been recorded or cancelled." />
      </Screen>
    );
  }

  const tutor = lookup.tutor(l.tutorId);
  const familyNames = [...new Set(students.map((s) => lookup.family(s.familyId)?.name).filter(Boolean))];
  const familyLine = familyNames.length ? `the ${familyNames.join(' and ')} famil${familyNames.length === 1 ? 'y' : 'ies'}` : 'the family';
  const toggleTopic = (tid: string) => setTopicIds((ids) => (ids.includes(tid) ? ids.filter((x) => x !== tid) : [...ids, tid]));
  const key = (studentId: string, topicId: string) => `${studentId}|${topicId}`;
  const mark = (sid: string) => attendance[sid] ?? 'present';
  const presentStudents = students.filter((s) => status === 'completed' && mark(s.id) !== 'absent');
  const unitName = newUnit === 'new' ? typedUnit.trim() || undefined : newUnit === 'none' ? undefined : newUnit;
  const needSummary = status === 'completed' && !summary.trim();

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
            return { studentId, title, dueDate, details: extras?.details.trim() || undefined, attachments: extras?.attachments ?? [] };
          }),
      },
    ]);
  }

  async function save() {
    setTried(true);
    if (needSummary) return;
    let message = status === 'completed' ? `Recorded. The summary is shared with ${familyLine}.` : 'Recorded as a no-show.';
    try {
      await record();
    } catch (err) {
      // The lesson itself was recorded; only some homework extras were not. Say so and move on,
      // because the lesson cannot be recorded twice.
      if (!(err instanceof PartialSaveError)) return; // shown by ErrorNote
      await queryClient.invalidateQueries();
      message = `Lesson recorded. ${err.message}`;
    }
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/lesson/[id]', params: { id } });
    toast(message);
  }

  const topicsCard = (
    <FieldsCard title={heading ? `${heading} topics covered` : 'Topics covered'}>
      {tree && suggestions.length ? (
        <View style={{ gap: 8 }}>
          <Txt variant="label">Suggested from where the last lesson ended</Txt>
          <Row gap={8} wrap>
            {suggestions.map((t) => (
              <Chip key={t} label={topics.name(t)} selected={topicIds.includes(t)} onPress={() => toggleTopic(t)} />
            ))}
          </Row>
        </View>
      ) : null}
      {tree && tree.units.length ? (
        <View style={{ gap: 8 }}>
          <Txt variant="label">Browse by unit</Txt>
          <Row gap={8} wrap>
            {tree.units.map((u) => (
              <Chip key={u.id} label={u.name} selected={browseUnit === u.name} onPress={() => setBrowseUnit(browseUnit === u.name ? null : u.name)} />
            ))}
          </Row>
        </View>
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
        <View style={{ gap: 8 }}>
          <Txt variant="label">Covered today</Txt>
          <Row gap={8} wrap>
            {topicIds.map((t) => (
              <Chip key={t} label={topics.name(t)} selected onPress={() => toggleTopic(t)} />
            ))}
          </Row>
        </View>
      ) : null}
      {enrolment ? (
        adding ? (
          <View style={{ gap: 12 }}>
            <Field label="Topic name" value={newName} onChangeText={setNewName} placeholder="For example, Rates of reaction" autoFocus />
            <View style={{ gap: 8 }}>
              <Txt variant="label">Unit</Txt>
              <Row gap={8} wrap>
                {(tree?.units ?? []).map((u) => (
                  <Chip key={u.id} label={u.name} selected={newUnit === u.name} onPress={() => setNewUnit(u.name)} />
                ))}
                <Chip label="New unit…" selected={newUnit === 'new'} onPress={() => setNewUnit('new')} />
                <Chip label="No unit" selected={newUnit === 'none'} onPress={() => setNewUnit('none')} />
              </Row>
            </View>
            {newUnit === 'new' ? <Field label="Unit name" value={typedUnit} onChangeText={setTypedUnit} placeholder="For example, Organic chemistry" /> : null}
            <ErrorNote error={addTopic.error} />
            <Row gap={10}>
              <Button
                title="Add topic"
                variant="secondary"
                size="sm"
                loading={addTopic.isPending}
                disabled={!newName.trim() || (newUnit === 'new' && !typedUnit.trim())}
                onPress={() => saveTopic().catch(() => undefined)}
              />
              <Button title="Cancel" variant="ghost" size="sm" onPress={() => setAdding(false)} />
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
    </FieldsCard>
  );

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader
        back
        kicker={`Record lesson · ${formatTime(l.start)}–${formatTime(l.end)}`}
        title={`${students.map((s) => s.fullName).join(' & ') || 'Lesson'}${subject ? ` · ${subject}` : ''}`}
        sub={`${formatDay(l.start)}${tutor ? `, with ${tutor.fullName}` : ''}. Saving shares the summary and homework with ${familyLine}.`}
      />
      {planned ? <Notice icon="menu_book">Pre-filled from the lesson plan. Please review before saving.</Notice> : null}
      <View style={{ maxWidth: 420, width: '100%' }}>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'completed', label: 'Lesson happened' },
            { value: 'no-show', label: 'No-show' },
          ]}
        />
      </View>
      {status === 'no-show' ? (
        <Notice tone="warn">The family will be charged under the no-show policy. Add a note below if it would help.</Notice>
      ) : null}
      <Columns>
        <View style={{ gap: 20 }}>
          {status === 'completed' ? (
            <>
              <Group title="Attendance">
                {students.map((s) => (
                  <GroupRow
                    key={s.id}
                    title={s.fullName}
                    accessibilityLabel={`${s.fullName}: ${cap(mark(s.id))}`}>
                    <Row gap={6} wrap style={{ marginTop: 6 }}>
                      {MARKS.map((m) => (
                        <Chip key={m} label={cap(m)} selected={mark(s.id) === m} onPress={() => setAttendance((a) => ({ ...a, [s.id]: m }))} />
                      ))}
                    </Row>
                  </GroupRow>
                ))}
              </Group>
              {topicsCard}
              {topicIds.length && presentStudents.length ? (
                <FieldsCard title="How secure is each topic?">
                  {topicIds.map((tid) => (
                    <View key={tid} style={{ gap: 8 }}>
                      <Txt style={{ fontWeight: '700' }}>{topics.name(tid)}</Txt>
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
                  ))}
                  <Txt variant="small">1 is not started, 5 is mastered.</Txt>
                </FieldsCard>
              ) : null}
            </>
          ) : (
            <Group title="Attendance" note="Everyone is marked absent for a no-show." />
          )}
        </View>

        <View style={{ gap: 20 }}>
          <FieldsCard>
            <Field
              label="Summary for the family"
              multiline
              value={summary}
              onChangeText={setSummary}
              placeholder="We reviewed last week’s work, then completed two exam-style questions…"
              error={tried && needSummary ? 'Write a short summary for the family to continue.' : undefined}
            />
            {status === 'completed'
              ? presentStudents.map((s) => {
                  const extras = homeworkExtras[s.id] ?? { open: false, details: '', attachments: [] };
                  const setExtras = (patch: Partial<typeof extras>) => setHomeworkExtras((x) => ({ ...x, [s.id]: { ...extras, ...x[s.id], ...patch } }));
                  return (
                    <View key={s.id} style={{ gap: 12 }}>
                      <Field
                        label={`Homework${presentStudents.length > 1 ? ` for ${s.fullName}` : ''} · due ${formatDay(dueDate + 'T12:00:00')}`}
                        value={homework[s.id] ?? ''}
                        onChangeText={(t) => setHomework((h) => ({ ...h, [s.id]: t }))}
                        placeholder="For example, past paper questions 1 to 5"
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
                          <AttachmentEditor
                            value={extras.attachments}
                            onChange={(attachments) => setExtras({ attachments })}
                            folder={classworkFolder({ studentId: s.id })}
                            allowLibrary
                            subject={subject}
                          />
                        </View>
                      ) : (
                        <Row>
                          <Button title="Add details or attachments" icon="attach" size="sm" variant="ghost" onPress={() => setExtras({ open: true })} />
                        </Row>
                      )}
                    </View>
                  );
                })
              : null}
            <Field label="Private note · staff only" value={privateNote} onChangeText={setPrivateNote} placeholder="Not shown to the family" multiline />
          </FieldsCard>
          <ErrorNote error={complete.error} />
          <Actions>
            <Button
              title={status === 'completed' ? 'Save and send to the family' : 'Record the no-show'}
              icon="checkmark"
              loading={complete.isPending}
              onPress={() => save().catch(() => undefined)}
            />
          </Actions>
        </View>
      </Columns>
    </Screen>
  );
}
