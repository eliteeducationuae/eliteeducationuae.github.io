import { displayStatus } from './billing';
import { addDays, minutesBetween } from './dates';
import { masteryByTopic } from './progress';
import { weekdayIndex } from './scheduling';
import type { Availability, Homework, Invoice, Lesson, Student, TopicRating } from './types';

export interface RiskSignal {
  key: 'attendance' | 'homework' | 'mastery' | 'no-lessons' | 'overdue';
  label: string;
  weight: number;
}

export interface StudentRisk {
  studentId: string;
  /** 0–100; 40+ is worth a conversation. */
  score: number;
  signals: RiskSignal[];
}

export const AT_RISK_THRESHOLD = 40;

/**
 * Rule-based early warning for a student, from the last 6 weeks of data.
 * Signals: missed lessons, homework not done, topic ratings falling, nothing booked, family invoices overdue.
 */
export function studentRisk(
  student: Student,
  data: { lessons: Lesson[]; homework: Homework[]; ratings: TopicRating[]; invoices: Invoice[] },
  now: Date = new Date(),
): StudentRisk {
  const since = addDays(now, -42).toISOString();
  const mine = data.lessons.filter((l) => l.studentIds.includes(student.id));
  const recent = mine.filter((l) => l.start >= since && l.start <= now.toISOString());
  const signals: RiskSignal[] = [];

  const happened = recent.filter((l) => l.status === 'completed' || l.status === 'no-show' || l.status === 'late-cancel');
  const missed = happened.filter((l) => l.status !== 'completed').length;
  if (happened.length >= 3 && missed / happened.length >= 0.25) {
    signals.push({ key: 'attendance', label: `Missed ${missed} of the last ${happened.length} lessons`, weight: 30 });
  }

  const hw = data.homework.filter((h) => h.studentId === student.id && h.dueDate >= since.slice(0, 10) && h.dueDate < now.toISOString().slice(0, 10));
  if (hw.length >= 3) {
    const done = hw.filter((h) => h.done).length / hw.length;
    if (done < 0.6) signals.push({ key: 'homework', label: `Only ${Math.round(done * 100)}% of recent homework done`, weight: 25 });
  }

  const ratings = data.ratings.filter((r) => r.studentId === student.id);
  const falling = [...masteryByTopic(ratings).values()].filter((m) => m.trend < 0 && m.lastRatedAt >= since);
  if (falling.length >= 2) {
    signals.push({ key: 'mastery', label: `${falling.length} topics slipping`, weight: 20 });
  }

  const upcoming = mine.some((l) => l.status === 'scheduled' && l.start > now.toISOString());
  if (mine.length > 0 && !upcoming) {
    signals.push({ key: 'no-lessons', label: 'No lessons booked', weight: 30 });
  }

  const overdue = data.invoices.some((i) => i.familyId === student.familyId && displayStatus(i, now) === 'overdue');
  if (overdue) signals.push({ key: 'overdue', label: 'Family invoice overdue', weight: 15 });

  return { studentId: student.id, score: Math.min(100, signals.reduce((s, x) => s + x.weight, 0)), signals };
}

export interface Utilisation {
  tutorId: string;
  taughtHours: number;
  availableHours: number;
  /** 0–1, or 0 when no availability is set. */
  rate: number;
}

/** Hours taught vs hours offered in weekly availability over [from, to). */
export function tutorUtilisation(tutorId: string, lessons: Lesson[], availability: Availability[], from: Date, to: Date): Utilisation {
  let available = 0;
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    for (const a of availability.filter((x) => x.tutorId === tutorId && x.weekday === weekdayIndex(d))) {
      const [sh, sm] = a.start.split(':').map(Number);
      const [eh, em] = a.end.split(':').map(Number);
      available += (eh * 60 + em - (sh * 60 + sm)) / 60;
    }
  }
  const taught =
    lessons
      .filter((l) => l.tutorId === tutorId && (l.status === 'completed' || l.status === 'scheduled') && l.start >= from.toISOString() && l.start < to.toISOString())
      .reduce((s, l) => s + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60;
  return { tutorId, taughtHours: Math.round(taught * 10) / 10, availableHours: Math.round(available * 10) / 10, rate: available ? Math.min(1, taught / available) : 0 };
}
