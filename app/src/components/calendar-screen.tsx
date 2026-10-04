import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useBusyBlocks, useClosures, useLessons, useLookup, useTutors } from '@/data/hooks';
import { addDays, formatDay, formatMonth, formatTime, isSameDay, startOfDay, startOfWeek } from '@/domain/dates';
import { byStart, findBusyClashes, findClashes, isClosed } from '@/domain/scheduling';
import type { BusyBlock, Lesson } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';

import { Icon } from './icon';
import { DayTimeline, LessonCard, WeekStrip } from './lessons';
import { Banner, Button, Chip, EmptyState, ErrorNote, Loading, Row, Screen, Segmented, Txt } from './ui';

/** A quiet line for a time the tutor is busy in Google Calendar (times only, never the event itself). */
function BusyLine({ block, tutorName }: { block: BusyBlock; tutorName?: string }) {
  const theme = useTheme();
  return (
    <Row gap={Spacing.one} style={{ alignItems: 'center' }}>
      <Icon name="calendar" size={14} color={theme.textMuted} />
      <Txt variant="small" style={{ flex: 1 }}>
        {formatTime(block.start)}–{formatTime(block.end)} · Busy in Google Calendar{tutorName ? ` · ${tutorName}` : ''}
      </Txt>
    </Row>
  );
}

/**
 * Week strip + day agenda / tutor timeline / week list. Used by admins (all tutors, can schedule)
 * and tutors (their own lessons only — the data source already filters).
 */
