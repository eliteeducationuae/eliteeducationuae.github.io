import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { source } from '@/data';
import {
  useAbsences,
  useAction,
  useAvailability,
  useBusyBlocks,
  useEnrolments,
  useLesson,
  useLessons,
  useLookup,
  useNotes,
  useSettings,
  useTopicLookup,
  useTutors,
} from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';
import { addDays, formatDay, formatTime, fromDateAndTime, minutesBetween, startOfDay, toDateKey } from '@/domain/dates';
import { lessonSubject, studentSubjects, tutorTeaches } from '@/domain/enrolments';
import { lessonFamilyCharge } from '@/domain/rates';
import { cancellationOutcome, coverOptions, findBusyClashes, findClashes, isAbsent } from '@/domain/scheduling';
import type { Lesson, Service } from '@/domain/types';
import { canAssignTutor } from '@/domain/vetting';
import { safeMeetingUrl } from '@/lib/safe-url';

import { HandoverLink } from '../handover';
import { HistorySection } from '../history';
import { LESSON_STATUS } from '../lessons';
import { LessonPlanSection } from '../plans';
import {
  Actions,
  Button,
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
  Toggle,
  Txt,
  useToast,
} from '../ui';
import { LessonVettingNote, notCleared, tutorChipLabel, useComplianceMap } from '../vetting';
import { Facts, NoHeader } from './parts';

type Mode = 'view' | 'cancel' | 'move' | 'cover';

/**
 * The admin's lesson page (the redesign's "Lesson"): the facts, the plan and history on the left; recording,
 * rescheduling, changing tutor and cancelling on the right. Tutors and families keep their own page.
 */
