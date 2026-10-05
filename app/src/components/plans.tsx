import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { LessonCard } from '@/components/lessons';
import { openAttachment } from '@/components/resources';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useLesson, useLessonPlan, useLessonPlans, useLookup, useResources, useTopicLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import type { LessonPlanInput } from '@/data/source';
import { enrolmentFor, lessonSubject } from '@/domain/enrolments';
import { filterResources, resourceAttachment } from '@/domain/homework';
import { isPlanEmpty, lessonsNeedingPlan, normalisePlan, PLAN_LIMITS, validatePlan } from '@/domain/plans';
import type { Enrolment, Lesson, LessonPlan, Resource } from '@/domain/types';
import { confirm } from '@/lib/confirm';

/** How many library resources to offer at once before the tutor searches. */
const RESOURCE_SUGGESTIONS = 12;

const planPath = (lessonId: string) => ({ pathname: '/plan/[id]' as const, params: { id: lessonId } });

/** The lesson's tutor or an admin. */
function canPlan(me: ReturnType<typeof useMe>, lesson: Pick<Lesson, 'tutorId'>) {
  return me.role === 'admin' || (me.role === 'tutor' && !!me.tutorId && me.tutorId === lesson.tutorId);
}

// ---------------------------------------------------------------------------
// Plan editor
// ---------------------------------------------------------------------------

/** Loads everything the plan form needs, then renders it keyed by the saved plan so it starts from it. */
export function PlanEditor({ lessonId }: { lessonId: string | undefined }) {
  const me = useMe();
  const lookup = useLookup();
  const lesson = useLesson(lessonId);
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const resources = useResources();
  const plan = useLessonPlan(lessonId);

  if (lesson.isLoading || !lookup.ready || enrolments.isLoading || !topics.ready || resources.isLoading || plan.isLoading) return <Loading />;
  const l = lesson.data;
  if (!l) {
    return (
      <Screen>
        <EmptyState title="Lesson not found" />
      </Screen>
    );
  }
  if (!canPlan(me, l)) {
    return (
      <Screen>
        <EmptyState icon="book" title="This lesson cannot be planned here" message="Only the lesson’s tutor or the office can write a lesson plan." />
      </Screen>
    );
  }
  if (l.status !== 'scheduled') {
    return (
      <Screen>
        <EmptyState icon="check" title="This lesson has already taken place" message="Lesson plans can only be written for scheduled lessons." />
      </Screen>
    );
  }
  return (
    <PlanForm
      key={plan.data?.updatedAt ?? 'new'}
      lesson={l}
      plan={plan.data ?? null}
      enrolments={enrolments.data ?? []}
      resources={resources.data ?? []}
    />
  );
}

interface HomeworkRow {
  key: number;
  studentId: string;
  title: string;
  details: string;
}

const EVERYONE = 'everyone';

