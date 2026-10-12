import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Actions, Button, Chip, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, Notice, PageHeader, Row, Screen, Txt, useToast } from '@/components/ui';
import { DateKeyField } from '@/components/vetting';
import { source } from '@/data';
import { useAbsences, useAction, useAvailability, useLessons, useLookup, useTutors } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { addDays, formatDate, formatDay, formatTime, startOfDay, toDateKey } from '@/domain/dates';
import { lessonsDuringAbsence } from '@/domain/scheduling';
import type { Availability, Tutor } from '@/domain/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = startOfDay(new Date());

/** A tutor's weekly availability (what families can book) and time off. Admins can open it for any tutor. */
export default function AvailabilityScreen() {
  const me = useMe();
  const params = useLocalSearchParams<{ tutorId?: string; date?: string }>();
  const tutors = useTutors();
  const availability = useAvailability();
  const tutorId = params.tutorId ?? me.tutorId;
  const tutor = tutors.data?.find((t) => t.id === tutorId);
  if (tutors.isLoading || availability.isLoading) return <Loading />;
  if (!tutor) return <Screen><EmptyState title="No tutor profile linked to this account" /></Screen>;
  const mine = (availability.data ?? []).filter((a) => a.tutorId === tutor.id);
  const own = me.tutorId === tutor.id;
  return (
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back
        kicker="Availability"
        title={own ? 'Availability and time off' : `${tutor.fullName.split(' ')[0]}’s availability`}
        sub="Families can request lessons within these times, in 30-minute steps, whenever you are free."
      />
      <WeeklyEditor key={`${tutor.id}-${mine.length}`} tutor={tutor} initial={mine} />
      <TimeOff tutor={tutor} initialDate={own && params.date && DATE.test(params.date) && params.date >= toDateKey(today) ? params.date : undefined} />
    </Screen>
  );
}

function WeeklyEditor({ tutor, initial }: { tutor: Tutor; initial: Availability[] }) {
  const save = useAction(source.setAvailability);
  const toast = useToast();
  const viewing = !!useViewing();
  const [blocks, setBlocks] = useState(initial.map((b) => ({ weekday: b.weekday, start: b.start, end: b.end })));
  const [saved, setSaved] = useState(false);
  const invalid = blocks.some((b) => !TIME.test(b.start) || !TIME.test(b.end) || b.end <= b.start);
  const update = (i: number, patch: Partial<(typeof blocks)[number]>) => {
    setSaved(false);
    setBlocks((x) => x.map((b, j) => (i === j ? { ...b, ...patch } : b)));
  };

  return (
    <>
      <FieldsCard title="Weekly availability">
        {DAYS.map((day, weekday) => {
          const rows = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.weekday === weekday);
          return (
            <View key={day} style={{ gap: 10 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ gap: 2 }}>
                  <Txt variant="label">{day}</Txt>
                  {rows.length === 0 ? <Txt variant="note">Not available</Txt> : null}
                </View>
                {!viewing ? (
                  <Button
                    title="Add time"
                    icon="add"
                    size="sm"
                    variant="secondary"
                    accessibilityLabel={`Add time on ${day}`}
                    onPress={() => {
                      setSaved(false);
                      setBlocks((x) => [...x, { weekday, start: '15:00', end: '19:00' }]);
                    }}
                  />
                ) : null}
              </Row>
              {rows.map(({ b, i }) => (
                <Row key={i} gap={10} style={{ alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}>
                    <Field label="From" accessibilityLabel={`${day} from`} value={b.start} onChangeText={(t) => update(i, { start: t })} placeholder="15:00" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="To" accessibilityLabel={`${day} to`} value={b.end} onChangeText={(t) => update(i, { end: t })} placeholder="19:00" />
                  </View>
                  {!viewing ? (
                    <Button title="Remove" size="sm" variant="secondary" accessibilityLabel={`Remove ${day} ${b.start} to ${b.end}`} onPress={() => setBlocks((x) => x.filter((_, j) => j !== i))} />
                  ) : null}
                </Row>
              ))}
            </View>
          );
        })}
      </FieldsCard>
      {invalid ? <Notice tone="danger">Use 24-hour times like 15:30, and make each block end after it starts.</Notice> : null}
      {saved ? <Notice tone="good">Availability saved.</Notice> : null}
      <ErrorNote error={save.error} />
      {!viewing ? (
        <Actions>
          <Button
            title="Save availability"
            icon="check"
            disabled={invalid}
            loading={save.isPending}
            onPress={async () => {
              await save.mutateAsync([tutor.id, blocks]);
              setSaved(true);
              toast('Availability saved');
            }}
          />
        </Actions>
      ) : null}
    </>
  );
}

