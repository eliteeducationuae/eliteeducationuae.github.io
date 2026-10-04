import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing, elevation, font } from '@/constants/theme';
import { useEnrolments, type Lookup } from '@/data/hooks';
import { addDays, formatTime, isSameDay, minutesBetween, startOfDay, weekdayShort } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import type { Lesson, LessonStatus } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Badge, Card, Row, Txt, type Tone } from './ui';

export const LESSON_STATUS: Record<LessonStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
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

/** The lesson's subject when it is known: its own, or the student's only subject. */
export function useLessonSubject(lesson: Pick<Lesson, 'subject' | 'studentIds'>): string | undefined {
  const enrolments = useEnrolments();
  return lessonSubject(lesson, enrolments.data ?? []);
}

/** 'Layla · Chemistry', or just the names when the subject is not known. */
export function withSubject(names: string, subject?: string): string {
  return subject ? `${names} · ${subject}` : names;
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
  const subject = useLessonSubject(lesson);
  const students = lookup.studentNames(lesson.studentIds);
  const title = perspective === 'family' ? (subject ?? service?.name ?? 'Lesson') : withSubject(students, subject);
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
        <View style={{ width: 60 }}>
          {showDate ? (
            <Text style={[styles.cardDay, font('sans', 'bold'), { color: theme.accent }]}>
              {weekdayShort(start)} {start.getDate()}
            </Text>
          ) : null}
          <Text style={[styles.cardTime, font('serif'), { color: theme.text }]}>{formatTime(lesson.start)}</Text>
          <Txt variant="small">to {formatTime(lesson.end)}</Txt>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={[styles.cardTitle, font('sans', 'bold'), { color: theme.text }, inactive && { textDecorationLine: 'line-through' }]}>
            {title}
          </Text>
          <Txt variant="muted" numberOfLines={2}>
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
/** Snap a vertical drag distance to 15-minute steps. */
export function dragToMinutes(dy: number): number {
  return Math.round(((dy / HOUR_HEIGHT) * 60) / 15) * 15;
}

/**
 * A lesson on the timeline. Tap to open; when `onMove` is given, press and hold, then drag up or
 * down to move it in 15-minute steps.
 */
function TimelineBlock({
  lesson: l,
  lookup,
  top,
  height,
  onMove,
}: {
  lesson: Lesson;
  lookup: Lookup;
  top: number;
  height: number;
  onMove?: (lesson: Lesson, deltaMin: number) => void;
}) {
  const theme = useTheme();
  const subject = useLessonSubject(l);
  const [armed, setArmed] = useState(false);
  const [dy, setDy] = useState(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => armed,
        onMoveShouldSetPanResponderCapture: () => armed,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => setDy(g.dy),
        onPanResponderRelease: (_, g) => {
          const minutes = dragToMinutes(g.dy);
          setDy(0);
          setArmed(false);
          if (minutes !== 0) onMove?.(l, minutes);
        },
        onPanResponderTerminate: () => {
          setDy(0);
          setArmed(false);
        },
      }),
    [armed, l, onMove],
  );
  const color = lookup.tutor(l.tutorId)?.color ?? theme.accent;
  const inactive = l.status === 'cancelled' || l.status === 'late-cancel';
  const label = withSubject(lookup.studentNames(l.studentIds), subject);
  const preview = dragToMinutes(dy);
  const shownStart = new Date(new Date(l.start).getTime() + preview * 60_000);
  const shownEnd = new Date(new Date(l.end).getTime() + preview * 60_000);
  return (
    <View
      {...(onMove ? responder.panHandlers : {})}
      style={[
        styles.block,
        // Solid tutor colour so the ivory text keeps WCAG AA on any background; cancelled lessons fade.
        { top: top + dy, height, zIndex: armed ? 10 : 1, backgroundColor: inactive ? color + '33' : color, borderColor: color },
        armed && [styles.lifted, elevation(theme, 2)],
      ]}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => (armed ? setArmed(false) : router.push({ pathname: '/lesson/[id]', params: { id: l.id } }))}
        onLongPress={onMove ? () => setArmed(true) : undefined}
        delayLongPress={300}
        accessibilityLabel={`${label} at ${formatTime(l.start)}${onMove ? '. Press and hold, then drag to move.' : ''}`}>
        <Txt variant="small" numberOfLines={1} style={[font('sans', 'bold'), { color: inactive ? theme.text : theme.onHero }]}>
          {label}
        </Txt>
        <Txt variant="small" numberOfLines={1} style={{ color: inactive ? theme.textMuted : theme.onHero, opacity: inactive ? 1 : 0.9 }}>
          {formatTime(shownStart)}–{formatTime(shownEnd)}
          {armed && !dy ? '  · drag to move' : ''}
        </Txt>
      </Pressable>
    </View>
  );
}

