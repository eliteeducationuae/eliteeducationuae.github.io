import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useLessons, useLookup, useTutors } from '@/data/hooks';
import { addDays, formatDay, formatMonth, isSameDay, startOfDay, startOfWeek } from '@/domain/dates';
import { byStart } from '@/domain/scheduling';

import { DayTimeline, LessonCard, WeekStrip } from './lessons';
import { Button, Chip, EmptyState, Loading, Row, Screen, Segmented, Txt } from './ui';

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

  const all = (lessons.data ?? []).filter((l) => !tutorFilter || l.tutorId === tutorFilter).sort(byStart);
  const counts = new Map<string, number>();
  for (const l of all) {
    if (l.status === 'cancelled') continue;
    const key = startOfDay(new Date(l.start)).toDateString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dayLessons = all.filter((l) => isSameDay(new Date(l.start), selected));
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

      {lessons.isLoading || !lookup.ready ? (
        <Loading />
      ) : view === 'timeline' ? (
        <DayTimeline day={selected} lessons={dayLessons} lookup={lookup} tutorIds={tutorIds} />
      ) : view === 'day' ? (
        <View style={{ gap: Spacing.two }}>
          <Txt variant="label">{formatDay(selected)}</Txt>
          {dayLessons.length ? (
            dayLessons.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective={perspective} />)
          ) : (
            <EmptyState icon="calendar" title="Nothing scheduled" />
          )}
        </View>
      ) : (
        <View style={{ gap: Spacing.three }}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
            const items = all.filter((l) => isSameDay(new Date(l.start), d));
            if (!items.length) return null;
            return (
              <View key={d.toDateString()} style={{ gap: Spacing.two }}>
                <Txt variant="label">{formatDay(d)}</Txt>
                {items.map((l) => (
                  <LessonCard key={l.id} lesson={l} lookup={lookup} perspective={perspective} />
                ))}
              </View>
            );
          })}
          {all.length === 0 ? <EmptyState icon="calendar" title="Nothing scheduled this week" /> : null}
        </View>
      )}
    </Screen>
  );
}