export function AdminLesson({ id }: { id: string }) {
  const lookup = useLookup();
  const lesson = useLesson(id);
  const notes = useNotes({ lessonId: id });
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const vetting = useComplianceMap();
  const [mode, setMode] = useState<Mode>('view');
  const [now] = useState(() => new Date());

  if (lesson.isLoading || !lookup.ready) return <Loading />;
  const l = lesson.data;
  if (!l) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/admin/calendar' }} kicker="Lesson" title="Lesson not found" />
        <EmptyState title="Lesson not found" message="It may have been removed, or the link is out of date." />
      </Screen>
    );
  }

  const service = lookup.service(l.serviceId);
  const tutor = lookup.tutor(l.tutorId);
  const note = notes.data?.[0];
  const subject = lessonSubject(l, enrolments.data ?? []);
  const scheduled = l.status === 'scheduled';
  const started = new Date(l.start) <= now;
  const needsNotes = scheduled && new Date(l.end) < now;
  const statusLabel = needsNotes ? 'Needs notes' : LESSON_STATUS[l.status].label;
  const families = [...new Set(l.studentIds.map((sid) => lookup.student(sid)?.familyId).filter((f): f is string => !!f))];
  const familyNames = families.map((f) => lookup.family(f)?.name).filter(Boolean);
  const link = l.location === 'online' ? safeMeetingUrl(l.meetingUrl) : null;

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader
        back={{ fallback: '/admin/calendar' }}
        kicker={`Lesson${service ? ` · ${service.name}` : ''}`}
        title={l.studentIds.map((sid) => lookup.student(sid)?.fullName).filter(Boolean).join(' & ') || 'Lesson'}
        sub={`${formatDay(l.start)} · ${formatTime(l.start)}–${formatTime(l.end)} · ${minutesBetween(new Date(l.start), new Date(l.end))} min`}
      />
      <Columns>
        <View style={{ gap: 20 }}>
          <Facts
            rows={[
              { k: 'Subject', v: subject },
              { k: 'Tutor', v: tutor ? tutorChipLabel(tutor.fullName, vetting.get(tutor.id)) : undefined, tone: tutor && notCleared(vetting.get(tutor.id)) ? 'warn' : undefined },
              { k: 'Where', v: l.location === 'online' ? (link ? 'Online · video link ready' : 'Online · no link yet') : (l.address ?? 'In person') },
              ...(familyNames.length ? [{ k: familyNames.length > 1 ? 'Families' : 'Family', v: familyNames.map((n) => `${n} family`).join(', ') }] : []),
              { k: 'Status', v: statusLabel, tone: needsNotes ? ('warn' as const) : l.status === 'completed' ? ('good' as const) : ('muted' as const) },
              ...(l.cancelReason ? [{ k: 'Reason', v: l.cancelReason }] : []),
            ]}
          />

          <Group title={l.studentIds.length > 1 ? 'Students' : 'Student'}>
            {l.studentIds.map((sid) => {
              const s = lookup.student(sid);
              return (
                <GroupRow
                  key={sid}
                  avatar={s?.fullName ?? 'Student'}
                  title={s?.fullName ?? 'Student'}
                  note={note?.attendance[sid] ? `Attendance: ${note.attendance[sid]}` : studentSubjects(enrolments.data ?? [], sid) || s?.curriculum}
                  onPress={() => router.push({ pathname: '/students/[id]', params: { id: sid } })}
                />
              );
            })}
          </Group>

          {note ? (
            <Group title="Lesson notes" meta="Sent to the family">
              <View style={{ padding: 18, gap: 10 }}>
                <Txt>{note.summary || 'No summary has been written yet.'}</Txt>
                {note.topicIds.length ? <Txt variant="note">Topics: {note.topicIds.map((t) => topics.name(t)).join(', ')}</Txt> : null}
                {note.privateNote ? (
                  <Txt variant="note" color="warning">
                    Private, staff only: {note.privateNote}
                  </Txt>
                ) : null}
              </View>
            </Group>
          ) : null}
          {note?.summary && source.aiAssist && families.length === 1 ? <ParentUpdate lessonId={l.id} familyId={families[0]} /> : null}

          <LessonPlanSection lesson={l} />
          <HandoverLink lessonId={l.id} />
          <HistorySection filter={{ entityId: l.id }} />
        </View>

        <View style={{ gap: 16 }}>
          {scheduled ? <LessonVettingNote tutorId={l.tutorId} /> : null}
          {scheduled ? (
            <Button
              title={started ? 'Record attendance and notes' : 'Record the lesson early'}
              icon="edit_note"
              variant={started ? 'primary' : 'secondary'}
              onPress={() => router.push({ pathname: '/complete/[id]', params: { id: l.id } })}
            />
          ) : (
            <Notice tone={l.status === 'completed' ? 'good' : l.status === 'no-show' ? 'warn' : 'info'} title={statusLabel}>
              {l.status === 'completed'
                ? note
                  ? 'Attendance and notes are recorded below.'
                  : 'This lesson has been recorded.'
                : l.status === 'no-show'
                  ? 'Recorded as a no-show.'
                  : 'This lesson was cancelled.'}
            </Notice>
          )}
          {link && scheduled ? <Button title="Join lesson" icon="videocam" variant="secondary" onPress={() => Linking.openURL(link)} /> : null}

          {mode === 'view' && scheduled && !started ? (
            <Actions>
              <Button title="Reschedule" icon="calendar_month" variant="secondary" onPress={() => setMode('move')} />
              <Button title="Change tutor" icon="swap_horiz" variant="secondary" onPress={() => setMode('cover')} />
              <Button title="Cancel lesson" icon="close" variant="danger" onPress={() => setMode('cancel')} />
            </Actions>
          ) : null}
          {mode === 'cover' ? <CoverPanel lesson={l} subject={subject} onDone={() => setMode('view')} /> : null}
          {mode === 'cancel' ? (
            <CancelPanel
              lesson={l}
              service={service}
              studentIds={l.studentIds.filter((sid) => lookup.student(sid))}
              onDone={() => setMode('view')}
            />
          ) : null}
          {mode === 'move' ? <ReschedulePanel lesson={l} onDone={() => setMode('view')} /> : null}
        </View>
      </Columns>
    </Screen>
  );
}

/** Turn the lesson notes into a short message for the family, with AI, then send it in their conversation. */
function ParentUpdate({ lessonId, familyId }: { lessonId: string; familyId: string }) {
  const toast = useToast();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = useAction(source.sendMessage);
  if (message === null)
    return (
      <View style={{ gap: 8, flexDirection: 'column', alignItems: 'flex-start' }}>
        <Button
          title="Draft a message to the family"
          icon="sparkle"
          variant="secondary"
          size="sm"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            setFailed(false);
            const res = await source.aiAssist?.({ task: 'parent-update', lessonId });
            setBusy(false);
            if (res?.task === 'parent-update') setMessage(res.message);
            else setFailed(true);
          }}
        />
        {failed ? <Txt variant="small">Drafting is not available at the moment. Please write the message yourself.</Txt> : null}
      </View>
    );
  return (
    <FieldsCard title="Message to the family">
      <Field label="Edit before sending" value={message} onChangeText={setMessage} multiline />
      <ErrorNote error={send.error} />
      <Actions>
        <Button
          title="Send"
          icon="send"
          disabled={!message.trim()}
          loading={send.isPending}
          onPress={async () => {
            try {
              await send.mutateAsync([familyId, message.trim()]);
            } catch {
              return;
            }
            setMessage(null);
            toast('Message sent. It is in the family’s conversation.');
          }}
        />
        <Button title="Discard" variant="ghost" onPress={() => setMessage(null)} />
      </Actions>
    </FieldsCard>
  );
}

