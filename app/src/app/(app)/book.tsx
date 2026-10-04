import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useLessons, useLookup, useOpenSlots, useServices, useStudents } from '@/data/hooks';
import { addDays, formatDay, formatTime, startOfDay, toDateKey } from '@/domain/dates';
import { activeEnrolments, enrolmentFor, enrolmentTitle, lessonSubject, sameSubject } from '@/domain/enrolments';
import { byStart } from '@/domain/scheduling';

const today = startOfDay(new Date());
const WINDOW_DAYS = 21;

/** Parents pick a real open slot to request an extra lesson or to move one. Elite Education confirms it. */
export default function Book() {
  const params = useLocalSearchParams<{ lessonId?: string }>();
  const lookup = useLookup();
  const students = useStudents();
  const services = useServices();
  const lessons = useLessons(addDays(today, -90), addDays(today, 90));
  const enrolments = useEnrolments();
  const request = useAction(source.requestLesson);

  const [studentId, setStudentId] = useState<string | null>(null);
  const [kind, setKind] = useState<'new-lesson' | 'reschedule'>(params.lessonId ? 'reschedule' : 'new-lesson');
  const [lessonId, setLessonId] = useState<string | null>(params.lessonId ?? null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pickedEnrolmentId, setPickedEnrolmentId] = useState<string | null>(null);

  const all = lessons.data ?? [];
  const moving = lessonId ? all.find((l) => l.id === lessonId) : undefined;
  const kids = students.data ?? [];
  const student = kids.find((s) => s.id === (studentId ?? moving?.studentIds[0])) ?? (kids.length === 1 ? kids[0] : undefined);
  const theirs = student ? all.filter((l) => l.studentIds.includes(student.id)).sort(byStart) : [];
  const allEnrolments = enrolments.data ?? [];
  const studentEnrolments = student ? activeEnrolments(allEnrolments, student.id) : [];
  const recent = [...theirs].reverse().filter((l) => l.status === 'completed' || l.status === 'scheduled');
  const usual = recent[0];
  // The family picks an enrolment rather than a subject name, since one subject can be studied twice (IGCSE and A-Level).
  const picked = kind === 'new-lesson' ? studentEnrolments.find((e) => e.id === pickedEnrolmentId) : undefined;
  // A move keeps the lesson's own subject; a new lesson uses the chosen subject, the only one, or the usual lesson's.
  const subject =
    kind === 'reschedule'
      ? moving
        ? lessonSubject(moving, allEnrolments)
        : undefined
      : (picked?.subject ?? (studentEnrolments.length === 1 ? studentEnrolments[0].subject : usual ? lessonSubject(usual, allEnrolments) : undefined));
  const enrolment = picked ?? (student && subject ? enrolmentFor(allEnrolments, student.id, subject) : undefined);
  // Older lessons may carry no subject; then the most recent lesson is still the best guide.
  const subjectKnown = recent.some((l) => lessonSubject(l, allEnrolments));
  const usualForSubject = subject && subjectKnown ? recent.find((l) => sameSubject(lessonSubject(l, allEnrolments), subject)) : usual;
  const tutorId = moving?.tutorId ?? enrolment?.tutorId ?? usualForSubject?.tutorId;
  const service = lookup.service(moving?.serviceId ?? usualForSubject?.serviceId ?? usual?.serviceId ?? '') ?? services.data?.[0];
  const duration = moving ? (new Date(moving.end).getTime() - new Date(moving.start).getTime()) / 60_000 : service?.durationMin;
  const slots = useOpenSlots({ tutorId, from: toDateKey(today), days: WINDOW_DAYS, durationMin: duration, ignoreLessonId: moving?.id });
  const upcoming = theirs.filter((l) => l.status === 'scheduled' && new Date(l.start) > new Date());

  if (students.isLoading || lessons.isLoading || !lookup.ready) return <Loading />;
  if (kids.length === 0) return <Screen><EmptyState icon="people" title="Please add your child first" message="Once your child has been added, you can request lessons here." action={<Button title="Add child" onPress={() => router.replace('/onboarding')} />} /></Screen>;

  const byDay = new Map<string, { start: string; end: string }[]>();
  for (const s of slots.data ?? []) {
    const k = toDateKey(new Date(s.start));
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const days = [...byDay.keys()];
  const activeDay = day && byDay.has(day) ? day : days[0];

  async function submit() {
    if (!student || !chosen || !tutorId || !service) return;
    await request.mutateAsync([
      {
        studentId: student.id,
        kind,
        lessonId: kind === 'reschedule' ? moving?.id : undefined,
        tutorId,
        serviceId: service.id,
        subject,
        start: chosen,
        note: note.trim() || undefined,
      },
    ]);
    router.back();
  }

  return (
    <Screen
      footer={
        <Button
          title={chosen ? `Request ${formatDay(chosen)} at ${formatTime(chosen)}` : 'Choose a time'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!chosen || (kind === 'reschedule' && !moving)}
          loading={request.isPending}
          onPress={submit}
        />
      }>
      <Stack.Screen options={{ title: kind === 'reschedule' ? 'Move a lesson' : 'Book an additional lesson' }} />
      {kids.length > 1 ? (
        <Section title="Which child?">
          <Row gap={Spacing.one} wrap>
            {kids.map((k) => (
              <Chip key={k.id} label={k.fullName.split(' ')[0]} selected={student?.id === k.id} onPress={() => { setStudentId(k.id); setLessonId(null); setChosen(null); setPickedEnrolmentId(null); }} />
            ))}
          </Row>
        </Section>
      ) : null}

      {student ? (
        <>
          <Segmented
            value={kind}
            onChange={(k) => { setKind(k); setChosen(null); if (k === 'new-lesson') setLessonId(null); }}
            options={[
              { value: 'new-lesson', label: 'Additional lesson' },
              { value: 'reschedule', label: 'Move a lesson' },
            ]}
          />

          {kind === 'reschedule' ? (
            <Section title="Which lesson?">
              {upcoming.length === 0 ? <Txt variant="muted">No upcoming lessons to move.</Txt> : null}
              <Row gap={Spacing.one} wrap>
                {upcoming.slice(0, 8).map((l) => (
                  <Chip key={l.id} label={`${formatDay(l.start)} ${formatTime(l.start)}`} selected={lessonId === l.id} onPress={() => { setLessonId(l.id); setChosen(null); }} />
                ))}
              </Row>
            </Section>
          ) : null}

          {kind === 'new-lesson' && studentEnrolments.length > 1 ? (
            <Section title="Which subject?">
              <Row gap={Spacing.one} wrap>
                {studentEnrolments.map((e) => (
                  <Chip
                    key={e.id}
                    label={studentEnrolments.filter((o) => sameSubject(o.subject, e.subject)).length > 1 ? enrolmentTitle(e) : e.subject}
                    selected={enrolment?.id === e.id}
                    onPress={() => { setPickedEnrolmentId(e.id); setChosen(null); }}
                  />
                ))}
              </Row>
            </Section>
          ) : null}

          {!tutorId ? (
            <Banner icon="alert">
              {student.fullName.split(' ')[0]} does not yet have a regular tutor{subject ? ` for ${subject}` : ''}. Please send us a message and we will arrange the first lesson.
            </Banner>
          ) : kind === 'reschedule' && !moving ? null : (
            <Section title={`${subject ? `${subject} · ` : ''}Times with ${lookup.tutor(tutorId)?.fullName ?? 'your tutor'} · ${duration} min`}>
              {slots.isLoading ? (
                <Loading />
              ) : days.length === 0 ? (
                <Banner icon="calendar">There are no open times in the next three weeks. Please send us a message and we will find a suitable time.</Banner>
              ) : (
                <>
                  <Row gap={Spacing.one} wrap>
                    {days.map((d) => (
                      <Chip key={d} label={formatDay(`${d}T12:00:00`)} selected={d === activeDay} onPress={() => setDay(d)} />
                    ))}
                  </Row>
                  <Card style={{ gap: Spacing.two }}>
                    <Txt variant="label">{formatDay(`${activeDay}T12:00:00`)}</Txt>
                    <Row gap={Spacing.one} wrap>
                      {(byDay.get(activeDay) ?? []).map((s) => (
                        <Chip key={s.start} label={formatTime(s.start)} selected={chosen === s.start} onPress={() => setChosen(s.start)} />
                      ))}
                    </Row>
                  </Card>
                </>
              )}
            </Section>
          )}

          <Field label="Note for us (optional)" value={note} onChangeText={setNote} multiline placeholder="e.g. Before the mock examination on Thursday" />
          {kind === 'new-lesson' && service ? <Txt variant="small">Extra lessons are charged at the usual rate for {service.name}.</Txt> : null}
          <ErrorNote error={request.error} />
          <View />
        </>
      ) : (
        <Txt variant="muted">Choose a child to see available times.</Txt>
      )}
    </Screen>
  );
}
