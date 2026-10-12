import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { firstName, longDay } from '@/components/parent/format';
import { agreedPriceSentence } from '@/components/rates';
import { vatPercent } from '@/components/tax';
import { Actions, Button, ChipField, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, Notice, PageHeader, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useEnrolments, useLessons, useLookup, useOpenSlots, useServices, useSettings, useStudents } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';
import { addDays, formatDay, formatTime, startOfDay, toDateKey } from '@/domain/dates';
import { activeEnrolments, enrolmentFor, enrolmentTitle, lessonSubject, sameSubject } from '@/domain/enrolments';
import { byStart } from '@/domain/scheduling';

const today = startOfDay(new Date());
const WINDOW_DAYS = 21;

type Kind = 'new-lesson' | 'reschedule';

/** Parents pick a real open slot to request an extra lesson or to move one. Elite Education confirms it. */
export default function Book() {
  const params = useLocalSearchParams<{ lessonId?: string }>();
  const viewing = useViewing();
  const toast = useToast();
  const lookup = useLookup();
  const students = useStudents();
  const services = useServices();
  const settings = useSettings();
  const lessons = useLessons(addDays(today, -90), addDays(today, 90));
  const enrolments = useEnrolments();
  const request = useAction(source.requestLesson);

  const [studentId, setStudentId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>(params.lessonId ? 'reschedule' : 'new-lesson');
  const [lessonId, setLessonId] = useState<string | null>(params.lessonId ?? null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pickedEnrolmentId, setPickedEnrolmentId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const all = lessons.data ?? [];
  const moving = lessonId ? all.find((l) => l.id === lessonId) : undefined;
  const kids = withoutClosed(students.data);
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

  const header = <Stack.Screen options={{ headerShown: false, title: kind === 'reschedule' ? 'Move a lesson' : 'Book an additional lesson' }} />;
  const title = kind === 'reschedule' ? 'Move a lesson' : 'Book an additional lesson';
  if (students.isLoading || lessons.isLoading || !lookup.ready) return <Loading />;
  if (kids.length === 0) {
    return (
      <Screen topInset>
        {header}
        <PageHeader back={{ fallback: '/parent' }} kicker="Lessons" title={title} />
        <EmptyState
          icon="person_add"
          title="Please add your child first"
          message="Once your child has been added, you can request lessons here."
          action={viewing ? undefined : <Button title="Add my child" icon="person_add" onPress={() => router.replace('/onboarding')} />}
        />
      </Screen>
    );
  }

  const byDay = new Map<string, { start: string; end: string }[]>();
  for (const s of slots.data ?? []) {
    const k = toDateKey(new Date(s.start));
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const days = [...byDay.keys()];
  const activeDay = day && byDay.has(day) ? day : days[0];
  const tutorName = tutorId ? lookup.tutor(tutorId)?.fullName : undefined;
  const ready = !!chosen && !!student && !!tutorId && !!service && (kind !== 'reschedule' || !!moving);
  const vat = settings.data?.vatRate ?? 0;
  const priceNote =
    agreedPriceSentence(enrolment) ??
    (service ? `Additional lessons are charged at the usual rate of ${formatAED(service.rate)}${vat > 0 ? ` + VAT at ${vatPercent(vat)}` : ''} for ${service.name}, and appear on your next invoice.` : undefined);

  async function submit() {
    setTried(true);
    if (!ready || !student || !chosen || !tutorId || !service) return;
    try {
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
    } catch {
      return; // Shown below by ErrorNote.
    }
    toast(`Request sent. We will confirm with ${firstName(tutorName) || 'the tutor'} and let you know.`);
    if (router.canGoBack()) router.back();
    else router.replace('/parent');
  }

  const resetChoice = () => setChosen(null);

  return (
    <Screen topInset>
      {header}
      <PageHeader
        back={{ fallback: '/parent' }}
        kicker="Lessons"
        title={title}
        sub={`Choose one of ${tutorName ? `${firstName(tutorName)}’s` : 'the tutor’s'} open times. We will confirm with them and let you know.`}
      />

      <FieldsCard>
        {kids.length > 1 ? (
          <ChipField
            label="Which child?"
            options={kids.map((k) => ({ value: k.id, label: firstName(k.fullName) }))}
            value={student?.id}
            onChange={(v) => {
              setStudentId(v);
              setLessonId(null);
              resetChoice();
              setPickedEnrolmentId(null);
            }}
            error={tried && !student}
          />
        ) : null}
        <ChipField
          label="What would you like?"
          options={[
            { value: 'new-lesson', label: 'An additional lesson' },
            { value: 'reschedule', label: 'Move a lesson' },
          ]}
          value={kind}
          onChange={(k: Kind) => {
            setKind(k);
            resetChoice();
            if (k === 'new-lesson') setLessonId(null);
          }}
        />
        {student && kind === 'reschedule' ? (
          upcoming.length ? (
            <ChipField
              label="Which lesson?"
              options={upcoming.slice(0, 8).map((l) => ({ value: l.id, label: `${formatDay(l.start)} ${formatTime(l.start)}` }))}
              value={lessonId}
              onChange={(v) => {
                setLessonId(v);
                resetChoice();
              }}
              error={tried && !moving}
            />
          ) : (
            <Notice tone="info">There are no upcoming lessons to move.</Notice>
          )
        ) : null}
        {student && kind === 'new-lesson' && studentEnrolments.length > 1 ? (
          <ChipField
            label="Which subject?"
            options={studentEnrolments.map((e) => ({
              value: e.id,
              label: studentEnrolments.filter((o) => sameSubject(o.subject, e.subject)).length > 1 ? enrolmentTitle(e) : e.subject,
            }))}
            value={enrolment?.id}
            onChange={(v) => {
              setPickedEnrolmentId(v);
              resetChoice();
            }}
          />
        ) : null}
      </FieldsCard>

      {!student ? null : !tutorId ? (
        <Notice tone="info" icon="forum">
          {`${firstName(student.fullName)} does not yet have a regular tutor${subject ? ` for ${subject}` : ''}. Please send us a message and we will arrange the first lesson.`}
        </Notice>
      ) : kind === 'reschedule' && !moving ? null : (
        <>
          <Group>
            <GroupRow
              avatar={tutorName ?? 'Tutor'}
              title={`${subject ? `${subject} with ` : ''}${tutorName ?? 'your tutor'}`}
              note={`${duration} minutes · ${kind === 'reschedule' ? 'same tutor and length' : 'online or in person, as usual'}`}
            />
          </Group>
          {slots.isLoading ? (
            <Loading />
          ) : days.length === 0 ? (
            <Notice tone="info" icon="event">
              There are no open times in the next three weeks. Please send us a message and we will find a suitable time.
            </Notice>
          ) : (
            <FieldsCard title="Times in the next three weeks">
              <ChipField label="Day" options={days.map((d) => ({ value: d, label: formatDay(`${d}T12:00:00`) }))} value={activeDay} onChange={(d) => { setDay(d); resetChoice(); }} />
              <ChipField
                label={longDay(`${activeDay}T12:00:00`)}
                options={(byDay.get(activeDay) ?? []).map((s) => ({ value: s.start, label: formatTime(s.start) }))}
                value={chosen}
                onChange={setChosen}
                error={tried && !chosen ? 'Please choose a time.' : undefined}
              />
              <Field label="Note for us (optional)" value={note} onChangeText={setNote} multiline placeholder="e.g. Before the mock examination on Thursday" />
            </FieldsCard>
          )}
        </>
      )}

      {student && kind === 'new-lesson' && tutorId && priceNote ? (
        <Notice tone="info" icon="payments">
          {priceNote}
        </Notice>
      ) : null}
      <ErrorNote error={request.error} />
      {viewing ? null : (
        <Actions>
          <Button
            title={chosen ? `Request ${formatDay(chosen)} at ${formatTime(chosen)}` : 'Choose a time'}
            icon="send"
            disabled={!ready}
            loading={request.isPending}
            onPress={submit}
          />
        </Actions>
      )}
    </Screen>
  );
}
