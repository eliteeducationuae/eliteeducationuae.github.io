import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { source } from '@/data';
import { useAction, useEnrolments, useHomework, useLesson, useLookup, useNotes, useRequests, useSettings, useTopicLookup } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatTime } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import { lessonFamilyCharge } from '@/domain/rates';
import { cancellationOutcome } from '@/domain/scheduling';
import type { Lesson } from '@/domain/types';

import { LessonPlanSection } from '../plans';
import { vatPercent } from '../tax';
import { Actions, Button, Columns, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, Notice, PageHeader, Prose, Screen, useToast } from '../ui';
import { dayMonth, firstName, lessonMinutes, longDay, shortWhen } from './format';
import { JoinPill } from './home';
import { openMessages } from './hooks';

/** A lesson as the family sees it: when and where, the tutor, the price, the note afterwards, and what they can do. */
export function ParentLesson({ id }: { id: string }) {
  const viewing = useViewing();
  const lookup = useLookup();
  const lesson = useLesson(id);
  const notes = useNotes({ lessonId: id });
  const enrolments = useEnrolments();
  const homework = useHomework();
  const requests = useRequests();
  const settings = useSettings();
  const topics = useTopicLookup();
  const [cancelling, setCancelling] = useState(false);
  const [now] = useState(() => new Date());

  const header = <Stack.Screen options={{ headerShown: false, title: 'Lesson' }} />;
  if (lesson.isLoading || !lookup.ready) return <Loading />;
  const l = lesson.data;
  if (!l) {
    return (
      <Screen topInset>
        {header}
        <PageHeader back={{ fallback: '/parent' }} kicker="Lesson" title="Lesson not found" />
        <EmptyState icon="event" title="Lesson not found" message="It may have been moved or cancelled. Your lessons are on Home." />
      </Screen>
    );
  }

  const service = lookup.service(l.serviceId);
  const tutor = lookup.tutor(l.tutorId);
  const note = notes.data?.[0];
  const subject = lessonSubject(l, enrolments.data ?? []);
  const kids = l.studentIds.filter((sid) => lookup.student(sid));
  const childNames = kids.map((sid) => firstName(lookup.student(sid)?.fullName)).join(' and ');
  const scheduled = l.status === 'scheduled';
  const started = new Date(l.start) <= now;
  const pending = (requests.data ?? []).find((r) => r.status === 'pending' && r.lessonId === l.id);
  const lessonHomework = (homework.data ?? []).filter((h) => h.lessonId === l.id);
  // What this family pays for the lesson: its agreed price where it has one, otherwise the service price.
  const price = service ? kids.reduce((sum, sid) => sum + lessonFamilyCharge(l, service, sid, enrolments.data ?? []).amount, 0) : 0;
  const vat = settings.data?.vatRate ?? 0;
  const when = shortWhen(l.start, now);
  const attended = note ? kids.map((sid) => note.attendance[sid]).filter(Boolean) : [];

  return (
    <Screen topInset>
      {header}
      <PageHeader
        back={{ fallback: '/parent' }}
        kicker={`Lesson · ${['Today', 'Tomorrow'].includes(when) ? when : subject ?? 'Lesson'}`}
        title={longDay(l.start)}
        sub={`${formatTime(l.start)} to ${formatTime(l.end)} · ${subject ? `${subject} ` : ''}with ${tutor?.fullName ?? 'your tutor'}`}
      />

      {l.status === 'cancelled' || l.status === 'late-cancel' ? (
        <Notice tone="danger" title="Cancelled">
          {`${l.status === 'late-cancel' ? 'This lesson was cancelled at short notice and is charged under the cancellation policy.' : 'This lesson was cancelled and is not charged.'}${l.cancelReason ? ` Reason: ${l.cancelReason}.` : ''}`}
        </Notice>
      ) : l.status === 'completed' ? (
        <Notice tone="good" title={attended.includes('absent') ? 'Recorded' : 'Attended'}>
          {attended.includes('absent')
            ? `${childNames} was marked absent.`
            : attended.includes('late')
              ? `${childNames} arrived a little late. The lesson appears on your next invoice.`
              : 'The lesson took place and appears on your next invoice.'}
        </Notice>
      ) : l.status === 'no-show' ? (
        <Notice tone="warn" title="Missed">
          The lesson was recorded as missed. Please message us if this is not right.
        </Notice>
      ) : null}

      {pending ? (
        <Notice tone="info" icon="hourglass_top" title="Change requested">
          {`You asked to move this lesson to ${shortWhen(pending.start, now).toLowerCase() === 'today' ? 'today' : longDay(pending.start)} at ${formatTime(pending.start)}. We will confirm with ${firstName(tutor?.fullName) || 'the tutor'} and let you know.`}
        </Notice>
      ) : null}

      {cancelling ? <CancelPanel lesson={l} price={price} onDone={() => setCancelling(false)} /> : null}

      <Columns>
        <Group title="Details">
          <GroupRow avatar={tutor?.fullName ?? 'Tutor'} title={tutor?.fullName ?? 'Your tutor'} note={childNames ? `${childNames}’s ${subject ? `${subject} ` : ''}tutor` : undefined} />
          <GroupRow
            icon={l.location === 'online' ? 'videocam' : 'location_on'}
            title={l.location === 'online' ? 'Online' : l.address || 'In person'}
            note={l.location === 'online' ? 'The video link opens ten minutes before the lesson' : 'Your tutor will come to this address'}
          />
          <GroupRow icon="school" title={[subject, service?.name].filter(Boolean).join(' · ') || 'Lesson'} note={`${lessonMinutes(l)} minutes`} />
          {price > 0 ? (
            <GroupRow icon="payments" title={`${formatAED(price)}${vat > 0 ? ` + VAT at ${vatPercent(vat)}` : ''}`} note="On your monthly invoice, unless prepaid lessons cover it" />
          ) : null}
        </Group>
        {lessonHomework.length ? (
          <Group title="Homework">
            {lessonHomework.map((h) => (
              <GroupRow key={h.id} icon="edit_note" title={h.title} note={`Due ${dayMonth(h.dueDate)}`} onPress={() => router.push(`/homework/${h.id}`)} />
            ))}
          </Group>
        ) : null}
      </Columns>

      {note?.summary ? (
        <Prose title="Lesson note" by={[tutor?.fullName, note.topicIds.map((t) => topics.name(t)).join(', ')].filter(Boolean).join(' · ')} paragraphs={[note.summary]} />
      ) : null}

      <LessonPlanSection lesson={l} />

      {scheduled && !cancelling && !viewing ? (
        <Actions>
          <JoinPillAction lesson={l} now={now} />
          {!started ? (
            <Button
              title={pending ? 'Request a different time' : 'Move this lesson'}
              icon="event_repeat"
              variant="secondary"
              onPress={() => router.push({ pathname: '/book', params: { lessonId: l.id } })}
            />
          ) : null}
          {!started ? <Button title="Cancel lesson" icon="event_busy" variant="secondary" onPress={() => setCancelling(true)} /> : null}
        </Actions>
      ) : null}
      {!scheduled && !viewing ? (
        <Actions>
          {l.status === 'cancelled' || l.status === 'late-cancel' ? <Button title="Book another time" icon="event_available" onPress={() => router.push('/book')} /> : null}
          <Button
            title={`Message ${firstName(tutor?.fullName) || 'us'}`}
            icon="forum"
            variant="secondary"
            onPress={() => openMessages(tutor ? `Hello ${firstName(tutor.fullName)}, ` : undefined)}
          />
        </Actions>
      ) : null}
    </Screen>
  );
}

