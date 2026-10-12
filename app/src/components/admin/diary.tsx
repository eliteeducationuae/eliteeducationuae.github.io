/**
 * The admin Diary: a week of days under an ink rule, then the chosen day as an Agenda or By tutor (with
 * drag-to-reschedule), or the whole Week as a list. Google busy times and admissions key dates appear in every view.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { font } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useBusyBlocks, useClosures, useEnrolments, useLessons, useLookup, useTutors } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { isClosed as isClosedAccount, withoutClosed } from '@/domain/closed-accounts';
import { addDays, formatTime, isSameDay, startOfDay, startOfWeek, weekdayShort } from '@/domain/dates';
import { byStart, type DayEntry, findBusyClashes, findClashes, inTimeOrder, isClosed } from '@/domain/scheduling';
import type { BusyBlock, Lesson } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { plural } from '@/lib/id';

import { DayWithKeyDates, hasKeyDatesOn, useWeekKeyDates } from '../admissions/calendar-lines';
import { Icon } from '../icon';
import { DayTimeline } from '../lessons';
import { Chip, ErrorNote, Loading, Notice, useWide } from '../ui';
import { LessonRow } from './day';
import { AdminPage, InlineLink, monthName, PageTitle, PillButton, PillSwitch } from './kit';

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

type View3 = 'agenda' | 'tutors' | 'week';

/** ISO week number, for the kicker ("October 2026 · Week 42"). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const longDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');

/** A quiet ruled line for a time the tutor is busy in Google Calendar (times only, never the event itself). */
function BusyLine({ block, tutorName }: { block: BusyBlock; tutorName?: string }) {
  const theme = useTheme();
  return (
    <View style={[s.busy, { borderBottomColor: theme.border }]}>
      <Icon name="calendar" size={16} color={theme.textMuted} />
      <Text style={[font('sans'), { flex: 1, fontSize: 13.5, color: theme.textMuted }]}>
        {formatTime(block.start)}–{formatTime(block.end)} · Busy in Google Calendar{tutorName ? ` · ${tutorName}` : ''}
      </Text>
    </View>
  );
}

