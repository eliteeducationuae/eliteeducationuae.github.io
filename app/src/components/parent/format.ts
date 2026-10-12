/** Small wording helpers for the parent screens. Everything here is derived from real data; nothing is invented. */
import { formatTime, isSameDay, addDays } from '@/domain/dates';
import type { Lesson } from '@/domain/types';

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const asDate = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d);

/** 'Wednesday 7 October'. */
export function longDay(d: Date | string): string {
  const x = asDate(d);
  return `${WEEKDAYS_LONG[x.getDay()]} ${x.getDate()} ${MONTHS_LONG[x.getMonth()]}`;
}

/** '7 October' (a YYYY-MM-DD key or an ISO time). */
export function dayMonth(d: Date | string): string {
  const x = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : asDate(d);
  return `${x.getDate()} ${MONTHS_LONG[x.getMonth()]}`;
}

/** The month name, e.g. 'September'. */
export function monthName(d: Date | string): string {
  return MONTHS_LONG[asDate(d).getMonth()];
}

/** A date chip's two lines: { top: 'Wed', num: '7' }. */
export function chipFor(d: Date | string): { top: string; num: string } {
  const x = asDate(d);
  return { top: WEEKDAYS_SHORT[x.getDay()], num: String(x.getDate()) };
}

/** 'Today', 'Tomorrow' or 'Thu 8 Oct'. */
export function shortWhen(d: Date | string, now: Date): string {
  const x = asDate(d);
  if (isSameDay(x, now)) return 'Today';
  if (isSameDay(x, addDays(now, 1))) return 'Tomorrow';
  return `${WEEKDAYS_SHORT[x.getDay()]} ${x.getDate()} ${MONTHS_SHORT[x.getMonth()]}`;
}

export const firstName = (full?: string) => full?.trim().split(/\s+/)[0] ?? '';

/** The video link opens this many minutes before the lesson starts. */
export const JOIN_EARLY_MINUTES = 10;

export type JoinState =
  | { kind: 'open' }
  | { kind: 'later'; opensAt: string }
  | { kind: 'no-link' }
  | { kind: 'in-person' }
  | { kind: 'over' };

/** Whether a lesson's video link can be used now, will open later, or is not there. */
export function joinState(lesson: Pick<Lesson, 'location' | 'start' | 'end'>, hasLink: boolean, now: Date): JoinState {
  if (lesson.location !== 'online') return { kind: 'in-person' };
  const start = new Date(lesson.start);
  if (new Date(lesson.end) <= now) return { kind: 'over' };
  if (!hasLink) return { kind: 'no-link' };
  const opens = new Date(start.getTime() - JOIN_EARLY_MINUTES * 60_000);
  return now >= opens ? { kind: 'open' } : { kind: 'later', opensAt: formatTime(opens) };
}

/** Minutes between two ISO times. */
export function lessonMinutes(l: Pick<Lesson, 'start' | 'end'>): number {
  return Math.round((new Date(l.end).getTime() - new Date(l.start).getTime()) / 60_000);
}

/** 'Online' or the address. */
export function placeLabel(l: Pick<Lesson, 'location' | 'address'>): string {
  return l.location === 'online' ? 'Online' : l.address || 'In person';
}

/** Topic levels as families read them (the 1–5 rating a tutor gives). */
export const PARENT_LEVELS = ['Just started', 'Needs practice', 'Developing', 'Confident', 'Secure'] as const;

export function levelLabel(rating: number): string {
  return PARENT_LEVELS[Math.min(5, Math.max(1, Math.round(rating))) - 1];
}