/** Reassign the lesson to another tutor, e.g. cover while the usual tutor is away. Clearance shows on every name. */
function CoverPanel({ lesson, subject, onDone }: { lesson: Lesson; subject?: string; onDone: () => void }) {
  const toast = useToast();
  const tutors = useTutors();
  const availability = useAvailability();
  const absences = useAbsences();
  const [day] = useState(() => startOfDay(new Date(lesson.start)));
  const sameDay = useLessons(day, addDays(day, 1));
  const busyBlocks = useBusyBlocks(day, addDays(day, 1));
  const reassign = useAction(source.reassignLesson);
  const vetting = useComplianceMap();
  const [now] = useState(() => new Date());
  if (!tutors.data || !sameDay.data) return <Loading />;
  const away = isAbsent(lesson.tutorId, new Date(lesson.start), absences.data ?? []);
  // Tutors who cannot take new lessons (clearance enforced, no override) go last, with a way to resolve it.
  const options = coverOptions(lesson, withoutClosed(tutors.data), sameDay.data, availability.data ?? [], absences.data ?? [], busyBlocks.data ?? [])
    .map((o, i) => ({ o, i, blocked: !canAssignTutor(vetting.get(o.tutor.id), now).allowed }))
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.i - b.i);
  return (
    <View style={{ gap: 12 }}>
      {away ? <Notice tone="warn">The usual tutor is away that day.</Notice> : null}
      <Group title="Choose a tutor" meta="Free at this time">
        {options.length === 0 ? <GroupRow title="Nobody else is free at this time" icon="event_busy" tone="neutral" /> : null}
        {options.map(({ o, blocked }) => (
          <GroupRow
            key={o.tutor.id}
            avatar={o.tutor.fullName}
            avatarColor={o.tutor.color}
            title={tutorChipLabel(o.tutor.fullName, vetting.get(o.tutor.id))}
            note={
              blocked
                ? 'Police clearance must be verified, or an override recorded, before new lessons can be assigned'
                : `${o.available ? 'Free and within their availability' : 'Free, but outside their usual hours'}${
                    subject ? (tutorTeaches(o.tutor, subject) ? `. Teaches ${subject}` : '. Outside their usual subjects') : ''
                  }`
            }
            action={
              blocked
                ? { label: 'Record override', onPress: () => router.push({ pathname: '/manage/vetting/[tutorId]', params: { tutorId: o.tutor.id } }) }
                : {
                    label: reassign.isPending && reassign.variables?.[1] === o.tutor.id ? 'Assigning…' : 'Assign',
                    variant: 'primary',
                    disabled: reassign.isPending,
                    accessibilityLabel: `Assign ${o.tutor.fullName}`,
                    onPress: async () => {
                      try {
                        await reassign.mutateAsync([lesson.id, o.tutor.id]);
                      } catch {
                        return;
                      }
                      onDone();
                      toast(`${o.tutor.fullName} now teaches this lesson and has been notified.`);
                    },
                  }
            }
          />
        ))}
      </Group>
      <ErrorNote error={reassign.error} />
      <Actions>
        <Button title="Back" variant="secondary" onPress={onDone} />
      </Actions>
    </View>
  );
}