export interface TimelineBusy {
  id: string;
  tutorId: string;
  start: string;
  end: string;
}

export function DayTimeline({
  day,
  lessons,
  lookup,
  tutorIds,
  onMove,
  busy = [],
}: {
  day: Date;
  lessons: Lesson[];
  lookup: Lookup;
  tutorIds: string[];
  /** Enables drag-to-reschedule. */
  onMove?: (lesson: Lesson, deltaMin: number) => void;
  /** Times a tutor is busy in Google Calendar, shown as quiet bands behind the lessons. */
  busy?: TimelineBusy[];
}) {
  const theme = useTheme();
  const dayStart = startOfDay(day);
  const active = lessons.filter((l) => isSameDay(new Date(l.start), day));
  const busyToday = busy.filter((b) => isSameDay(new Date(b.start), day));
  const spans = [...active, ...busyToday];
  // Show the working part of the day: an hour before the first lesson (or busy time) to an hour after the last.
  const first = spans.length ? Math.max(6, Math.min(...spans.map((l) => new Date(l.start).getHours())) - 1) : 14;
  const last = spans.length ? Math.min(24, Math.max(...spans.map((l) => new Date(l.end).getHours() + 1)) + 1) : 20;
  const range = Array.from({ length: last - first }, (_, i) => first + i);

  return (
    <View style={[styles.timeline, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Row gap={0} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
        <View style={{ width: 48 }} />
        {tutorIds.map((id) => (
          <View key={id} style={{ flex: 1, padding: Spacing.two, gap: Spacing.one }}>
            <Txt variant="small" numberOfLines={1} style={[font('sans', 'bold'), { color: theme.text }]}>
              {lookup.tutor(id)?.fullName.split(' ')[0]}
            </Txt>
            {/* The tutor's colour is decorative only: a short rule under the name, never the text itself. */}
            <View style={{ width: 24, height: 3, borderRadius: 2, backgroundColor: lookup.tutor(id)?.color ?? theme.gold }} />
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
            {busyToday
              .filter((b) => b.tutorId === tutorId)
              .map((b) => {
                const top = Math.max(0, (minutesBetween(dayStart, new Date(b.start)) / 60 - first) * HOUR_HEIGHT);
                const height = Math.max(20, (minutesBetween(new Date(b.start), new Date(b.end)) / 60) * HOUR_HEIGHT - 2);
                return (
                  <View
                    key={b.id}
                    pointerEvents="none"
                    accessibilityLabel={`Busy in Google Calendar, ${formatTime(b.start)} to ${formatTime(b.end)}`}
                    style={[styles.busy, { top, height, backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
                    <Txt variant="small" numberOfLines={2}>
                      Busy · {formatTime(b.start)}–{formatTime(b.end)}
                    </Txt>
                  </View>
                );
              })}
            {active
              .filter((l) => l.tutorId === tutorId)
              .map((l) => {
                const top = (minutesBetween(dayStart, new Date(l.start)) / 60 - first) * HOUR_HEIGHT;
                const height = Math.max(28, (minutesBetween(new Date(l.start), new Date(l.end)) / 60) * HOUR_HEIGHT - 2);
                const movable = !!onMove && l.status === 'scheduled' && new Date(l.start) > new Date();
                return (
                  <TimelineBlock key={l.id} lesson={l} lookup={lookup} top={top} height={height} onMove={movable ? onMove : undefined} />
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
  block: { position: 'absolute', left: 3, right: 3, borderRadius: 6, borderLeftWidth: 3, padding: 4, overflow: 'hidden', userSelect: 'none' },
  busy: {
    position: 'absolute',
    left: 3,
    right: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  lifted: { transform: [{ scale: 1.03 }] },
  cardDay: { fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' },
  cardTime: { fontSize: 18, lineHeight: 24, fontVariant: ['tabular-nums'] },
  cardTitle: { fontSize: 16, lineHeight: 22 },
});