/** The Join pill as a full-size action, for online lessons only. */
function JoinPillAction({ lesson, now }: { lesson: Lesson; now: Date }) {
  if (lesson.location !== 'online') return null;
  return <JoinPill lesson={lesson} now={now} />;
}

/** Cancel with the policy spelled out: free with enough notice, otherwise charged as Settings says. */
function CancelPanel({ lesson, price, onDone }: { lesson: Lesson; price: number; onDone: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const cancel = useAction(source.cancelLesson);
  const [reason, setReason] = useState('');
  if (!settings.data) return <Loading />;
  const preview = cancellationOutcome({ start: lesson.start }, new Date(), settings.data);
  const hours = settings.data.cancellationHours;
  const fee = price * preview.fee;
  return (
    <>
      <Notice tone={preview.chargeable ? 'danger' : 'info'} title="Cancel this lesson?">
        {preview.chargeable
          ? `It is less than ${hours} hours away, so under our policy it will be charged (${formatAED(fee)}). Moving it to another time is free if your tutor has space.`
          : preview.hoursNotice < hours
            ? 'This is late notice, but no charge will be made.'
            : `There is no charge, as it is more than ${hours} hours away.`}
      </Notice>
      <FieldsCard>
        <Field label="Reason (optional)" placeholder="e.g. Illness or a school trip" value={reason} onChangeText={setReason} />
      </FieldsCard>
      <ErrorNote error={cancel.error} />
      <Actions>
        <Button
          title="Yes, cancel the lesson"
          variant="danger"
          icon="event_busy"
          loading={cancel.isPending}
          onPress={async () => {
            try {
              const out = await cancel.mutateAsync([lesson.id, reason.trim() || 'Cancelled', false]);
              onDone();
              toast(out.chargeable ? 'Lesson cancelled. A late-cancellation charge has been added.' : 'Lesson cancelled. No charge was made.');
            } catch {
              // Shown above by ErrorNote.
            }
          }}
        />
        <Button title="Keep the lesson" variant="secondary" onPress={onDone} />
      </Actions>
    </>
  );
}
