/**
 * Lessons as the admin redesign shows them: a status in words, a ruled row (time, tutor colour, student, subject,
 * tutor, place) and Today's day ribbon (one line per tutor across the working day, with a gold "now" line).
 */
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Brand, font, tabular } from '@/constants/theme';
import type { Lookup } from '@/data/hooks';
import { formatTime, minutesBetween, startOfDay } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import type { Enrolment, Lesson } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import type { Palette } from '@/constants/theme';

import { Icon } from '../icon';
import { TimeRow } from './kit';

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

/** A lesson's state in words, as of `now`. */
export function lessonState(l: Lesson, now: Date): { label: string; color: keyof Palette } {
  switch (l.status) {
    case 'completed':
      return { label: 'Completed', color: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', color: 'textMuted' };
    case 'late-cancel':
      return { label: 'Late cancel', color: 'warning' };
    case 'no-show':
      return { label: 'No-show', color: 'danger' };
    default:
      if (new Date(l.end) <= now) return { label: 'Needs notes', color: 'warning' };
      if (new Date(l.start) <= now) return { label: 'In progress', color: 'accent' };
      return { label: 'Scheduled', color: 'textMuted' };
  }
}

const firstNames = (names: string) =>
  names
    .split(/,| and /)
    .map((n) => n.trim().split(' ')[0])
    .filter(Boolean)
    .join(' & ');

/** Where the lesson happens, in a few words. */
export function placeLabel(l: Lesson): string {
  if (l.location === 'online') return l.meetingUrl ? 'Online · link ready' : 'Online · link to follow';
  return l.address || 'In person';
}

/** One lesson as a ruled row. `full` is the Diary agenda form (end time, service, tutor's full name, place line). */
export function LessonRow({ lesson, lookup, enrolments, now, full }: { lesson: Lesson; lookup: Lookup; enrolments: Enrolment[]; now: Date; full?: boolean }) {
  const theme = useTheme();
  const tutor = lookup.tutor(lesson.tutorId);
  const service = lookup.service(lesson.serviceId);
  const subject = lessonSubject(lesson, enrolments);
  const students = lookup.studentNames(lesson.studentIds) || 'Student';
  const state = lessonState(lesson, now);
  const online = lesson.location === 'online';
  const parts = full
    ? [subject, service?.name, tutor ? `with ${tutor.fullName}` : undefined]
    : [subject, tutor?.fullName.split(' ')[0], placeLabel(lesson)];
  const sub = parts.filter(Boolean).join(' · ');
  return (
    <TimeRow
      large={full}
      start={formatTime(lesson.start)}
      end={full ? formatTime(lesson.end) : undefined}
      color={tutor?.color ?? theme.gold}
      title={students}
      status={state.label}
      statusColor={theme[state.color]}
      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } })}
      accessibilityLabel={`${formatTime(lesson.start)} to ${formatTime(lesson.end)}, ${students}${sub ? `, ${sub}` : ''}${full ? `, ${placeLabel(lesson)}` : ''}. ${state.label}.`}
      lines={[
        <Text key="sub" style={[font('sans'), { fontSize: full ? 14 : 13.5, lineHeight: 19, color: theme.textMuted }]}>
          {sub}
        </Text>,
        full ? (
          <View key="place" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
            <Icon name={online ? 'videocam' : 'location_on'} size={16} color={theme.textMuted} />
            <Text style={[font('sans'), { fontSize: 13, color: theme.textMuted, flexShrink: 1 }]}>{placeLabel(lesson)}</Text>
          </View>
        ) : null,
      ]}
    />
  );
}

const MIN_HOUR = 64;
const LABEL_W = 72;

