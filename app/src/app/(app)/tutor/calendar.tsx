import { router } from 'expo-router';
import { useState } from 'react';

import { HeaderActions } from '@/components/role-tabs';
import { LessonRow, longDay, monthName, studentFirstNames, useMyLessons } from '@/components/tutor/common';
import { Actions, Button, Columns, Group, GroupRow, Loading, PageHeader, Screen, Tabs } from '@/components/ui';
import { useCalendarConnection, useEnrolments, useLookup } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { addDays, formatDay, formatTime, isSameDay, startOfDay, startOfWeek } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import type { Lesson } from '@/domain/types';

const NEXT = 'next';

/** e.g. `12 to 18 October` or `28 September to 4 October`. */
function weekRange(start: Date): string {
  const end = addDays(start, 6);
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()} to ${end.getDate()} ${monthName(end)}`
    : `${start.getDate()} ${monthName(start)} to ${end.getDate()} ${monthName(end)}`;
}

/** The tutor's week: a tab per day (Monday to Sunday) and next week. The full day and week views are one tap away. */
export default function TutorCalendar() {
  const viewing = !!useViewing();
  const lookup = useLookup();
  const enrolments = useEnrolments();
  const connection = useCalendarConnection();
  const now = new Date();
  const weekStart = startOfWeek(now);
  const nextStart = addDays(weekStart, 7);
  const [tab, setTab] = useState<string>(() => String((now.getDay() + 6) % 7));
  const lessons = useMyLessons(weekStart, addDays(weekStart, 14));

  if (lessons.isLoading || !lookup.ready) return <Loading />;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const on = (d: Date) => lessons.mine.filter((l) => isSameDay(new Date(l.start), d));
  const nextWeek = lessons.mine.filter((l) => new Date(l.start) >= nextStart && new Date(l.start) < addDays(nextStart, 7) && l.status === 'scheduled');
  const synced = !!connection.data && connection.data.status !== 'error';

  const nextRow = (l: Lesson) => {
    const subject = lessonSubject(l, enrolments.data ?? []);
    return (
      <GroupRow
        key={l.id}
        icon="event"
        title={`${formatDay(l.start)} · ${formatTime(l.start)}`}
        note={[studentFirstNames(l, lookup), subject].filter(Boolean).join(' · ')}
        onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
      />
    );
  };

  const selected = tab === NEXT ? null : days[Number(tab)];
  const dayLessons = selected ? on(selected) : [];

  return (
    <Screen topInset onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <PageHeader
        kicker="Calendar"
        title={tab === NEXT ? 'Next week' : 'This week'}
        sub={`${weekRange(tab === NEXT ? nextStart : weekStart)}.${synced ? ' Lessons sync to your Google Calendar.' : ''}`}
        right={<HeaderActions search />}
      />
      <Tabs
        accessibilityLabel="Days"
        value={tab}
        onChange={setTab}
        tabs={[
          ...days.map((d, i) => ({ value: String(i), label: `${formatDay(d).split(' ')[0]} ${d.getDate()}` })),
          { value: NEXT, label: 'Next week' },
        ]}
      />
      {selected ? (
        <Columns>
          <Group
            title={longDay(selected)}
            meta={isSameDay(selected, startOfDay(now)) ? 'Today' : undefined}
            note={dayLessons.length ? undefined : 'No lessons booked. Families can request lessons within your availability.'}>
            {dayLessons.map((l) => (
              <LessonRow key={l.id} lesson={l} now={now} />
            ))}
          </Group>
          <Group title="Next week" note={nextWeek.length ? undefined : 'Nothing booked for next week yet.'}>
            {nextWeek.slice(0, 6).map(nextRow)}
          </Group>
        </Columns>
      ) : (
        <Group note={nextWeek.length ? undefined : 'Nothing booked for next week yet.'}>{nextWeek.map(nextRow)}</Group>
      )}
      <Actions>
        <Button title="Day and week views" icon="calendar_month" variant="secondary" onPress={() => router.push('/calendar-views')} />
        <Button title="Availability and time off" icon="schedule" variant="secondary" onPress={() => router.push('/availability')} />
        {!viewing ? <Button title="Set homework" icon="assignment" variant="secondary" onPress={() => router.push('/homework/new')} /> : null}
      </Actions>
    </Screen>
  );
}
