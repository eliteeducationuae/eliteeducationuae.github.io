import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAbsences, useAction, useAvailability, useLessons, useLookup, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, formatDate, formatDay, formatTime, startOfDay, toDateKey } from '@/domain/dates';
import { lessonsDuringAbsence } from '@/domain/scheduling';
import type { Availability, Tutor } from '@/domain/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const today = startOfDay(new Date());

/** A tutor's weekly availability (what families can book) and time off. Admins can open it for any tutor. */
export default function AvailabilityScreen() {
  const me = useMe();
  const params = useLocalSearchParams<{ tutorId?: string }>();
  const tutors = useTutors();
  const availability = useAvailability();
  const tutorId = params.tutorId ?? me.tutorId;
  const tutor = tutors.data?.find((t) => t.id === tutorId);
  if (tutors.isLoading || availability.isLoading) return <Loading />;
  if (!tutor) return <Screen><EmptyState title="No tutor profile linked to this account" /></Screen>;
  const mine = (availability.data ?? []).filter((a) => a.tutorId === tutor.id);
  return (
    <Screen>
      <Stack.Screen options={{ title: me.tutorId === tutor.id ? 'Availability and time off' : `${tutor.fullName.split(' ')[0]}’s availability` }} />
      <WeeklyEditor key={`${tutor.id}-${mine.length}`} tutor={tutor} initial={mine} />
      <TimeOff tutor={tutor} />
    </Screen>
  );
}

function WeeklyEditor({ tutor, initial }: { tutor: Tutor; initial: Availability[] }) {
  const save = useAction(source.setAvailability);
  const [blocks, setBlocks] = useState(initial.map((b) => ({ weekday: b.weekday, start: b.start, end: b.end })));
  const [saved, setSaved] = useState(false);
  const invalid = blocks.some((b) => !TIME.test(b.start) || !TIME.test(b.end) || b.end <= b.start);
  const update = (i: number, patch: Partial<(typeof blocks)[number]>) => {
    setSaved(false);
    setBlocks((x) => x.map((b, j) => (i === j ? { ...b, ...patch } : b)));
  };

  return (
    <Section title="Weekly availability">
      <Txt variant="muted">Families can request lessons within these times, in 30-minute steps, whenever you are free.</Txt>
      {DAYS.map((day, weekday) => {
        const rows = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.weekday === weekday);
        return (
          <Card key={day} style={{ gap: Spacing.two }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="h3">{day}</Txt>
              <Button
                title="Add time"
                icon="plus"
                size="sm"
                variant="ghost"
                onPress={() => {
                  setSaved(false);
                  setBlocks((x) => [...x, { weekday, start: '15:00', end: '19:00' }]);
                }}
              />
            </Row>
            {rows.length === 0 ? <Txt variant="small">Not available</Txt> : null}
            {rows.map(({ b, i }) => (
              <Row key={i} gap={Spacing.two}>
                <View style={{ flex: 1 }}>
                  <Field label="From" value={b.start} onChangeText={(t) => update(i, { start: t })} placeholder="15:00" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="To" value={b.end} onChangeText={(t) => update(i, { end: t })} placeholder="19:00" />
                </View>
                <Button title="Remove" size="sm" variant="danger" onPress={() => setBlocks((x) => x.filter((_, j) => j !== i))} style={{ marginTop: 18 }} />
              </Row>
            ))}
          </Card>
        );
      })}
      {invalid ? <Banner tone="danger" icon="alert">Use 24-hour times like 15:30, and make each block end after it starts.</Banner> : null}
      {saved ? <Banner tone="success" icon="check">Availability saved.</Banner> : null}
      <ErrorNote error={save.error} />
      <Button
        title="Save availability"
        variant="gold"
        disabled={invalid}
        loading={save.isPending}
        onPress={async () => {
          await save.mutateAsync([tutor.id, blocks]);
          setSaved(true);
        }}
      />
    </Section>
  );
}

function TimeOff({ tutor }: { tutor: Tutor }) {
  const me = useMe();
  const absences = useAbsences();
  const lookup = useLookup();
  const lessons = useLessons(today, addDays(today, 120));
  const saveAbsence = useAction(source.saveAbsence);
  const remove = useAction(source.deleteAbsence);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const mine = (absences.data ?? []).filter((a) => a.tutorId === tutor.id && a.endDate >= toDateKey(today));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end || start) && (end || start) >= start;

  return (
    <Section title="Time off">
      {mine.map((a) => {
        const affected = lessonsDuringAbsence(a, lessons.data ?? []);
        return (
          <Card key={a.id} style={{ gap: Spacing.two }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="h3">
                  {formatDate(a.startDate)}
                  {a.endDate !== a.startDate ? ` – ${formatDate(a.endDate)}` : ''}
                </Txt>
                {a.reason ? <Txt variant="muted">{a.reason}</Txt> : null}
              </View>
              <Button title="Remove" size="sm" variant="ghost" onPress={() => remove.mutate([a.id])} />
            </Row>
            {affected.length ? (
              <Banner tone="warning" icon="alert">
                {affected.length} lesson{affected.length === 1 ? '' : 's'} booked then
                {me.role === 'admin' ? ' — tap one to find cover.' : '. Elite Education will arrange cover.'}
              </Banner>
            ) : null}
            {me.role === 'admin'
              ? affected.map((l) => (
                  <Chip
                    key={l.id}
                    label={`${formatDay(l.start)} ${formatTime(l.start)} · ${lookup.studentNames(l.studentIds)}`}
                    onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
                  />
                ))
              : null}
          </Card>
        );
      })}
      <Card style={{ gap: Spacing.three }}>
        <Txt variant="h3">Add time off</Txt>
        <Row gap={Spacing.two}>
          <View style={{ flex: 1 }}>
            <Field label="From" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="To (optional)" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" />
          </View>
        </Row>
        <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. Holiday or a conference" />
        <ErrorNote error={saveAbsence.error} />
        <Button
          title="Add time off"
          disabled={!valid}
          loading={saveAbsence.isPending}
          onPress={async () => {
            await saveAbsence.mutateAsync([{ tutorId: tutor.id, startDate: start, endDate: end || start, reason: reason.trim() || undefined }]);
            setStart('');
            setEnd('');
            setReason('');
          }}
        />
      </Card>
    </Section>
  );
}
