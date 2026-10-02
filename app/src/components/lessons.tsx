import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { Lookup } from '@/data/hooks';
import { addDays, formatTime, isSameDay, minutesBetween, startOfDay, weekdayShort } from '@/domain/dates';
import type { Lesson, LessonStatus } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Badge, Card, Row, Txt, type Tone } from './ui';

export const LESSON_STATUS: Record<LessonStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  'late-cancel': { label: 'Late cancel', tone: 'warning' },
  'no-show': { label: 'No-show', tone: 'danger' },
};

export function LessonStatusBadge({ lesson, now = new Date() }: { lesson: Lesson; now?: Date }) {
  if (lesson.status === 'scheduled' && new Date(lesson.end) < now) return <Badge label="Needs notes" tone="warning" />;
  const s = LESSON_STATUS[lesson.status];
  return <Badge label={s.label} tone={s.tone} />;
}

/** A lesson in a list. `perspective` decides whose name leads. */
export function LessonCard({
  lesson,
  lookup,
  perspective = 'admin',
  showDate,
}: {
  lesson: Lesson;
  lookup: Lookup;
  perspective?: 'admin' | 'tutor' | 'family';
  showDate?: boolean;
}) {
  const theme = useTheme();
  const tutor = lookup.tutor(lesson.tutorId);
  const service = lookup.service(lesson.serviceId);
  const students = lookup.studentNames(lesson.studentIds);
  const title = perspective === 'family' ? (service?.name ?? 'Lesson') : students;
  const subtitle =
    perspective === 'family'
      ? `${students} · with ${tutor?.fullName ?? 'tutor'}`
      : perspective === 'tutor'
        ? (service?.name ?? '')
        : `${service?.name ?? ''} · ${tutor?.fullName ?? ''}`;
  const inactive = lesson.status === 'cancelled' || lesson.status === 'late-cancel';
  const start = new Date(lesson.start);
  return (
    <Card
      accent={tutor?.color ?? theme.accent}
      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } })}
      accessibilityLabel={`${title}, ${formatTime(lesson.start)}`}
      style={inactive && { opacity: 0.6 }}>
      <Row gap={Spacing.three} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 56 }}>
          {showDate ? (
            <Txt variant="small" style={{ fontWeight: '700' }}>
              {weekdayShort(start)} {start.getDate()}
            </Txt>
          ) : null}
          <Txt variant="h3" style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(lesson.start)}
          </Txt>
          <Txt variant="small">{formatTime(lesson.end)}</Txt>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3" numberOfLines={1} style={inactive && { textDecorationLine: 'line-through' }}>
            {title}
          </Txt>
          <Txt variant="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
          <Row gap={Spacing.one} style={{ marginTop: 4 }}>
            <Icon name={lesson.location === 'online' ? 'video' : 'pin'} size={14} color={theme.textMuted} />
            <Txt variant="small">{lesson.location === 'online' ? 'Online' : 'In person'}</Txt>
            {lesson.seriesId ? (
              <>
                <Txt variant="small"> · </Txt>
                <Icon name="repeat" size={14} color={theme.textMuted} />
                <Txt variant="small">Weekly</Txt>
              </>
            ) : null}
          </Row>
        </View>
        <LessonStatusBadge lesson={lesson} />
      </Row>
    </Card>
  );
}

/** Horizontal Mon–Sun selector with lesson-count dots. */
export function WeekStrip({
  weekStart,
  selected,
  onSelect,
  onShiftWeek,
  counts,
}: {
  weekStart: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  onShiftWeek: (delta: number) => void;
  counts: Map<string, number>;
}) {
  const theme = useTheme();
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <Row gap={Spacing.one}>
      <Pressable onPress={() => onShiftWeek(-1)} accessibilityLabel="Previous week" style={styles.arrow}>
        <Icon name="back" size={18} color={theme.textMuted} />
      </Pressable>
      {days.map((d) => {
        const active = isSameDay(d, selected);
        const isToday = isSameDay(d, today);
        const count = counts.get(startOfDay(d).toDateString()) ?? 0;
        return (
          <Pressable
            key={d.toDateString()}
            onPress={() => onSelect(d)}
            accessibilityRole="button"
            accessibilityLabel={`${weekdayShort(d)} ${d.getDate()}, ${count} lessons`}
            accessibilityState={{ selected: active }}
            style={[
              styles.day,
              { backgroundColor: active ? theme.primary : theme.surface, borderColor: isToday ? theme.gold : theme.border },
            ]}>
            <Txt variant="small" style={{ color: active ? theme.onPrimary : theme.textMuted }}>
              {weekdayShort(d)}
            </Txt>
            <Txt variant="h3" style={{ color: active ? theme.onPrimary : theme.text }}>
              {d.getDate()}
            </Txt>
            <View style={[styles.dot, { backgroundColor: count ? (active ? theme.gold : theme.accent) : 'transparent' }]} />
          </Pressable>
        );
      })}
      <Pressable onPress={() => onShiftWeek(1)} accessibilityLabel="Next week" style={styles.arrow}>
        <Icon name="forward" size={18} color={theme.textMuted} />
      </Pressable>
    </Row>
  );
}