/** One line per tutor across the working day; blocks open the lesson. Scrolls sideways on narrow screens. */
export function DayRibbon({ lessons, lookup, now }: { lessons: Lesson[]; lookup: Lookup; now: Date }) {
  const theme = useTheme();
  const active = lessons.filter((l) => l.status !== 'cancelled');
  const day = startOfDay(lessons[0] ? new Date(lessons[0].start) : now);
  const hourOf = (iso: string) => minutesBetween(day, new Date(iso)) / 60;
  const first = Math.min(8, ...active.map((l) => Math.floor(hourOf(l.start))));
  const last = Math.max(20, ...active.map((l) => Math.ceil(hourOf(l.end))));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const tutorIds = [...new Set(active.map((l) => l.tutorId))].sort((a, b) => (lookup.tutor(a)?.fullName ?? '').localeCompare(lookup.tutor(b)?.fullName ?? ''));
  const nowH = minutesBetween(day, now) / 60;
  const showNow = nowH >= first && nowH <= last;
  // Fit the day to the card when there is room; otherwise scroll, starting a little before now.
  const [box, setBox] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const HOUR = box ? Math.max(MIN_HOUR, (box - LABEL_W - 2) / hours.length) : MIN_HOUR;
  const width = hours.length * HOUR;
  const onLayout = (w: number) => {
    setBox(w);
    const hour = Math.max(MIN_HOUR, (w - LABEL_W - 2) / hours.length);
    const start = Math.max(0, ((showNow ? nowH : Math.min(...active.map((l) => hourOf(l.start)), last)) - first - 1) * hour);
    if (LABEL_W + hours.length * hour > w) setTimeout(() => scroller.current?.scrollTo({ x: start, animated: false }), 0);
  };
  return (
    <View
      style={[st.ribbonCard, { borderColor: theme.border, backgroundColor: theme.surface }]}
      onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
      {/* Tutor names stay put while the hours scroll. */}
      <View style={{ width: LABEL_W, paddingTop: 12 + 20, paddingBottom: 6 }}>
        {tutorIds.map((id) => {
          const tutor = lookup.tutor(id);
          return (
            <View key={id} style={[st.ribbonRow, st.ribbonName, { borderTopColor: theme.rowDivider }]}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tutor?.color ?? theme.gold }} />
              <Text style={[font('sans', 'bold'), { fontSize: 13, color: theme.text, flexShrink: 1 }]} numberOfLines={1}>
                {tutor?.fullName.split(' ')[0] ?? 'Tutor'}
              </Text>
            </View>
          );
        })}
      </View>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        <View style={{ width, paddingTop: 12, paddingBottom: 6 }}>
          <View style={{ flexDirection: 'row', height: 20 }}>
            {hours.map((h) => (
              <View key={h} style={{ width: HOUR, borderLeftWidth: 1, borderLeftColor: theme.rowDivider, paddingLeft: 4 }}>
                <Text style={[font('sans'), tabular, { fontSize: 11, color: theme.textMuted }]}>{`${String(h).padStart(2, '0')}:00`}</Text>
              </View>
            ))}
          </View>
          {tutorIds.map((id) => {
            const color = lookup.tutor(id)?.color ?? theme.gold;
            return (
              <View key={id} style={[st.ribbonRow, { borderTopColor: theme.rowDivider }]}>
                {active
                  .filter((l) => l.tutorId === id)
                  .map((l) => (
                    <RibbonBlock key={l.id} lesson={l} lookup={lookup} color={color} left={(hourOf(l.start) - first) * HOUR} width={(hourOf(l.end) - hourOf(l.start)) * HOUR - 4} />
                  ))}
              </View>
            );
          })}
          {showNow ? (
            <View pointerEvents="none" style={[st.now, { left: (nowH - first) * HOUR }]} accessibilityLabel={`Now, ${formatTime(now)}`}>
              <View style={st.nowDot} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function RibbonBlock({ lesson, lookup, color, left, width }: { lesson: Lesson; lookup: Lookup; color: string; left: number; width: number }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const names = lookup.studentNames(lesson.studentIds);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } })}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={`${names}, ${formatTime(lesson.start)} to ${formatTime(lesson.end)}`}
      style={[
        st.block,
        { left, width: Math.max(28, width), borderLeftColor: color, backgroundColor: hover ? theme.rowHover : theme.surfaceAlt },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <Text style={[font('sans', 'bold'), { fontSize: 12.5, color: theme.text }]} numberOfLines={1}>
        {firstNames(names)}
      </Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  ribbonCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden', flexDirection: 'row' },
  ribbonRow: { height: 46, borderTopWidth: 1 },
  ribbonName: { paddingLeft: 14, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  block: { position: 'absolute', top: 7, bottom: 7, borderLeftWidth: 2, borderRadius: 6, paddingHorizontal: 8, justifyContent: 'center', overflow: 'hidden' },
  now: { position: 'absolute', top: 10, bottom: 0, width: 1, backgroundColor: Brand.gold },
  nowDot: { position: 'absolute', top: -2, left: -3, width: 7, height: 7, borderRadius: 4, backgroundColor: Brand.gold },
});