function CancelPanel({ lesson, service, studentIds, onDone }: { lesson: Lesson; service?: Service; studentIds: string[]; onDone: () => void }) {
  const toast = useToast();
  const settings = useSettings();
  const enrolments = useEnrolments();
  const cancel = useAction(source.cancelLesson);
  const [reason, setReason] = useState('');
  const [waive, setWaive] = useState(false);
  if (!settings.data) return <Loading />;

  const preview = cancellationOutcome({ start: lesson.start }, new Date(), settings.data, { waiveFee: waive });
  const late = preview.hoursNotice < settings.data.cancellationHours;
  // Each family pays its own agreed price where it has one, otherwise the service price.
  const fee = service
    ? studentIds.reduce((sum, sid) => sum + lessonFamilyCharge(lesson, service, sid, enrolments.data ?? []).amount * preview.fee, 0)
    : 0;
  const hours = settings.data.cancellationHours;

  return (
    <FieldsCard title="Cancel this lesson">
      {late ? (
        <Notice tone={preview.chargeable ? 'warn' : 'info'}>
          {preview.chargeable
            ? `Less than ${hours} hours’ notice, so the lesson will still be charged (${formatAED(fee)}).`
            : `Less than ${hours} hours’ notice, but the fee is waived. No charge will be made.`}
        </Notice>
      ) : (
        <Notice tone="good">More than {hours} hours’ notice, so there is no charge.</Notice>
      )}
      {late ? <Toggle title="Waive the late-cancellation fee" value={waive} onValueChange={setWaive} /> : null}
      <Field label="Reason" placeholder="For example, illness or a school trip" value={reason} onChangeText={setReason} />
      <ErrorNote error={cancel.error} />
      <Actions>
        <Button title="Keep the lesson" variant="secondary" onPress={onDone} />
        <Button
          title="Yes, cancel it"
          variant="danger"
          loading={cancel.isPending}
          onPress={async () => {
            let out;
            try {
              out = await cancel.mutateAsync([lesson.id, reason.trim() || 'Cancelled', waive]);
            } catch {
              return;
            }
            onDone();
            toast(out.chargeable ? 'Lesson cancelled. A late-cancellation charge has been added.' : 'Lesson cancelled. No charge was made.');
          }}
        />
      </Actions>
    </FieldsCard>
  );
}

function ReschedulePanel({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const toast = useToast();
  const lookup = useLookup();
  const start = new Date(lesson.start);
  const duration = minutesBetween(start, new Date(lesson.end));
  const [date, setDate] = useState(toDateKey(start));
  const [time, setTime] = useState(formatTime(start));
  const move = useAction(source.rescheduleLesson);
  const newStart = fromDateAndTime(date, time);
  const dayStart = startOfDay(newStart ?? start);
  const nearby = useLessons(dayStart, addDays(dayStart, 1));
  const busyBlocks = useBusyBlocks(dayStart, addDays(dayStart, 1), lesson.tutorId);
  const newEnd = newStart ? new Date(newStart.getTime() + duration * 60_000) : null;
  const clashes =
    newStart && newEnd && nearby.data
      ? findClashes({ start: newStart, end: newEnd, tutorId: lesson.tutorId, studentIds: lesson.studentIds, ignoreLessonId: lesson.id }, nearby.data)
      : [];
  const busyClashes = newStart && newEnd ? findBusyClashes({ start: newStart, end: newEnd, tutorId: lesson.tutorId }, busyBlocks.data ?? []) : [];
  const tutorName = lookup.tutor(lesson.tutorId)?.fullName ?? 'The tutor';
  const clear = newStart && !clashes.length && !busyClashes.length && !nearby.isLoading;

  return (
    <FieldsCard title="Move this lesson">
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Start time" value={time} onChangeText={setTime} placeholder="HH:MM" />
        </View>
      </Row>
      {!newStart ? <Notice tone="danger">Enter a date as YYYY-MM-DD and a time as HH:MM.</Notice> : null}
      {clashes.map((c) => (
        <Notice key={c.lesson.id} tone="warn">
          Clash: {c.reason === 'tutor' ? lookup.tutor(c.lesson.tutorId)?.fullName : lookup.studentNames(c.studentIds)} already has a lesson{' '}
          {formatTime(c.lesson.start)}–{formatTime(c.lesson.end)}.
        </Notice>
      ))}
      {busyClashes.map((b) => (
        <Notice key={b.id} tone="warn">
          Google Calendar shows {tutorName} as busy {formatTime(b.start)}–{formatTime(b.end)}.
        </Notice>
      ))}
      {clear ? <Notice tone="good">{`${tutorName} is free. No clashes for ${lookup.studentNames(lesson.studentIds)}.`}</Notice> : null}
      <ErrorNote error={move.error} />
      <Actions>
        <Button
          title={clashes.length || busyClashes.length ? 'Move anyway' : 'Move the lesson'}
          disabled={!newStart}
          loading={move.isPending}
          onPress={async () => {
            if (!newStart || !newEnd) return;
            try {
              await move.mutateAsync([lesson.id, newStart.toISOString(), newEnd.toISOString()]);
            } catch {
              return;
            }
            onDone();
            toast(`Moved to ${formatDay(newStart)} at ${formatTime(newStart)}.`);
          }}
        />
        <Button title="Back" variant="secondary" onPress={onDone} />
      </Actions>
    </FieldsCard>
  );
}
