import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Icon } from '@/components/icon';
import { LessonStatusBadge } from '@/components/lessons';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorNote, Field, ListItem, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import {
  useAbsences,
  useAction,
  useAvailability,
  useEnrolments,
  useLesson,
  useLessons,
  useLookup,
  useNotes,
  useSettings,
  useTopicLookup,
  useTutors,
} from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { lessonSubject, studentSubjects } from '@/domain/enrolments';
import { addDays, formatDay, formatTime, fromDateAndTime, minutesBetween, startOfDay, toDateKey } from '@/domain/dates';
import { cancellationOutcome, coverOptions, findClashes, isAbsent } from '@/domain/scheduling';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';

export default function LessonDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const me = useMe();
  const lookup = useLookup();
  const lesson = useLesson(id);
  const notes = useNotes({ lessonId: id });
  const enrolments = useEnrolments();
  const topics = useTopicLookup();
  const [mode, setMode] = useState<'view' | 'cancel' | 'move' | 'cover'>('view');

  if (lesson.isLoading || !lookup.ready) return <Loading />;
  const l = lesson.data;
  if (!l) return <Screen><EmptyState title="Lesson not found" /></Screen>;

  const service = lookup.service(l.serviceId);
  const tutor = lookup.tutor(l.tutorId);
  const note = notes.data?.[0];
  const subject = lessonSubject(l, enrolments.data ?? []);
  const isStaff = me.role === 'admin' || (me.role === 'tutor' && me.tutorId === l.tutorId);
  const scheduled = l.status === 'scheduled';
  const started = new Date(l.start) <= new Date();
  const canCancel = scheduled && !started && me.role !== 'student';

  return (
    <Screen>
      <Stack.Screen options={{ title: service?.name ?? 'Lesson' }} />
      <Card accent={tutor?.color} style={{ gap: Spacing.three }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{formatDay(l.start)}</Txt>
            <Txt variant="muted">
              {formatTime(l.start)}–{formatTime(l.end)} · {minutesBetween(new Date(l.start), new Date(l.end))} min
            </Txt>
          </View>
          <LessonStatusBadge lesson={l} />
        </Row>
        {subject ? (
          <Row gap={Spacing.two}>
            <Icon name="book" size={18} color={theme.textMuted} />
            <Txt>Subject: {subject}</Txt>
          </Row>
        ) : null}
        <Row gap={Spacing.two}>
          <Avatar name={tutor?.fullName ?? '?'} color={tutor?.color} size={32} />
          <Txt>{tutor?.fullName}</Txt>
        </Row>
        <Row gap={Spacing.two}>
          <Icon name={l.location === 'online' ? 'video' : 'pin'} size={18} color={theme.textMuted} />
          <Txt style={{ flex: 1 }}>{l.location === 'online' ? 'Online lesson' : (l.address ?? 'In person')}</Txt>
          {l.location === 'online' && l.meetingUrl && scheduled ? (
            <Button title="Join lesson" size="sm" icon="video" onPress={() => Linking.openURL(l.meetingUrl!)} />
          ) : null}
        </Row>
        {l.cancelReason ? <Txt variant="muted">Cancelled: {l.cancelReason}</Txt> : null}
      </Card>

      <Section title={l.studentIds.length > 1 ? 'Students' : 'Student'}>
        {l.studentIds.map((sid) => {
          const s = lookup.student(sid);
          return (
            <ListItem
              key={sid}
              title={s?.fullName ?? 'Student'}
              subtitle={note?.attendance[sid] ? `Attendance: ${note.attendance[sid]}` : studentSubjects(enrolments.data ?? [], sid) || s?.curriculum}
              left={<Avatar name={s?.fullName ?? '?'} size={36} />}
              onPress={me.role === 'admin' || me.role === 'tutor' ? () => router.push({ pathname: '/students/[id]', params: { id: sid } }) : undefined}
            />
          );
        })}
      </Section>

      {note ? (
        <Section title="Lesson notes">
          <Card>
            <Txt>{note.summary || 'No summary has been written yet.'}</Txt>
            {note.topicIds.length ? (
              <Row gap={4} wrap>
                {note.topicIds.map((t) => (
                  <Badge key={t} label={topics.name(t)} />
                ))}
              </Row>
            ) : null}
            {note.privateNote && isStaff ? (
              <Txt variant="small" style={{ color: theme.warning }}>
                Private: {note.privateNote}
              </Txt>
            ) : null}
          </Card>
          {isStaff && note.summary && source.aiAssist ? <ParentUpdate lessonId={l.id} familyIds={[...new Set(l.studentIds.map((sid) => lookup.student(sid)?.familyId).filter((f): f is string => !!f))]} /> : null}
        </Section>
      ) : null}

      {isStaff && scheduled ? (
        <Button
          title={started ? 'Record the lesson: notes, attendance and homework' : 'Record the lesson early'}
          icon="check"
          variant={started ? 'gold' : 'secondary'}
          onPress={() => router.push({ pathname: '/complete/[id]', params: { id: l.id } })}
        />
      ) : null}

      {mode === 'view' && scheduled ? (
        <Row gap={Spacing.two} wrap>
          {me.role === 'admin' && !started ? (
            <Button title="Reschedule" icon="calendar" variant="secondary" style={{ flex: 1 }} onPress={() => setMode('move')} />
          ) : null}
          {me.role === 'admin' && !started ? (
            <Button title="Change tutor" icon="people" variant="secondary" style={{ flex: 1 }} onPress={() => setMode('cover')} />
          ) : null}
          {me.role === 'parent' && !started ? (
            <Button title="Request a new time" icon="calendar" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/book', params: { lessonId: l.id } })} />
          ) : null}
          {canCancel ? <Button title="Cancel lesson" icon="close" variant="danger" style={{ flex: 1 }} onPress={() => setMode('cancel')} /> : null}
        </Row>
      ) : null}
      {mode === 'cover' ? <CoverPanel lesson={l} onDone={() => setMode('view')} /> : null}

      {mode === 'cancel' ? <CancelPanel lessonId={l.id} start={l.start} serviceRate={service?.rate ?? 0} studentCount={l.studentIds.filter((sid) => lookup.student(sid)).length} onDone={() => setMode('view')} /> : null}
      {mode === 'move' ? <ReschedulePanel lesson={l} onDone={() => setMode('view')} /> : null}
    </Screen>
  );
}

