/**
 * Shared pieces for the tutor's screens (2026 redesign): the tutor's own lessons, lesson rows, pay for a lesson,
 * and the counts behind the tab badges. Tutors only ever see their own lessons and pay, never a family's price
 * or contact details.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';

import { GroupRow, type ValueTone } from '@/components/ui';
import { useEnrolments, useHandbookAcks, useHandbookVersions, useLessons, useLookup, useReportCycles, useSettings, useStudentReports, type Lookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, formatTime, minutesBetween, startOfDay } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import { lessonTutorRate } from '@/domain/rates';
import { byStart } from '@/domain/scheduling';
import type { Enrolment, Lesson, Tutor } from '@/domain/types';

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const asDate = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d);

/** e.g. `Wednesday 7 October`. */
export function longDay(d: Date | string): string {
  const x = asDate(d);
  return `${DAYS_LONG[x.getDay()]} ${x.getDate()} ${MONTHS_LONG[x.getMonth()]}`;
}

/** e.g. `October`. */
export const monthName = (d: Date) => MONTHS_LONG[d.getMonth()];

/** e.g. `Wednesday`. */
export const weekdayLong = (d: Date | string) => DAYS_LONG[asDate(d).getDay()];

/** A date chip for a row: `{ top: 'Wed', num: '7' }`. */
export function dateChip(d: Date | string) {
  const x = asDate(d);
  return { top: DAYS_SHORT[x.getDay()], num: String(x.getDate()) };
}

export const firstName = (full?: string) => (full ?? '').trim().split(/\s+/)[0] ?? '';

/** Lessons that did not go ahead. */
export const isCancelled = (l: Pick<Lesson, 'status'>) => l.status === 'cancelled' || l.status === 'late-cancel';

/** A scheduled lesson that has ended and still needs its notes. */
export const needsRecording = (l: Pick<Lesson, 'status' | 'end'>, now: Date) => l.status === 'scheduled' && new Date(l.end) < now;

/** The window the tutor screens load: two months back (to record, pay) and two weeks ahead (next week). */
const today = () => startOfDay(new Date());

/** The signed-in tutor's own lessons (the data source already limits them), in time order. */
export function useMyLessons(from?: Date, to?: Date) {
  const me = useMe();
  const start = useMemo(() => from ?? addDays(today(), -60), [from]);
  const end = useMemo(() => to ?? addDays(today(), 15), [to]);
  const lessons = useLessons(start, end);
  const mine = useMemo(() => (lessons.data ?? []).filter((l) => l.tutorId === me.tutorId).sort(byStart), [lessons.data, me.tutorId]);
  return { ...lessons, mine };
}

/** Lessons waiting to be recorded: the Today tab's badge. */
export function useToRecordCount(): number {
  const { mine } = useMyLessons();
  const now = new Date();
  return mine.filter((l) => needsRecording(l, now)).length;
}

/** Whether the latest handbook still needs this tutor's acknowledgement. */
export function useHandbookDue(): { due: boolean; version?: number } {
  const me = useMe();
  const versions = useHandbookVersions();
  const acks = useHandbookAcks(me.tutorId ?? undefined);
  const latest = versions.data?.[0];
  if (!latest || !me.tutorId || acks.isLoading) return { due: false };
  const done = (acks.data ?? []).some((a) => a.tutorId === me.tutorId && a.version === latest.version);
  return { due: !done, version: latest.version };
}

/** Reports this tutor still has to write in an open round. */
export function useReportsToWrite(): number {
  const me = useMe();
  const cycles = useReportCycles();
  const reports = useStudentReports();
  const open = new Set((cycles.data ?? []).filter((c) => c.status === 'open').map((c) => c.id));
  return (reports.data ?? []).filter((r) => r.tutorId === me.tutorId && r.status === 'draft' && open.has(r.cycleId)).length;
}

/** The Account tab's badge: the handbook to acknowledge plus reports to write. */
export function useAccountBadge(): number {
  const handbook = useHandbookDue();
  const reports = useReportsToWrite();
  return (handbook.due ? 1 : 0) + reports;
}

/** What the tutor is paid for a lesson: hours × their own rate (usual or agreed per student). Never the family price. */
export function lessonPay(l: Lesson, tutor: Tutor | undefined, enrolments: Enrolment[]): { amount: number; rate: number; custom: boolean } | null {
  if (!tutor) return null;
  const r = lessonTutorRate(l, tutor, enrolments);
  const hours = minutesBetween(new Date(l.start), new Date(l.end)) / 60;
  return { amount: Math.round(hours * r.rate * 100) / 100, rate: r.rate, custom: r.source === 'custom' };
}

/** `Online` or the address (or `In person`). */
export function lessonWhere(l: Pick<Lesson, 'location' | 'address'>): string {
  return l.location === 'online' ? 'Online' : l.address?.trim() || 'In person';
}

/** First names of the lesson's students, e.g. `Layla` or `Omar & Zayd`. */
export function studentFirstNames(l: Pick<Lesson, 'studentIds'>, lookup: Lookup): string {
  return l.studentIds.map((id) => firstName(lookup.student(id)?.fullName) || 'Student').join(' & ');
}

/** The status word on the right of a lesson row. */
function rowStatus(l: Lesson, now: Date): { value?: string; tone: ValueTone } {
  if (needsRecording(l, now)) return { value: 'To record', tone: 'warn' };
  if (l.status === 'completed') return { value: 'Recorded', tone: 'good' };
  if (l.status === 'no-show') return { value: 'No-show', tone: 'muted' };
  if (isCancelled(l)) return { value: 'Cancelled', tone: 'muted' };
  return { tone: 'muted' };
}

/**
 * One lesson as a Group row: date chip, `15:30 · Layla · Chemistry`, `Online · IGCSE`, and a status. Tapping a
 * lesson that needs recording opens the record page; anything else opens the lesson.
 */
export function LessonRow({ lesson: l, now = new Date(), note }: { lesson: Lesson; now?: Date; note?: string }) {
  const lookup = useLookup();
  const enrolments = useEnrolments();
  const subject = lessonSubject(l, enrolments.data ?? []);
  const service = lookup.service(l.serviceId)?.name;
  const status = rowStatus(l, now);
  const record = needsRecording(l, now);
  const title = [formatTime(l.start), studentFirstNames(l, lookup), subject].filter(Boolean).join(' · ');
  return (
    <GroupRow
      date={dateChip(l.start)}
      title={title}
      note={note ?? [lessonWhere(l), service].filter(Boolean).join(' · ')}
      value={status.value}
      valueTone={status.tone}
      valueSize={12.5}
      onPress={() => router.push(record ? { pathname: '/complete/[id]', params: { id: l.id } } : { pathname: '/lesson/[id]', params: { id: l.id } })}
      accessibilityHint={record ? 'Opens the page to record this lesson' : 'Opens the lesson'}
    />
  );
}

/** The tutor's hourly rate, for copy such as "Paid at AED 180 an hour". */
export function useMyTutor(): Tutor | undefined {
  const me = useMe();
  const lookup = useLookup();
  return me.tutorId ? lookup.tutor(me.tutorId) : undefined;
}

/** Re-exported so tutor screens read settings from one place. */
export { useSettings };
