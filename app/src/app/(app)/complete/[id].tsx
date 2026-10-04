import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { RatingPicker } from '@/components/progress';
import { Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getSyllabus, topicName } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useLesson, useLookup, useRatings } from '@/data/hooks';
import { addDays, formatDay, toDateKey } from '@/domain/dates';
import { masteryByTopic } from '@/domain/progress';
import type { AttendanceMark, TopicRating } from '@/domain/types';

type Rating = TopicRating['rating'];

/** Record a lesson in one pass: attendance, topics + ratings, summary for the family, homework. */
export default function CompleteLesson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lookup = useLookup();
  const lesson = useLesson(id);
  const allRatings = useRatings();
  const complete = useAction(source.completeLesson);

  const [status, setStatus] = useState<'completed' | 'no-show'>('completed');
  const [attendance, setAttendance] = useState<Record<string, AttendanceMark>>({});
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [summary, setSummary] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [homework, setHomework] = useState<Record<string, string>>({});
  const [browseUnit, setBrowseUnit] = useState<string | null>(null);

  const l = lesson.data;
  const students = (l?.studentIds ?? []).map((sid) => lookup.student(sid)).filter((s) => !!s);
  const syllabus = students[0] ? getSyllabus(students[0].syllabusId) : undefined;
  const dueDate = toDateKey(addDays(l ? new Date(l.start) : new Date(), 7));

  // Suggest where to pick up: the topics after the most recently rated one, plus anything still shaky.
  const suggestions = useMemo(() => {
    if (!syllabus || !students[0]) return [];
    const mine = (allRatings.data ?? []).filter((r) => r.studentId === students[0]!.id);
    const all = syllabus.units.flatMap((u) => u.topics.map((t) => t.id));
    const latest = [...mine].sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))[0];
    const at = latest ? all.indexOf(latest.topicId) : -1;
    const next = all.slice(at + 1, at + 4);
    const shaky = [...masteryByTopic(mine).values()].filter((m) => m.rating <= 2).map((m) => m.topicId).slice(0, 3);
    return [...new Set([...next, ...shaky])];
  }, [syllabus, students, allRatings.data]);

  if (lesson.isLoading || !lookup.ready) return <Loading />;
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

  async function save() {
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
          .map(([studentId, title]) => ({ studentId, title, dueDate })),
      },
    ]);
    router.back();
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

          {syllabus ? (
            <Section title="Topics covered">
              {suggestions.length ? (
                <View style={{ gap: Spacing.one }}>
                  <Txt variant="small">Suggested</Txt>
                  <Row gap={Spacing.one} wrap>
                    {suggestions.map((t) => (
                      <Chip key={t} label={topicName(t)} selected={topicIds.includes(t)} onPress={() => toggleTopic(t)} />
                    ))}
                  </Row>
                </View>
              ) : null}
              <Txt variant="small">Browse {syllabus.name}</Txt>
              <Row gap={Spacing.one} wrap>
                {syllabus.units.map((u) => (
                  <Chip key={u.id} label={u.name} selected={browseUnit === u.id} onPress={() => setBrowseUnit(browseUnit === u.id ? null : u.id)} />
                ))}
              </Row>
              {browseUnit ? (
                <Card style={{ gap: Spacing.one }}>
                  <Row gap={Spacing.one} wrap>
                    {syllabus.units
                      .find((u) => u.id === browseUnit)!
                      .topics.map((t) => (
                        <Chip key={t.id} label={t.name} selected={topicIds.includes(t.id)} onPress={() => toggleTopic(t.id)} />
                      ))}
                  </Row>
                </Card>
              ) : null}
            </Section>
          ) : null}

          {topicIds.length && presentStudents.length ? (
            <Section title="How secure is each topic? (1–5)">
              {topicIds.map((tid) => (
                <Card key={tid} style={{ gap: Spacing.two }}>
                  <Txt variant="h3">{topicName(tid)}</Txt>
                  {presentStudents.map((s) => (
                    <View key={s.id} style={{ gap: 4 }}>
                      {presentStudents.length > 1 ? <Txt variant="small">{s.fullName}</Txt> : null}
                      <RatingPicker
                        label={`${topicName(tid)} for ${s.fullName}`}
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
          placeholder="e.g. Worked through integration by parts, then two exam questions. Confident with the method; next time we will tackle definite integrals."
        />
      </Section>

      {status === 'completed' ? (
        <Section title={`Homework · due ${formatDay(dueDate + 'T12:00:00')}`}>
          {presentStudents.map((s) => (
            <Field
              key={s.id}
              label={presentStudents.length > 1 ? s.fullName : 'Homework'}
              value={homework[s.id] ?? ''}
              onChangeText={(t) => setHomework((h) => ({ ...h, [s.id]: t }))}
              placeholder="e.g. Exercise 7C Q1–12"
            />
          ))}
        </Section>
      ) : null}

      <Field label="Private note (staff only)" value={privateNote} onChangeText={setPrivateNote} placeholder="Not shown to the family" multiline />
      <ErrorNote error={complete.error} />
    </Screen>
  );
}
