import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { bookingPriceNotes } from '@/components/rates';
import { NoHeader, StepLabel, SummaryCard } from '@/components/ops/parts';
import { Button, Chip, ChipField, Columns, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Row, Screen, Txt, useToast } from '@/components/ui';
import { tutorChipLabel, useComplianceMap, VettingWarning } from '@/components/vetting';
import { source } from '@/data';
import { useAction, useBusyBlocks, useClosures, useEnrolments, useLessons, useLookup, useServices, useStudents, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { slotWarning } from '@/domain/calendar-connection';
import { SUBJECTS } from '@/domain/catalogue';
import { addDays, formatDay, formatTime, fromDateAndTime, startOfDay, toDateKey } from '@/domain/dates';
import { defaultSubject, enrolmentFor, sameSubject, subjectsFor, tutorTeaches } from '@/domain/enrolments';
import { expandWeeklySkipping, findBusyClashes, findClashes } from '@/domain/scheduling';
import type { LessonLocation } from '@/domain/types';
import { isVettingBlock } from '@/domain/vetting';
import { withoutClosed } from '@/domain/closed-accounts';
import { uuid } from '@/lib/id';
import { normaliseMeetingUrl } from '@/lib/safe-url';

type Repeat = 'once' | 'weekly' | 'fortnightly';

export default function NewLesson() {
  const params = useLocalSearchParams<{ date?: string; studentId?: string; tutorId?: string }>();
  const lookup = useLookup();
  const students = useStudents();
  const tutors = useTutors();
  const vetting = useComplianceMap();
  const services = useServices();
  const enrolments = useEnrolments();
  const create = useAction(source.createLessons);
  const toast = useToast();

  const initial = params.date ? new Date(params.date) : new Date();
  const [studentIds, setStudentIds] = useState<string[]>(params.studentId ? [params.studentId] : []);
  const [tutorId, setTutorId] = useState<string | null>(params.tutorId ?? null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState(toDateKey(initial));
  const [time, setTime] = useState('16:00');
  const [location, setLocation] = useState<LessonLocation>('online');
  const [where, setWhere] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('weekly');
  const [count, setCount] = useState('10');
  const [query, setQuery] = useState('');
  // Until someone picks a subject, it follows the students (and the service); after that it is theirs.
  const [pickedSubject, setPickedSubject] = useState<string | undefined>();
  const [subjectPicked, setSubjectPicked] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  const service = serviceId ? lookup.service(serviceId) : undefined;
  const allEnrolments = enrolments.data ?? [];
  const enrolled = subjectsFor(allEnrolments, studentIds);
  const subject = subjectPicked ? pickedSubject : defaultSubject(allEnrolments, studentIds, service);
  const enrolment = studentIds[0] && subject ? enrolmentFor(allEnrolments, studentIds[0], subject) : undefined;
  // The tutor already teaching this subject is the sensible default; an explicit choice always wins.
  const chosenTutorId = tutorId ?? enrolment?.tutorId ?? null;
  const showOther = otherOpen || (!!subject && !enrolled.some((x) => sameSubject(x, subject)));
  const pickSubject = (value: string | undefined) => {
    setPickedSubject(value);
    setSubjectPicked(true);
  };
  const start = fromDateAndTime(date, time);
  const n = repeat === 'once' ? 1 : Math.max(1, Math.min(52, parseInt(count, 10) || 1));
  const closures = useClosures();
  const { slots, skipped } =
    start && service
      ? expandWeeklySkipping({ start, durationMin: service.durationMin, intervalWeeks: repeat === 'fortnightly' ? 2 : 1, count: n }, closures.data ?? [])
      : { slots: [], skipped: [] };
  // Keep query keys stable between renders (no `new Date()` that changes every millisecond).
  const rangeStart = slots.length ? startOfDay(slots[0].start) : startOfDay(initial);
  const rangeEnd = addDays(slots.length ? startOfDay(slots[slots.length - 1].end) : rangeStart, 1);
  const existing = useLessons(rangeStart, rangeEnd);
  const clashes = chosenTutorId
    ? slots.flatMap((slot) => findClashes({ ...slot, tutorId: chosenTutorId, studentIds }, existing.data ?? []).map((c) => ({ slot, c })))
    : [];
  // Google Calendar busy times are a warning only.
  const busyBlocks = useBusyBlocks(rangeStart, rangeEnd, chosenTutorId ?? undefined);
  const busyClashes = chosenTutorId
    ? slots.flatMap((slot) => findBusyClashes({ ...slot, tutorId: chosenTutorId }, busyBlocks.data ?? []).map((b) => ({ slot, b })))
    : [];
  // Count dates, not clashes: one date may clash with a lesson and fall in a busy time.
  const clashSlots = new Set(clashes.map((x) => x.slot));
  const busySlots = new Set(busyClashes.map((x) => x.slot));
  const clashCount = new Set([...clashSlots, ...busySlots]).size;
  const warning = slotWarning({ affected: clashCount, lessonClashes: clashSlots.size, googleBusy: busySlots.size });

  // An online lesson's link must be a secure web address; it is opened for the family with one tap.
  const meetingUrl = location === 'online' && where.trim() ? normaliseMeetingUrl(where) : null;
  const badLink = location === 'online' && !!where.trim() && !meetingUrl;
  const ready = studentIds.length > 0 && chosenTutorId && service && start && !badLink;
  const toggleStudent = (id: string) => setStudentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function submit() {
    if (!ready) return;
    const seriesId = n > 1 ? uuid() : undefined;
    // A refusal (e.g. a vetting block) is shown from create.error below.
    const made = await create.mutateAsync([
      slots.map((s) => ({
        tutorId: chosenTutorId!,
        studentIds,
        subject: subject?.trim() || undefined,
        serviceId: service!.id,
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        location,
        meetingUrl: meetingUrl ?? undefined,
        address: location === 'in-person' ? where.trim() || undefined : undefined,
        seriesId,
      })),
    ]).catch(() => null);
    if (made === null) return;
    const who = lookup.studentNames(studentIds).split(' ')[0];
    if (router.canGoBack()) router.back();
    else router.replace('/admin/calendar');
    toast(`${slots.length} lesson${slots.length === 1 ? '' : 's'} scheduled for ${who || 'the student'}.`);
  }

  if (!lookup.ready) return <Loading />;
  const q = query.trim().toLowerCase();
  const studentList = withoutClosed(students.data).filter((s) => studentIds.includes(s.id) || !q || s.fullName.toLowerCase().includes(q));
  const tutorName = chosenTutorId ? lookup.tutor(chosenTutorId)?.fullName : undefined;
  const label = clashCount ? `Schedule ${slots.length} anyway` : `Schedule ${slots.length || ''} lesson${slots.length === 1 ? '' : 's'}`;

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader back kicker="Diary" title="Schedule lessons" sub="One-off or repeating, with clash checks against the diary and Google Calendar." />
      <Columns>
        <FieldsCard>
          <View style={{ gap: 12 }}>
            <StepLabel n={1} title="Student" />
            <Field label="Find a student" value={query} onChangeText={setQuery} placeholder="Type a name" />
            <Row gap={8} wrap>
              {studentList.map((s) => (
                <Chip key={s.id} label={s.fullName} selected={studentIds.includes(s.id)} onPress={() => toggleStudent(s.id)} />
              ))}
            </Row>
            {studentIds.length > 1 ? (
              <Txt variant="small">Group lesson: each family is charged its own price, and the tutor is paid the highest rate among the students.</Txt>
            ) : null}
            {bookingPriceNotes(studentIds, subject, allEnrolments, (id) => lookup.student(id)?.fullName).map((line) => (
              <Txt key={line} variant="small">
                {line}
              </Txt>
            ))}
          </View>

          {studentIds.length ? (
            <View style={{ gap: 12 }}>
              <StepLabel n={2} title="Subject" />
              <Row gap={8} wrap>
                {enrolled.map((x) => (
                  <Chip
                    key={x}
                    label={x}
                    selected={!showOther && sameSubject(subject, x)}
                    onPress={() => {
                      setOtherOpen(false);
                      pickSubject(x);
                    }}
                  />
                ))}
                <Chip label="Other subject…" selected={showOther} onPress={() => setOtherOpen(true)} />
              </Row>
              {!enrolled.length ? <Txt variant="small">No subjects are recorded for this student yet. Please choose one below.</Txt> : null}
              {showOther ? (
                <CataloguePicker label="Other subject" options={SUBJECTS} value={subject} onChange={pickSubject} otherPlaceholder="For example, Latin" collapsed={10} />
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: 12 }}>
            <StepLabel n={3} title="Tutor" />
            <Row gap={8} wrap>
              {withoutClosed(tutors.data).map((t) => (
                <Chip
                  key={t.id}
                  label={tutorChipLabel(subject && tutorTeaches(t, subject) ? `${t.fullName} ✓` : t.fullName, vetting.get(t.id))}
                  selected={chosenTutorId === t.id}
                  onPress={() => setTutorId(t.id)}
                />
              ))}
            </Row>
            {subject ? <Txt variant="small">✓ marks tutors who already teach {subject}.</Txt> : null}
          </View>

          <View style={{ gap: 12 }}>
            <StepLabel n={4} title="Service" />
            <Row gap={8} wrap>
              {(services.data ?? []).map((s) => (
                <Chip key={s.id} label={`${s.name} · ${s.durationMin} min · ${formatAED(s.rate)}`} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />
              ))}
            </Row>
          </View>

          <View style={{ gap: 12 }}>
            <StepLabel n={5} title="First lesson" />
            <Row gap={12} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Start time" value={time} onChangeText={setTime} placeholder="HH:MM" />
              </View>
            </Row>
            {!start ? <Notice tone="danger">Enter the date as YYYY-MM-DD and the time as HH:MM (24-hour).</Notice> : null}
          </View>

          <View style={{ gap: 12 }}>
            <StepLabel n={6} title="Repeat" />
            <ChipField<Repeat>
              options={[
                { value: 'once', label: 'One-off' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'fortnightly', label: 'Fortnightly' },
              ]}
              value={repeat}
              onChange={setRepeat}
            />
            {repeat !== 'once' ? <Field label="Number of lessons" value={count} onChangeText={setCount} keyboardType="number-pad" /> : null}
          </View>

          <View style={{ gap: 12 }}>
            <StepLabel n={7} title="Where" />
            <ChipField<LessonLocation>
              options={[
                { value: 'online', label: 'Online' },
                { value: 'in-person', label: 'In person' },
              ]}
              value={location}
              onChange={setLocation}
            />
            <Field
              label={location === 'online' ? 'Meeting link' : 'Address'}
              value={where}
              onChangeText={setWhere}
              placeholder={location === 'online' ? 'https://meet.google.com/…' : 'e.g. Elite Education Centre, Al Barsha'}
              autoCapitalize={location === 'online' ? 'none' : 'sentences'}
              error={badLink ? 'Please enter a secure web address beginning https://, such as a Google Meet or Zoom link.' : undefined}
            />
          </View>
        </FieldsCard>

        <View style={{ gap: 16 }}>
          <SummaryCard
            kicker="Preview"
            title={
              slots.length
                ? `${lookup.studentNames(studentIds) || 'Choose a student'}${subject ? ` · ${subject}` : ''}${tutorName ? ` with ${tutorName.split(' ')[0]}` : ''}, ${slots.length} lesson${slots.length === 1 ? '' : 's'}`
                : 'Choose a service and a start time'
            }>
            {skipped.length ? (
              <Notice icon="beach_access">
                Skipping {skipped.map((d) => formatDay(d)).join(', ')} (holiday{skipped.length === 1 ? '' : 's'}).
              </Notice>
            ) : null}
            {slots.length && clashCount ? (
              <Notice tone="warn">{warning}</Notice>
            ) : slots.length && chosenTutorId ? (
              <Notice tone="good">No clashes with existing lessons.</Notice>
            ) : null}
            {slots.length ? (
              <View>
                {slots.slice(0, 12).map((s) => {
                  const clash = clashes.find((x) => x.slot === s);
                  const googleBusy = busyClashes.some((x) => x.slot === s);
                  const flagged = clash || googleBusy;
                  return (
                    <View key={s.start.toISOString()} style={{ paddingVertical: 6, gap: 2 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt style={{ fontSize: 14.5 }} color={flagged ? 'warning' : undefined}>
                          {formatDay(s.start)}
                        </Txt>
                        <Txt variant="note" color={flagged ? 'warning' : undefined}>
                          {formatTime(s.start)}–{formatTime(s.end)}
                        </Txt>
                      </Row>
                      {flagged ? (
                        <Txt variant="small" color="warning">
                          {clash ? `Clash: ${clash.c.reason === 'tutor' ? 'the tutor is busy' : `${lookup.studentNames(clash.c.studentIds)} busy`}` : ''}
                          {clash && googleBusy ? ' · ' : ''}
                          {googleBusy ? 'Google Calendar shows the tutor as busy' : ''}
                        </Txt>
                      ) : null}
                    </View>
                  );
                })}
                {slots.length > 12 ? <Txt variant="small">…and {slots.length - 12} more</Txt> : null}
              </View>
            ) : null}
            {chosenTutorId ? <VettingWarning key={chosenTutorId} tutorId={chosenTutorId} action="lesson" expanded={isVettingBlock(create.error)} /> : null}
            <ErrorNote error={create.error} />
            <Button title={label} icon="event_available" disabled={!ready} loading={create.isPending} onPress={submit} />
          </SummaryCard>
        </View>
      </Columns>
    </Screen>
  );
}