/** Reassign a lesson to another tutor — e.g. cover while the usual tutor is away. */
/** Turn the lesson notes into a short message for the family, with AI, then send it in their conversation. */
function ParentUpdate({ lessonId, familyIds }: { lessonId: string; familyIds: string[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = useAction(source.sendMessage);
  if (familyIds.length !== 1) return null;
  if (message === null)
    return (
      <View style={{ gap: Spacing.one }}>
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
    <Card style={{ gap: Spacing.two }}>
      <Field label="Message to the family (edit before sending)" value={message} onChangeText={setMessage} multiline />
      <ErrorNote error={send.error} />
      <Row gap={Spacing.two}>
        <Button title="Discard" variant="ghost" onPress={() => setMessage(null)} />
        <Button
          title="Send"
          icon="chat"
          variant="gold"
          style={{ flex: 1 }}
          disabled={!message.trim()}
          loading={send.isPending}
          onPress={async () => {
            await send.mutateAsync([familyIds[0], message.trim()]);
            setMessage(null);
            notify('Message sent', 'Your message has been added to the family’s conversation.');
          }}
        />
      </Row>
    </Card>
  );
}

function CoverPanel({ lesson, onDone }: { lesson: NonNullable<ReturnType<typeof useLesson>['data']>; onDone: () => void }) {
  const tutors = useTutors();
  const availability = useAvailability();
  const absences = useAbsences();
  const day = startOfDay(new Date(lesson.start));
  const sameDay = useLessons(day, addDays(day, 1));
  const reassign = useAction(source.reassignLesson);
  if (!tutors.data || !sameDay.data) return <Loading />;
  const away = isAbsent(lesson.tutorId, new Date(lesson.start), absences.data ?? []);
  const options = coverOptions(lesson, tutors.data, sameDay.data, availability.data ?? [], absences.data ?? []);
  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Choose a tutor</Txt>
      {away ? <Banner tone="warning" icon="alert">The usual tutor is away that day.</Banner> : null}
      {options.length === 0 ? <Txt variant="muted">Nobody else is free at this time.</Txt> : null}
      {options.map((o) => (
        <Row key={o.tutor.id} style={{ justifyContent: 'space-between' }}>
          <Row gap={Spacing.two} style={{ flex: 1 }}>
            <Avatar name={o.tutor.fullName} color={o.tutor.color} size={32} />
            <View style={{ flex: 1 }}>
              <Txt>{o.tutor.fullName}</Txt>
              <Txt variant="small">{o.available ? 'Free and within their availability' : 'Free, but outside their usual hours'}</Txt>
            </View>
          </Row>
          <Button
            title="Assign"
            size="sm"
            loading={reassign.isPending && reassign.variables?.[1] === o.tutor.id}
            onPress={async () => {
              await reassign.mutateAsync([lesson.id, o.tutor.id]);
              onDone();
              notify('Tutor changed', `${o.tutor.fullName} is now teaching this lesson and has been notified.`);
            }}
          />
        </Row>
      ))}
      <ErrorNote error={reassign.error} />
      <Button title="Back" variant="secondary" onPress={onDone} />
    </Card>
  );
}

function CancelPanel({
  lessonId,
  start,
  serviceRate,
  studentCount,
  onDone,
}: {
  lessonId: string;
  start: string;
  serviceRate: number;
  studentCount: number;
  onDone: () => void;
}) {
  const me = useMe();
  const settings = useSettings();
  const cancel = useAction(source.cancelLesson);
  const [reason, setReason] = useState('');
  const [waive, setWaive] = useState(false);
  if (!settings.data) return <Loading />;

  const preview = cancellationOutcome({ start }, new Date(), settings.data, { waiveFee: me.role === 'tutor' || (me.role === 'admin' && waive) });
  const late = preview.hoursNotice < settings.data.cancellationHours;
  // Families only see their own children, so this is what they would be charged.
  const fee = serviceRate * preview.fee * studentCount;

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Cancel this lesson</Txt>
      {late ? (
        <Banner tone={preview.chargeable ? 'warning' : 'info'} icon="alert">
          {preview.chargeable
            ? `This is less than ${settings.data.cancellationHours} hours’ notice, so the lesson will still be charged (${formatAED(fee)}).`
            : `This is late notice, but no charge will be made${me.role === 'tutor' ? ' because the tutor is cancelling' : ''}.`}
        </Banner>
      ) : (
        <Banner tone="success" icon="check">
          More than {settings.data.cancellationHours} hours’ notice, so there is no charge.
        </Banner>
      )}
      {me.role === 'admin' && late ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt>Waive the late-cancellation fee</Txt>
          <Switch value={waive} onValueChange={setWaive} accessibilityLabel="Waive the late-cancellation fee" />
        </Row>
      ) : null}
      <Field label="Reason" placeholder="e.g. Illness or a school trip" value={reason} onChangeText={setReason} />
      <ErrorNote error={cancel.error} />
      <Row gap={Spacing.two}>
        <Button title="Keep lesson" variant="secondary" style={{ flex: 1 }} onPress={onDone} />
        <Button
          title="Yes, cancel the lesson"
          variant="danger"
          style={{ flex: 1 }}
          loading={cancel.isPending}
          onPress={async () => {
            const out = await cancel.mutateAsync([lessonId, reason.trim() || 'Cancelled', waive]);
            onDone();
            notify('Lesson cancelled', out.chargeable ? 'A late-cancellation charge has been added.' : 'No charge was made.');
          }}
        />
      </Row>
    </Card>
  );
}