export function AdminDiary() {
  const theme = useTheme();
  const wide = useWide();
  const viewing = useViewing();
  const lookup = useLookup();
  const tutors = useTutors();
  const enrolments = useEnrolments();
  const [now] = useState(() => new Date());
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<View3>('agenda');
  const [tutorFilter, setTutorFilter] = useState<string | null>(null);
  const weekStart = startOfWeek(selected);
  const lessons = useLessons(weekStart, addDays(weekStart, 7));
  const closures = useClosures();
  // Google Calendar: busy times only warn here; they never stop the office moving a lesson.
  const busyBlocks = useBusyBlocks(weekStart, addDays(weekStart, 7));
  // Admissions advisory: deadlines, tests and interviews for the cases this person may see.
  const keyDates = useWeekKeyDates(weekStart);
  const move = useAction(source.rescheduleLesson);
  const closed = (closures.data ?? []).find((c) => isClosed(selected, [c]));
  const canSchedule = !viewing;

  /** Drag-to-reschedule on the By tutor view. */
  function moveLesson(lesson: Lesson, deltaMin: number) {
    const start = new Date(new Date(lesson.start).getTime() + deltaMin * 60_000);
    const end = new Date(new Date(lesson.end).getTime() + deltaMin * 60_000);
    const clashes = findClashes({ start, end, tutorId: lesson.tutorId, studentIds: lesson.studentIds, ignoreLessonId: lesson.id }, lessons.data ?? []);
    const busy = findBusyClashes({ start, end, tutorId: lesson.tutorId }, busyBlocks.data ?? []);
    confirm(
      `Move ${lookup.studentNames(lesson.studentIds)}’s ${lesson.subject ? `${lesson.subject} ` : ''}lesson?`,
      `${formatTime(lesson.start)} → ${formatTime(start)}–${formatTime(end)}${clashes.length ? '\n\nPlease note that this clashes with another lesson.' : ''}${
        busy.length ? '\n\nPlease note that Google Calendar shows the tutor as busy at this time.' : ''
      }`,
      () => move.mutate([lesson.id, start.toISOString(), end.toISOString()]),
      'Move',
    );
  }

  const all = (lessons.data ?? []).filter((l) => !tutorFilter || l.tutorId === tutorFilter).sort(byStart);
  const countOn = (d: Date) => all.filter((l) => l.status !== 'cancelled' && isSameDay(new Date(l.start), d)).length;
  const dayLessons = all.filter((l) => isSameDay(new Date(l.start), selected));
  const weekBusy = (busyBlocks.data ?? []).filter((b) => !tutorFilter || b.tutorId === tutorFilter);
  const dayBusy = weekBusy.filter((b) => isSameDay(new Date(b.start), selected));
  const dayTutors = new Set(dayLessons.filter((l) => l.status !== 'cancelled').map((l) => l.tutorId)).size;
  const activeCount = dayLessons.filter((l) => l.status !== 'cancelled').length;
  const renderEntry = (e: DayEntry<Lesson, BusyBlock>) =>
    e.kind === 'busy' ? (
      <BusyLine key={`busy-${e.busy.id}`} block={e.busy} tutorName={lookup.tutor(e.busy.tutorId)?.fullName ?? 'Tutor'} />
    ) : (
      <LessonRow key={e.lesson.id} lesson={e.lesson} lookup={lookup} enrolments={enrolments.data ?? []} now={now} full />
    );
  // A closed tutor keeps a column only while their past lessons are in view.
  const allTutorIds = (tutors.data ?? [])
    .filter((t) => !isClosedAccount(t) || all.some((l) => l.tutorId === t.id))
    .map((t) => t.id)
    .filter((id) => !tutorFilter || id === tutorFilter);
  // By tutor shows the tutors teaching (or busy) that day, or everyone on an empty day.
  const teaching = allTutorIds.filter((id) => dayLessons.some((l) => l.tutorId === id) || dayBusy.some((b) => b.tutorId === id));
  const tutorIds = teaching.length ? teaching : allTutorIds;
  const shiftWeek = (n: number) => setSelected(addDays(selected, n * 7));

  return (
    <AdminPage onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <PageTitle
        kicker={`${monthName(selected)} ${selected.getFullYear()} · Week ${isoWeek(selected)}`}
        title="Diary"
        right={
          <PillSwitch
            label="Diary view"
            value={view}
            onChange={setView}
            options={[
              { value: 'agenda', label: 'Agenda' },
              { value: 'tutors', label: 'By tutor' },
              { value: 'week', label: 'Week' },
            ]}
          />
        }
      />

      <View style={{ gap: 10 }}>
        <View style={s.weekNav}>
          <Pressable onPress={() => shiftWeek(-1)} accessibilityRole="button" accessibilityLabel="Previous week" style={s.arrow}>
            <Icon name="back" size={20} color={theme.text} />
          </Pressable>
          <Pressable onPress={() => shiftWeek(1)} accessibilityRole="button" accessibilityLabel="Next week" style={s.arrow}>
            <Icon name="forward" size={20} color={theme.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {!isSameDay(selected, now) ? <InlineLink label="Back to today" onPress={() => setSelected(startOfDay(new Date()))} /> : null}
        </View>
        <View style={[s.week, { borderTopColor: theme.text, borderBottomColor: theme.border }]}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
            const on = isSameDay(d, selected);
            const isToday = isSameDay(d, now);
            const n = countOn(d);
            return (
              <Pressable
                key={d.toDateString()}
                onPress={() => setSelected(d)}
                accessibilityRole="button"
                accessibilityLabel={`${weekdayShort(d)} ${d.getDate()}, ${n} lessons`}
                accessibilityState={{ selected: on }}
                style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [
                  s.day,
                  { backgroundColor: on ? theme.surface : hovered ? theme.rowHover : 'transparent' },
                  webStyle({ cursor: 'pointer' }),
                ]}>
                <Text style={[font('sans', 'bold'), s.dow, { color: theme.textMuted }]}>{weekdayShort(d)}</Text>
                <Text style={[font('serif'), { fontSize: 22, lineHeight: 26, color: isToday ? theme.accent : theme.text }]}>{d.getDate()}</Text>
                <Text style={[font('sans'), { fontSize: 11, color: theme.textMuted }]} numberOfLines={1}>
                  {n ? (wide ? plural(n, 'lesson') : String(n)) : '—'}
                </Text>
                {on ? <View style={[s.dayMark, { backgroundColor: theme.gold }]} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {tutors.data && withoutClosed(tutors.data).length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel="Show one tutor">
          <Chip label="All tutors" selected={!tutorFilter} onPress={() => setTutorFilter(null)} />
          {withoutClosed(tutors.data).map((t) => (
            <Chip key={t.id} label={t.fullName.split(' ')[0]} selected={tutorFilter === t.id} onPress={() => setTutorFilter(tutorFilter === t.id ? null : t.id)} />
          ))}
        </ScrollView>
      ) : null}

      {view !== 'week' ? (
        <View style={s.dayHead}>
          <Text accessibilityRole="header" style={[font('serif'), { fontSize: 21, lineHeight: 27, color: theme.text, flexShrink: 1 }]}>
            {longDay(selected)}
            {isSameDay(selected, now) ? ' · Today' : ''}
          </Text>
          {activeCount ? (
            <Text style={[font('sans'), { fontSize: 13.5, color: theme.textMuted }]}>
              {plural(activeCount, 'lesson')} · {plural(dayTutors, 'tutor')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {closed ? (
        <Notice tone="info" icon="beach_access">
          {closed.name}: no new lessons are scheduled on these dates.
        </Notice>
      ) : null}
      <ErrorNote error={move.error} />

      {lessons.isLoading || !lookup.ready ? (
        <Loading />
      ) : view === 'tutors' ? (
        <View style={{ gap: 8 }}>
          {canSchedule ? <Text style={[font('sans'), { fontSize: 13.5, color: theme.textMuted }]}>To move a lesson, press and hold it, then drag.</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: wide ? undefined : Math.max(340, tutorIds.length * 120 + 48), flex: 1 }}>
              <DayTimeline day={selected} lessons={dayLessons} lookup={lookup} tutorIds={tutorIds} busy={dayBusy} onMove={canSchedule ? moveLesson : undefined} />
            </View>
          </ScrollView>
        </View>
      ) : view === 'agenda' ? (
        <View>
          <DayWithKeyDates day={selected} dates={keyDates} entries={inTimeOrder(dayLessons, dayBusy)} renderEntry={renderEntry} />
          {dayLessons.length || dayBusy.length || hasKeyDatesOn(keyDates, selected) ? null : (
            <View style={s.quiet}>
              <Text style={[font('serif'), { fontSize: 20, color: theme.text }]}>A quiet day.</Text>
              <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, textAlign: 'center' }]}>No lessons are booked on this day.</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={{ gap: 24 }}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
            const items = all.filter((l) => isSameDay(new Date(l.start), d));
            const busy = weekBusy.filter((b) => isSameDay(new Date(b.start), d));
            if (!items.length && !busy.length && !hasKeyDatesOn(keyDates, d)) return null;
            return (
              <View key={d.toDateString()} style={{ gap: 6 }}>
                <Text accessibilityRole="header" style={[font('serif'), { fontSize: 19, color: theme.text }]}>
                  {longDay(d)}
                  {isSameDay(d, now) ? ' · Today' : ''}
                </Text>
                <View style={{ borderTopWidth: 1, borderTopColor: theme.text }}>
                  <DayWithKeyDates day={d} dates={keyDates} entries={inTimeOrder(items, busy)} renderEntry={renderEntry} />
                </View>
              </View>
            );
          })}
          {all.length === 0 && keyDates.length === 0 && weekBusy.length === 0 ? (
            <View style={s.quiet}>
              <Text style={[font('serif'), { fontSize: 20, color: theme.text }]}>A quiet week.</Text>
              <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, textAlign: 'center' }]}>No lessons are booked this week.</Text>
            </View>
          ) : null}
        </View>
      )}

      {canSchedule ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <PillButton label="Schedule lessons" icon="add" onPress={() => router.push({ pathname: '/lesson/new', params: { date: selected.toISOString() } })} />
        </View>
      ) : null}
    </AdminPage>
  );
}

const s = StyleSheet.create({
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: -4 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  week: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1 },
  day: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingTop: 12, paddingBottom: 10 },
  dow: { fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase' },
  dayMark: { position: 'absolute', bottom: -1, left: '25%', right: '25%', height: 2 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1 },
  quiet: { paddingVertical: 48, alignItems: 'center', gap: 8 },
});
