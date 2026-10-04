import { addDays, addMinutes, hoursBetween, startOfDay, toDateKey } from './dates';
import type { Availability, Closure, Lesson, Settings, Tutor, TutorAbsence } from './types';

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

// ---------------------------------------------------------------------------
// Availability, closures, absences and cover
// ---------------------------------------------------------------------------


export function isClosed(day: Date, closures: Pick<Closure, 'startDate' | 'endDate'>[]): boolean {
  const key = toDateKey(day);
  return closures.some((c) => key >= c.startDate && key <= c.endDate);
}

export function isAbsent(tutorId: string, day: Date, absences: Pick<TutorAbsence, 'tutorId' | 'startDate' | 'endDate'>[]): boolean {
  const key = toDateKey(day);
  return absences.some((a) => a.tutorId === tutorId && key >= a.startDate && key <= a.endDate);
}

/** Like expandWeekly, but skips dates that fall in a closure (and keeps going until `count` lessons). */
export function expandWeeklySkipping(rule: WeeklyRule, closures: Pick<Closure, 'startDate' | 'endDate'>[]): { slots: Slot[]; skipped: Date[] } {
  const slots: Slot[] = [];
  const skipped: Date[] = [];
  const count = Math.max(1, Math.min(rule.count, 104));
  const interval = Math.max(1, rule.intervalWeeks);
  for (let i = 0; slots.length < count && i < count + 52; i++) {
    const start = addDays(rule.start, i * 7 * interval);
    if (isClosed(start, closures)) {
      skipped.push(start);
      continue;
    }
    slots.push({ start, end: new Date(start.getTime() + rule.durationMin * 60_000) });
  }
  return { slots, skipped };
}

/** `HH:MM` on a given day, local time. */
function at(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = startOfDay(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Monday-based weekday (0 = Monday). */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export interface OpenSlotInput {
  tutorId: string;
  from: Date;
  days: number;
  durationMin: number;
  availability: Availability[];
  lessons: Lesson[];
  closures: Closure[];
  absences: TutorAbsence[];
  noticeHours: number;
  now: Date;
  ignoreLessonId?: string;
  stepMin?: number;
}

/**
 * Bookable start times for a tutor. Mirrors public.open_slots() in the database:
 * inside weekly availability, in 30-minute steps, not clashing with the tutor's lessons,
 * not on closures or absences, and at least `noticeHours` from now.
 */
export function openSlots(input: OpenSlotInput): Slot[] {
  const step = input.stepMin ?? 30;
  const earliest = input.now.getTime() + input.noticeHours * 3_600_000;
  const busy = input.lessons.filter(
    (l) => l.tutorId === input.tutorId && l.id !== input.ignoreLessonId && l.status !== 'cancelled' && l.status !== 'late-cancel',
  );
  const out: Slot[] = [];
  for (let i = 0; i < Math.min(Math.max(input.days, 1), 60); i++) {
    const day = addDays(startOfDay(input.from), i);
    if (isClosed(day, input.closures) || isAbsent(input.tutorId, day, input.absences)) continue;
    const blocks = input.availability
      .filter((a) => a.tutorId === input.tutorId && a.weekday === weekdayIndex(day))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const block of blocks) {
      const end = at(day, block.end).getTime();
      for (let t = at(day, block.start).getTime(); t + input.durationMin * 60_000 <= end; t += step * 60_000) {
        const slot = { start: new Date(t), end: new Date(t + input.durationMin * 60_000) };
        if (t < earliest) continue;
        if (busy.some((l) => overlaps(slot, { start: new Date(l.start), end: new Date(l.end) }))) continue;
        out.push(slot);
      }
    }
  }
  return out;
}

/** Whether a slot sits inside one of the tutor's availability blocks. */
export function withinAvailability(tutorId: string, slot: Slot, availability: Availability[]): boolean {
  const day = slot.start;
  return availability.some(
    (a) =>
      a.tutorId === tutorId &&
      a.weekday === weekdayIndex(day) &&
      at(day, a.start).getTime() <= slot.start.getTime() &&
      at(day, a.end).getTime() >= slot.end.getTime(),
  );
}

export interface CoverOption {
  tutor: Tutor;
  /** Has the slot in their weekly availability (otherwise they'd need asking). */
  available: boolean;
}

/** Tutors who could take a lesson: not the current tutor, not away that day and free at that time. */
export function coverOptions(
  lesson: Lesson,
  tutors: Tutor[],
  lessons: Lesson[],
  availability: Availability[],
  absences: TutorAbsence[],
): CoverOption[] {
  const slot = { start: new Date(lesson.start), end: new Date(lesson.end) };
  return tutors
    .filter((t) => t.id !== lesson.tutorId && !isAbsent(t.id, slot.start, absences))
    .filter((t) => findClashes({ ...slot, tutorId: t.id, studentIds: [], ignoreLessonId: lesson.id }, lessons).length === 0)
    .map((t) => ({ tutor: t, available: withinAvailability(t.id, slot, availability) }))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.tutor.fullName.localeCompare(b.tutor.fullName));
}

/** Scheduled lessons that fall inside a tutor's absence. */
export function lessonsDuringAbsence(absence: TutorAbsence, lessons: Lesson[]): Lesson[] {
  return lessons.filter(
    (l) =>
      l.tutorId === absence.tutorId &&
      l.status === 'scheduled' &&
      toDateKey(new Date(l.start)) >= absence.startDate &&
      toDateKey(new Date(l.start)) <= absence.endDate,
  );
}
