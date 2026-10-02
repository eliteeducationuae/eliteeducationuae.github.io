import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useClosures, useLessons, useLookup, useServices, useStudents, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { addDays, formatDay, formatTime, fromDateAndTime, startOfDay, toDateKey } from '@/domain/dates';
import { expandWeeklySkipping, findClashes } from '@/domain/scheduling';
import type { LessonLocation } from '@/domain/types';
import { uuid } from '@/lib/id';

type Repeat = 'once' | 'weekly' | 'fortnightly';

export default function NewLesson() {
  const params = useLocalSearchParams<{ date?: string; studentId?: string }>();
  const lookup = useLookup();
  const students = useStudents();
  const tutors = useTutors();
  const services = useServices();
  const create = useAction(source.createLessons);

  const initial = params.date ? new Date(params.date) : new Date();
  const [studentIds, setStudentIds] = useState<string[]>(params.studentId ? [params.studentId] : []);
  const [tutorId, setTutorId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState(toDateKey(initial));
  const [time, setTime] = useState('16:00');
  const [location, setLocation] = useState<LessonLocation>('online');
  const [where, setWhere] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('weekly');
  const [count, setCount] = useState('10');
  const [query, setQuery] = useState('');

  const service = serviceId ? lookup.service(serviceId) : undefined;
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
  const clashes = tutorId
    ? slots.flatMap((slot) => findClashes({ ...slot, tutorId, studentIds }, existing.data ?? []).map((c) => ({ slot, c })))
    : [];

  const ready = studentIds.length > 0 && tutorId && service && start;
  const toggleStudent = (id: string) => setStudentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function submit() {
    if (!ready) return;
    const seriesId = n > 1 ? uuid() : undefined;
    await create.mutateAsync([
      slots.map((s) => ({
        tutorId: tutorId!,
        studentIds,
        serviceId: service!.id,
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        location,
        meetingUrl: location === 'online' ? where.trim() || undefined : undefined,
        address: location === 'in-person' ? where.trim() || undefined : undefined,
        seriesId,
      })),
    ]);
    router.back();
  }

  if (!lookup.ready) return <Loading />;
  const q = query.trim().toLowerCase();
  const studentList = (students.data ?? []).filter((s) => studentIds.includes(s.id) || !q || s.fullName.toLowerCase().includes(q));

  return (
    <Screen
      footer={
        <Button
          title={clashes.length ? `Schedule ${slots.length} anyway` : `Schedule ${slots.length || ''} lesson${slots.length === 1 ? '' : 's'}`}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!ready}
          loading={create.isPending}
          onPress={submit}
        />
      }>
      <Section title="Who">
        <Field label="Find student" value={query} onChangeText={setQuery} placeholder="Type a name" />
        <Row gap={Spacing.one} wrap>
          {studentList.map((s) => (
            <Chip key={s.id} label={s.fullName} selected={studentIds.includes(s.id)} onPress={() => toggleStudent(s.id)} />
          ))}
        </Row>
        {studentIds.length > 1 ? <Txt variant="small">Group lesson: each student is charged the service rate.</Txt> : null}
      </Section>

      <Section title="Tutor">
        <Row gap={Spacing.one} wrap>
          {(tutors.data ?? []).map((t) => (
            <Chip key={t.id} label={t.fullName} selected={tutorId === t.id} onPress={() => setTutorId(t.id)} />
          ))}
        </Row>
      </Section>

      <Section title="Service">
        <Row gap={Spacing.one} wrap>
          {(services.data ?? []).map((s) => (
            <Chip key={s.id} label={`${s.name} · ${s.durationMin}m · ${formatAED(s.rate)}`} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />
          ))}
        </Row>
      </Section>

      <Section title="When">
        <Row gap={Spacing.two}>
          <View style={{ flex: 1 }}>
            <Field label="First lesson date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Start time" value={time} onChangeText={setTime} placeholder="HH:MM" />
          </View>
        </Row>
        {!start ? <Banner tone="danger" icon="alert">Enter the date as YYYY-MM-DD and the time as HH:MM (24-hour).</Banner> : null}
        <Segmented
          value={repeat}
          onChange={setRepeat}
          options={[
            { value: 'once', label: 'One-off' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'fortnightly', label: 'Fortnightly' },
          ]}
        />
        {repeat !== 'once' ? <Field label="Number of lessons" value={count} onChangeText={setCount} keyboardType="number-pad" /> : null}
      </Section>

      <Section title="Where">
        <Segmented
          value={location}
          onChange={setLocation}
          options={[
            { value: 'online', label: 'Online' },
            { value: 'in-person', label: 'In person' },
          ]}
        />
        <Field
          label={location === 'online' ? 'Meeting link' : 'Address'}
          value={where}
          onChangeText={setWhere}
          placeholder={location === 'online' ? 'https://meet.google.com/…' : 'e.g. Elite Education Centre, Al Barsha'}
          autoCapitalize={location === 'online' ? 'none' : 'sentences'}
        />
      </Section>

      {slots.length > 0 ? (
        <Section title={`Preview · ${slots.length} lesson${slots.length === 1 ? '' : 's'}`}>
          {skipped.length ? (
            <Banner icon="sun">
              Skipping {skipped.map((d) => formatDay(d)).join(', ')} (holiday{skipped.length === 1 ? '' : 's'}).
            </Banner>
          ) : null}
          {clashes.length ? (
            <Banner tone="warning" icon="alert">
              {clashes.length} clash{clashes.length === 1 ? '' : 'es'} found. Check the dates below before scheduling.
            </Banner>
          ) : tutorId ? (
            <Banner tone="success" icon="check">
              No clashes with existing lessons.
            </Banner>
          ) : null}
          <View style={{ gap: 4 }}>
            {slots.slice(0, 12).map((s) => {
              const clash = clashes.find((x) => x.slot === s);
              return (
                <Txt key={s.start.toISOString()} variant="muted" color={clash ? 'warning' : undefined}>
                  {formatDay(s.start)} · {formatTime(s.start)}–{formatTime(s.end)}
                  {clash
                    ? `  ⚠ ${clash.c.reason === 'tutor' ? 'tutor busy' : `${lookup.studentNames(clash.c.studentIds)} busy`}`
                    : ''}
                </Txt>
              );
            })}
            {slots.length > 12 ? <Txt variant="small">…and {slots.length - 12} more</Txt> : null}
          </View>
        </Section>
      ) : null}
      <ErrorNote error={create.error} />
    </Screen>
  );
}