export function CalendarScreen({ canSchedule, perspective }: { canSchedule: boolean; perspective: 'admin' | 'tutor' }) {
  const lookup = useLookup();
  const tutors = useTutors();
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<'day' | 'timeline' | 'week'>('day');
  const [tutorFilter, setTutorFilter] = useState<string | null>(null);
  const weekStart = startOfWeek(selected);
  const lessons = useLessons(weekStart, addDays(weekStart, 7));
  const closures = useClosures();
  // Google Calendar: busy times only warn here; they never stop the office moving a lesson.
  const busyBlocks = useBusyBlocks(weekStart, addDays(weekStart, 7));
  const move = useAction(source.rescheduleLesson);
  const closed = (closures.data ?? []).find((c) => isClosed(selected, [c]));

  /** Drag-to-reschedule on the tutor timeline (admins only). */
  function moveLesson(lesson: Lesson, deltaMin: number) {
    const start = new Date(new Date(lesson.start).getTime() + deltaMin * 60_000);
    const end = new Date(new Date(lesson.end).getTime() + deltaMin * 60_000);
    const clashes = findClashes({ start, end, tutorId: lesson.tutorId, studentIds: lesson.studentIds, ignoreLessonId: lesson.id }, lessons.data ?? []);
    const busy = findBusyClashes({ start, end, tutorId: lesson.tutorId }, busyBlocks.data ?? []);
    confirm(
      `Move ${lookup.studentNames(lesson.studentIds)}’s lesson?`,
      `${formatTime(lesson.start)} → ${formatTime(start)}–${formatTime(end)}${clashes.length ? '\n\nPlease note that this clashes with another lesson.' : ''}${
        busy.length ? '\n\nPlease note that Google Calendar shows the tutor as busy at this time.' : ''
      }`,
      () => move.mutate([lesson.id, start.toISOString(), end.toISOString()]),
      'Move',
    );
  }

  const all = (lessons.data ?? []).filter((l) => !tutorFilter || l.tutorId === tutorFilter).sort(byStart);
  const counts = new Map<string, number>();
  for (const l of all) {
    if (l.status === 'cancelled') continue;
    const key = startOfDay(new Date(l.start)).toDateString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dayLessons = all.filter((l) => isSameDay(new Date(l.start), selected));
  const weekBusy = (busyBlocks.data ?? []).filter((b) => !tutorFilter || b.tutorId === tutorFilter);
  const dayBusy = weekBusy.filter((b) => isSameDay(new Date(b.start), selected));
  const tutorIds =
    perspective === 'tutor'
      ? [...new Set(all.map((l) => l.tutorId))]
      : (tutors.data ?? []).map((t) => t.id).filter((id) => !tutorFilter || id === tutorFilter);

  return (
    <Screen
      onRefresh={() => lessons.refetch()}
      refreshing={lessons.isRefetching}
      footer={
        canSchedule ? (
          <Button
            title="Schedule lessons"
            icon="plus"
            variant="gold"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/lesson/new', params: { date: selected.toISOString() } })}
          />
        ) : undefined
      }>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h2">{formatMonth(selected)}</Txt>
        <Button title="Today" size="sm" variant="secondary" onPress={() => setSelected(startOfDay(new Date()))} />
      </Row>
      <WeekStrip
        weekStart={weekStart}
        selected={selected}
        onSelect={setSelected}
        onShiftWeek={(d) => setSelected(addDays(selected, d * 7))}
        counts={counts}
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'timeline', label: perspective === 'admin' ? 'Tutors' : 'Timeline' },
          { value: 'week', label: 'Week' },
        ]}
      />
      {perspective === 'admin' && tutors.data ? (
        <Row gap={Spacing.one} wrap>
          <Chip label="All tutors" selected={!tutorFilter} onPress={() => setTutorFilter(null)} />
          {tutors.data.map((t) => (
            <Chip key={t.id} label={t.fullName.split(' ')[0]} selected={tutorFilter === t.id} onPress={() => setTutorFilter(t.id)} />
          ))}
        </Row>
      ) : null}

      {closed ? (
        <Banner icon="sun">
          {closed.name}: no new lessons are scheduled on these dates.
        </Banner>
      ) : null}
      <ErrorNote error={move.error} />
      {lessons.isLoading || !lookup.ready ? (
        <Loading />
      ) : view === 'timeline' ? (
        <View style={{ gap: Spacing.two }}>
          {canSchedule ? <Txt variant="small">Tip: press and hold a lesson, then drag to move it.</Txt> : null}
          <DayTimeline
            day={selected}
            lessons={dayLessons}
            lookup={lookup}
            tutorIds={tutorIds}
            busy={dayBusy}
            onMove={canSchedule ? moveLesson : undefined}
          />
        </View>
      ) : view === 'day' ? (
        <View style={{ gap: Spacing.two }}>
          <Txt variant="label">{formatDay(selected)}</Txt>
          {dayBusy.map((b) => (
            <BusyLine key={b.id} block={b} tutorName={perspective === 'admin' ? lookup.tutor(b.tutorId)?.fullName ?? 'Tutor' : undefined} />
          ))}
          {dayLessons.length ? (
            dayLessons.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective={perspective} />)
          ) : (
            <EmptyState icon="calendar" title="No lessons scheduled on this day" message="Lessons will appear here as soon as they are booked." />
          )}
        </View>
      ) : (
        <View style={{ gap: Spacing.three }}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
            const items = all.filter((l) => isSameDay(new Date(l.start), d));
            const busy = weekBusy.filter((b) => isSameDay(new Date(b.start), d));
            if (!items.length && !busy.length) return null;
            return (
              <View key={d.toDateString()} style={{ gap: Spacing.two }}>
                <Txt variant="label">{formatDay(d)}</Txt>
                {busy.map((b) => (
                  <BusyLine key={b.id} block={b} tutorName={perspective === 'admin' ? lookup.tutor(b.tutorId)?.fullName ?? 'Tutor' : undefined} />
                ))}
                {items.map((l) => (
                  <LessonCard key={l.id} lesson={l} lookup={lookup} perspective={perspective} />
                ))}
              </View>
            );
          })}
          {all.length === 0 ? <EmptyState icon="calendar" title="No lessons scheduled this week" message="Lessons will appear here as soon as they are booked." /> : null}
        </View>
      )}
    </Screen>
  );
}