/** `initialDate` comes from a lesson's "I can’t make it": the form opens with that day filled in. */
function TimeOff({ tutor, initialDate }: { tutor: Tutor; initialDate?: string }) {
  const me = useMe();
  const absences = useAbsences();
  const lookup = useLookup();
  const lessons = useLessons(today, addDays(today, 120));
  const saveAbsence = useAction(source.saveAbsence);
  const remove = useAction(source.deleteAbsence);
  const [start, setStart] = useState(initialDate ?? '');
  const [end, setEnd] = useState(initialDate ?? '');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [asked, setAsked] = useState(!!initialDate);
  const toast = useToast();
  const viewing = !!useViewing();
  const mine = (absences.data ?? []).filter((a) => a.tutorId === tutor.id && a.endDate >= toDateKey(today));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end || start) && (end || start) >= start;

  return (
    <>
      <Group title="Time off" note={mine.length ? undefined : 'No time off booked.'}>
        {mine.map((a) => {
          const affected = lessonsDuringAbsence(a, lessons.data ?? []);
          return (
            <GroupRow
              key={a.id}
              icon="beach_access"
              title={`${formatDate(a.startDate)}${a.endDate !== a.startDate ? ` to ${formatDate(a.endDate)}` : ''}`}
              note={[
                a.reason || 'Time off',
                affected.length
                  ? `${affected.length} lesson${affected.length === 1 ? '' : 's'} booked then${me.role === 'admin' ? ': tap one below to find cover.' : '. Elite Education will arrange cover.'}`
                  : 'No lessons booked then',
              ].join(' · ')}
              action={!viewing ? { label: 'Remove', onPress: () => remove.mutate([a.id]) } : undefined}>
              {me.role === 'admin' && affected.length ? (
                <Row gap={8} wrap style={{ marginTop: 6 }}>
                  {affected.map((l) => (
                    <Chip
                      key={l.id}
                      label={`${formatDay(l.start)} ${formatTime(l.start)} · ${lookup.studentNames(l.studentIds)}`}
                      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
                    />
                  ))}
                </Row>
              ) : null}
            </GroupRow>
          );
        })}
      </Group>
      {!viewing ? (
        <>
          {asked && initialDate ? (
            <Notice tone="info" icon="event_busy" title="Can’t make a lesson?">
              Tell the office you can’t make it. The office will arrange cover and contact the family. Time off covers the whole day, so every lesson you have on{' '}
              {formatDate(initialDate)} will need cover.
            </Notice>
          ) : null}
          <FieldsCard title="Add time off">
            <DateKeyField label="First day" value={start} onChange={setStart} />
            <DateKeyField label="Last day (optional)" value={end} onChange={setEnd} />
            <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. Holiday or a conference" />
            {tried && !valid ? <Notice tone="danger">Please enter the first day as a date, for example 2026-10-26, and an end date on or after it.</Notice> : null}
          </FieldsCard>
          <ErrorNote error={saveAbsence.error ?? remove.error} />
          <Actions>
            <Button
              title="Add time off"
              icon="add"
              variant="secondary"
              loading={saveAbsence.isPending}
              onPress={async () => {
                setTried(true);
                if (!valid) return;
                const draft = { tutorId: tutor.id, startDate: start, endDate: end || start, reason: reason.trim() || undefined };
                const clash = lessonsDuringAbsence({ id: 'new', ...draft }, lessons.data ?? []).length;
                await saveAbsence.mutateAsync([draft]);
                setStart('');
                setEnd('');
                setReason('');
                setTried(false);
                setAsked(false);
                toast(clash ? `Time off added. Elite Education will arrange cover for ${clash} lesson${clash === 1 ? '' : 's'}.` : 'Time off added.');
              }}
            />
          </Actions>
        </>
      ) : null}
    </>
  );
}