const HOUR_HEIGHT = 56;

/** Day timeline with one column per tutor — the at-a-glance view of who is teaching when. */
export function DayTimeline({
  day,
  lessons,
  lookup,
  tutorIds,
}: {
  day: Date;
  lessons: Lesson[];
  lookup: Lookup;
  tutorIds: string[];
}) {
  const theme = useTheme();
  const dayStart = startOfDay(day);
  const active = lessons.filter((l) => isSameDay(new Date(l.start), day));
  // Show the working part of the day: an hour before the first lesson to an hour after the last.
  const first = active.length ? Math.max(6, Math.min(...active.map((l) => new Date(l.start).getHours())) - 1) : 14;
  const last = active.length ? Math.min(24, Math.max(...active.map((l) => new Date(l.end).getHours() + 1)) + 1) : 20;
  const range = Array.from({ length: last - first }, (_, i) => first + i);

  return (
    <View style={[styles.timeline, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Row gap={0} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
        <View style={{ width: 48 }} />
        {tutorIds.map((id) => (
          <View key={id} style={{ flex: 1, padding: Spacing.two }}>
            <Txt variant="small" numberOfLines={1} style={{ fontWeight: '700', color: lookup.tutor(id)?.color }}>
              {lookup.tutor(id)?.fullName.split(' ')[0]}
            </Txt>
          </View>
        ))}
      </Row>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 48 }}>
          {range.map((h) => (
            <View key={h} style={{ height: HOUR_HEIGHT, paddingRight: 6, alignItems: 'flex-end' }}>
              <Txt variant="small">{String(h).padStart(2, '0')}:00</Txt>
            </View>
          ))}
        </View>
        {tutorIds.map((tutorId) => (
          <View key={tutorId} style={{ flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
            {range.map((h) => (
              <View key={h} style={{ height: HOUR_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }} />
            ))}
            {active
              .filter((l) => l.tutorId === tutorId)
              .map((l) => {
                const top = (minutesBetween(dayStart, new Date(l.start)) / 60 - first) * HOUR_HEIGHT;
                const height = Math.max(28, (minutesBetween(new Date(l.start), new Date(l.end)) / 60) * HOUR_HEIGHT - 2);
                const color = lookup.tutor(l.tutorId)?.color ?? theme.accent;
                const inactive = l.status === 'cancelled' || l.status === 'late-cancel';
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
                    accessibilityLabel={`${lookup.studentNames(l.studentIds)} at ${formatTime(l.start)}`}
                    style={[
                      styles.block,
                      { top, height, backgroundColor: color + (inactive ? '33' : 'dd'), borderColor: color },
                    ]}>
                    <Txt variant="small" numberOfLines={1} style={{ color: inactive ? theme.text : '#fff', fontWeight: '700' }}>
                      {lookup.studentNames(l.studentIds)}
                    </Txt>
                    <Txt variant="small" numberOfLines={1} style={{ color: inactive ? theme.textMuted : '#ffffffcc' }}>
                      {formatTime(l.start)}–{formatTime(l.end)}
                    </Txt>
                  </Pressable>
                );
              })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: { padding: 6, minHeight: 44, justifyContent: 'center' },
  day: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 60,
    gap: 1,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  timeline: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  block: { position: 'absolute', left: 3, right: 3, borderRadius: 6, borderLeftWidth: 3, padding: 4, overflow: 'hidden' },
});