function ReschedulePanel({ lesson, onDone }: { lesson: NonNullable<ReturnType<typeof useLesson>['data']>; onDone: () => void }) {
  const lookup = useLookup();
  const start = new Date(lesson.start);
  const duration = minutesBetween(start, new Date(lesson.end));
  const [date, setDate] = useState(toDateKey(start));
  const [time, setTime] = useState(formatTime(start));
  const move = useAction(source.rescheduleLesson);
  const newStart = fromDateAndTime(date, time);
  const dayStart = startOfDay(newStart ?? start);
  const nearby = useLessons(dayStart, addDays(dayStart, 1));
  const clashes =
    newStart && nearby.data
      ? findClashes(
          { start: newStart, end: new Date(newStart.getTime() + duration * 60_000), tutorId: lesson.tutorId, studentIds: lesson.studentIds, ignoreLessonId: lesson.id },
          nearby.data,
        )
      : [];

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Move this lesson</Txt>
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Start time" value={time} onChangeText={setTime} placeholder="HH:MM" />
        </View>
      </Row>
      {!newStart ? <Banner tone="danger" icon="alert">Enter a date as YYYY-MM-DD and a time as HH:MM.</Banner> : null}
      {clashes.map((c) => (
        <Banner key={c.lesson.id} tone="warning" icon="alert">
          Clash: {c.reason === 'tutor' ? lookup.tutor(c.lesson.tutorId)?.fullName : lookup.studentNames(c.studentIds)} already has a lesson{' '}
          {formatTime(c.lesson.start)}–{formatTime(c.lesson.end)}.
        </Banner>
      ))}
      <ErrorNote error={move.error} />
      <Row gap={Spacing.two}>
        <Button title="Back" variant="secondary" style={{ flex: 1 }} onPress={onDone} />
        <Button
          title={clashes.length ? 'Move anyway' : 'Move lesson'}
          style={{ flex: 1 }}
          disabled={!newStart}
          loading={move.isPending}
          onPress={async () => {
            if (!newStart) return;
            await move.mutateAsync([lesson.id, newStart.toISOString(), new Date(newStart.getTime() + duration * 60_000).toISOString()]);
            onDone();
          }}
        />
      </Row>
    </Card>
  );
}
