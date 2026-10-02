import { addDays, addMinutes, hoursBetween } from './dates';
import type { Lesson, Settings } from './types';

export interface Slot {
  start: Date;
  end: Date;
}

export interface WeeklyRule {
  /** First lesson start. */
  start: Date;
  durationMin: number;
  /** Repeat every N weeks (1 = weekly, 2 = fortnightly). */
  intervalWeeks: number;
  /** Total number of lessons, including the first. */
  count: number;
}

/**
 * Expand a weekly recurrence into concrete lesson slots.
 * Uses calendar-day arithmetic so the wall-clock time is preserved.
 */
export function expandWeekly(rule: WeeklyRule): Slot[] {
  const count = Math.max(1, Math.min(rule.count, 104));
  const interval = Math.max(1, rule.intervalWeeks);
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(rule.start, i * 7 * interval);
    slots.push({ start, end: addMinutes(start, rule.durationMin) });
  }
  return slots;
}

/** Lessons that no longer occupy anyone's time. */
export function isActive(lesson: Pick<Lesson, 'status'>): boolean {
  return lesson.status !== 'cancelled' && lesson.status !== 'late-cancel';
}

export function overlaps(a: Slot, b: Slot): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface Clash {
  lesson: Lesson;
  reason: 'tutor' | 'student';
  /** Student ids that are double-booked (when reason === 'student'). */
  studentIds: string[];
}

/**
 * Find existing lessons that clash with a proposed slot — the same tutor, or any shared student,
 * at overlapping times. Cancelled lessons and the lesson being edited are ignored.
 */
export function findClashes(
  proposed: Slot & { tutorId: string; studentIds: string[]; ignoreLessonId?: string },
  existing: Lesson[],
): Clash[] {
  const clashes: Clash[] = [];
  for (const lesson of existing) {
    if (lesson.id === proposed.ignoreLessonId || !isActive(lesson)) continue;
    const slot = { start: new Date(lesson.start), end: new Date(lesson.end) };
    if (!overlaps(proposed, slot)) continue;
    if (lesson.tutorId === proposed.tutorId) {
      clashes.push({ lesson, reason: 'tutor', studentIds: [] });
      continue;
    }
    const shared = lesson.studentIds.filter((id) => proposed.studentIds.includes(id));
    if (shared.length > 0) clashes.push({ lesson, reason: 'student', studentIds: shared });
  }
  return clashes;
}

export interface CancellationOutcome {
  /** Status the lesson should move to. */
  status: 'cancelled' | 'late-cancel';
  chargeable: boolean;
  hoursNotice: number;
  /** Fraction of the rate charged (0 if not chargeable). */
  fee: number;
}

/**
 * Apply the cancellation policy. The business (admin) can always waive the fee.
 */
export function cancellationOutcome(
  lesson: Pick<Lesson, 'start'>,
  now: Date,
  settings: Pick<Settings, 'cancellationHours' | 'lateCancelFee'>,
  options: { waiveFee?: boolean } = {},
): CancellationOutcome {
  const hoursNotice = hoursBetween(now, new Date(lesson.start));
  const late = hoursNotice < settings.cancellationHours;
  const chargeable = late && !options.waiveFee && settings.lateCancelFee > 0;
  return {
    status: chargeable ? 'late-cancel' : 'cancelled',
    chargeable,
    hoursNotice,
    fee: chargeable ? settings.lateCancelFee : 0,
  };
}

/** Sort lessons by start time (ascending). */
export function byStart(a: Pick<Lesson, 'start'>, b: Pick<Lesson, 'start'>): number {
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}