function PlanForm({
  lesson,
  plan,
  enrolments,
  resources,
}: {
  lesson: Lesson;
  plan: LessonPlan | null;
  enrolments: Enrolment[];
  resources: Resource[];
}) {
  const lookup = useLookup();
  const topics = useTopicLookup();
  const save = useAction(source.saveLessonPlan);
  const remove = useAction(source.deleteLessonPlan);

  const [objectives, setObjectives] = useState(() => plan?.objectives ?? '');
  const [topicIds, setTopicIds] = useState<string[]>(() => plan?.topicIds ?? []);
  const [resourceIds, setResourceIds] = useState<string[]>(() => plan?.resourceIds ?? []);
  const [homework, setHomework] = useState<HomeworkRow[]>(() =>
    (plan?.homework ?? []).map((h, i) => ({ key: i, studentId: h.studentId ?? EVERYONE, title: h.title, details: h.details ?? '' })),
  );
  const [shared, setShared] = useState<'tutors' | 'family'>(() => (plan?.sharedWithFamily ? 'family' : 'tutors'));
  const [browseUnit, setBrowseUnit] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const students = lesson.studentIds.map((sid) => lookup.student(sid)).filter((s) => !!s);
  const subject = lessonSubject(lesson, enrolments);
  const enrolment = students[0] ? enrolmentFor(enrolments, students[0].id, subject) : undefined;
  const tree = enrolment ? topics.treeFor(enrolment) : undefined;

  const bySubject = filterResources(resources, { subject, query });
  const matching = bySubject.length || !subject ? bySubject : filterResources(resources, { query });
  const offered = matching.slice(0, RESOURCE_SUGGESTIONS);
  const chosenElsewhere = resources.filter((r) => resourceIds.includes(r.id) && !offered.some((o) => o.id === r.id));

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const updateRow = (key: number, patch: Partial<HomeworkRow>) => setHomework((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const input = (): LessonPlanInput =>
    normalisePlan({
      lessonId: lesson.id,
      objectives,
      topicIds,
      resourceIds,
      homework: homework.map((h) => ({ studentId: h.studentId === EVERYONE ? undefined : h.studentId, title: h.title, details: h.details })),
      sharedWithFamily: shared === 'family',
    });

  async function onSave() {
    const clean = input();
    const message = validatePlan(clean, lesson.studentIds);
    setProblem(message);
    if (message) return;
    try {
      await save.mutateAsync([clean]);
      router.back();
    } catch {
      // Shown by ErrorNote.
    }
  }

  function onRemove() {
    confirm(
      'Remove this lesson plan?',
      'The plan will be deleted for everyone who can see it.',
      async () => {
        try {
          await remove.mutateAsync([lesson.id]);
          router.back();
        } catch {
          // Shown by ErrorNote.
        }
      },
      'Remove plan',
    );
  }

  return (
    <Screen
      footer={
        <Row gap={Spacing.two} style={{ flex: 1 }}>
          {plan ? <Button title="Remove plan" variant="danger" loading={remove.isPending} onPress={onRemove} /> : null}
          <Button title="Save plan" icon="check" variant="gold" style={{ flex: 1 }} loading={save.isPending} onPress={onSave} />
        </Row>
      }>
      <Section title="Objectives">
        <Field
          label="Objectives"
          multiline
          value={objectives}
          onChangeText={setObjectives}
          maxLength={PLAN_LIMITS.objectives}
          placeholder="For example: Consolidate the method for completing the square and apply it to exam-style questions."
        />
      </Section>

      <Section title="Topics">
        {tree && tree.units.length ? (
          <>
            <Txt variant="small">Browse by unit</Txt>
            <Row gap={Spacing.one} wrap>
              {tree.units.map((u) => (
                <Chip key={u.id} label={u.name} selected={browseUnit === u.name} onPress={() => setBrowseUnit(browseUnit === u.name ? null : u.name)} />
              ))}
            </Row>
          </>
        ) : (
          <Txt variant="muted">No topic list has been set up for {subject ?? 'this subject'} yet.</Txt>
        )}
        {tree && browseUnit && tree.units.some((u) => u.name === browseUnit) ? (
          <Card style={{ gap: Spacing.one }}>
            <Row gap={Spacing.one} wrap>
              {tree.units
                .find((u) => u.name === browseUnit)!
                .topics.map((t) => (
                  <Chip key={t.id} label={t.name} selected={topicIds.includes(t.id)} onPress={() => setTopicIds((ids) => toggle(ids, t.id))} />
                ))}
            </Row>
          </Card>
        ) : null}
        {topicIds.length ? (
          <View style={{ gap: Spacing.one }}>
            <Txt variant="small">Planned topics</Txt>
            <Row gap={Spacing.one} wrap>
              {topicIds.map((t) => (
                <Chip key={t} label={topics.name(t)} selected onPress={() => setTopicIds((ids) => toggle(ids, t))} />
              ))}
            </Row>
          </View>
        ) : null}
      </Section>

      <Section title="Resources from the library">
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Search the library" autoCapitalize="none" />
        {offered.length || chosenElsewhere.length ? (
          <Row gap={Spacing.one} wrap>
            {[...chosenElsewhere, ...offered].map((r) => (
              <Chip key={r.id} label={r.title} selected={resourceIds.includes(r.id)} onPress={() => setResourceIds((ids) => toggle(ids, r.id))} />
            ))}
          </Row>
        ) : (
          <Txt variant="muted">{query.trim() ? 'Nothing in the library matches your search.' : 'The library has no resources yet.'}</Txt>
        )}
      </Section>

      <Section title="Planned homework">
        {homework.map((h) => (
          <Card key={h.key} style={{ gap: Spacing.two }}>
            {students.length > 1 ? (
              <Segmented
                value={h.studentId}
                onChange={(studentId) => updateRow(h.key, { studentId })}
                options={[{ value: EVERYONE, label: 'Everyone' }, ...students.map((s) => ({ value: s.id, label: s.fullName.split(' ')[0] }))]}
              />
            ) : null}
            <Field
              label="Homework title"
              value={h.title}
              onChangeText={(title) => updateRow(h.key, { title })}
              maxLength={PLAN_LIMITS.title}
              placeholder="For example, past paper questions 1 to 5"
            />
            <Field
              label="Instructions (optional)"
              multiline
              value={h.details}
              onChangeText={(details) => updateRow(h.key, { details })}
              maxLength={PLAN_LIMITS.details}
              placeholder="For example, show all of your working."
            />
            <Row>
              <Button title="Remove" icon="close" size="sm" variant="ghost" onPress={() => setHomework((rows) => rows.filter((r) => r.key !== h.key))} />
            </Row>
          </Card>
        ))}
        {homework.length < PLAN_LIMITS.homework ? (
          <Row>
            <Button
              title="Add homework"
              icon="plus"
              size="sm"
              variant="outline"
              onPress={() =>
                setHomework((rows) => [...rows, { key: rows.reduce((m, r) => Math.max(m, r.key), -1) + 1, studentId: EVERYONE, title: '', details: '' }])
              }
            />
          </Row>
        ) : null}
      </Section>

      <Section title="Sharing">
        <Segmented
          value={shared}
          onChange={setShared}
          options={[
            { value: 'tutors', label: 'Tutors only' },
            { value: 'family', label: 'Share with the family' },
          ]}
        />
        <Txt variant="small">When shared, parents and the student can see the objectives, topics, resources and planned homework before the lesson.</Txt>
      </Section>

      {problem ? (
        <Banner tone="danger" icon="alert">
          {problem}
        </Banner>
      ) : null}
      <ErrorNote error={save.error ?? remove.error} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Lesson detail
// ---------------------------------------------------------------------------

/** The plan on the lesson page: editable for its tutor and the office, read-only for a family when shared. */
export function LessonPlanSection({ lesson }: { lesson: Lesson }) {
  const me = useMe();
  const lookup = useLookup();
  const plan = useLessonPlan(lesson.id);
  const topics = useTopicLookup();
  const resources = useResources();
  const staff = canPlan(me, lesson);
  const scheduled = lesson.status === 'scheduled';

  if (plan.isLoading) return null;
  const p = plan.data;
  if (!p || isPlanEmpty(p)) {
    return staff && scheduled ? (
      <Button title="Write a lesson plan" icon="book" variant="secondary" onPress={() => router.push(planPath(lesson.id))} />
    ) : null;
  }

  // Families only see resources the library already shares with them.
  const visible = (resources.data ?? []).filter((r) => p.resourceIds.includes(r.id));
  const multiple = lesson.studentIds.length > 1;
  // In a group lesson a family sees general homework and their own children's only (the server already filters
  // it; this keeps the view safe whatever the source returns).
  const homework = staff ? p.homework : p.homework.filter((h) => !h.studentId || !!lookup.student(h.studentId));

  return (
    <Section title="Lesson plan">
      <Card style={{ gap: Spacing.two }}>
        {p.sharedWithFamily && staff ? (
          <Row>
            <Badge label="Shared with the family" tone="gold" />
          </Row>
        ) : null}
        {p.objectives ? <Txt>{p.objectives}</Txt> : null}
        {p.topicIds.length ? (
          <Row gap={4} wrap>
            {p.topicIds.map((t) => (
              <Badge key={t} label={topics.name(t)} />
            ))}
          </Row>
        ) : null}
        {visible.length ? (
          <View style={{ gap: 4 }}>
            <Txt variant="label">Resources</Txt>
            {visible.map((r) => (
              <Txt key={r.id} color="accent" accessibilityRole="link" onPress={() => openAttachment(resourceAttachment(r))}>
                {r.title}
              </Txt>
            ))}
          </View>
        ) : null}
        {homework.length ? (
          <View style={{ gap: 4 }}>
            <Txt variant="label">Planned homework</Txt>
            {homework.map((h, i) => (
              <Txt key={i}>
                {h.title}
                {multiple && h.studentId ? ` (${lookup.student(h.studentId)?.fullName.split(' ')[0] ?? 'one student'})` : ''}
              </Txt>
            ))}
          </View>
        ) : null}
      </Card>
      {staff && scheduled ? (
        <Button title="Edit plan" icon="book" variant="secondary" size="sm" onPress={() => router.push(planPath(lesson.id))} />
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Tutor dashboard
// ---------------------------------------------------------------------------

/** The next 48 hours from now, to the minute (so the query key only changes once a minute). */
function planWindow() {
  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  return { now, to: new Date(now.getTime() + 48 * 3_600_000) };
}

/** The tutor's lessons in the next 48 hours that have no plan yet. Renders nothing when all are planned. */
export function PlansDueCard({ lessons }: { lessons: Lesson[] }) {
  const me = useMe();
  const lookup = useLookup();
  const [range, setRange] = useState(planWindow);
  // Today stays mounted as a tab, so move the 48-hour window on whenever the screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      setRange((current) => {
        const next = planWindow();
        return next.now.getTime() === current.now.getTime() ? current : next;
      });
    }, []),
  );
  const plans = useLessonPlans(range.now, range.to);
  if (plans.isLoading || !lookup.ready) return null;
  const due = lessonsNeedingPlan(lessons, plans.data ?? [], me.tutorId, range.now);
  if (!due.length) return null;
  return (
    <Section title={`Lessons without a plan in the next 48 hours (${due.length})`}>
      {due.map((l) => (
        <View key={l.id} style={{ gap: Spacing.one }}>
          <LessonCard lesson={l} lookup={lookup} perspective="tutor" showDate />
          <Row>
            <Button title="Write plan" icon="book" size="sm" variant="outline" onPress={() => router.push(planPath(l.id))} />
          </Row>
        </View>
      ))}
    </Section>
  );
}
