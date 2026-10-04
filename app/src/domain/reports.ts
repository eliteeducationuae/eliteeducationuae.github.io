import { RATING_LABELS, focusTopics, masteryByTopic, type TopicMastery } from './progress';
import type { Homework, Lesson, LessonNote, Student, TopicRating } from './types';

/** Everything a tutor needs in front of them to write a report, computed from data the app already has. */
export interface ReportFacts {
  firstName: string;
  lessonsTaught: number;
  attendancePercent: number | null;
  homeworkPercent: number | null;
  topicsCovered: { topicId: string; rating: number }[];
  improved: TopicMastery[];
  needsWork: TopicMastery[];
  recentNotes: string[];
}

export function reportFacts(
  student: Student,
  data: { lessons: Lesson[]; notes: LessonNote[]; homework: Homework[]; ratings: TopicRating[] },
  since: string,
): ReportFacts {
  const lessons = data.lessons.filter((l) => l.studentIds.includes(student.id) && l.start >= since);
  const happened = lessons.filter((l) => l.status === 'completed' || l.status === 'no-show' || l.status === 'late-cancel');
  const attended = happened.filter((l) => l.status === 'completed').length;
  const hw = data.homework.filter((h) => h.studentId === student.id && h.dueDate >= since.slice(0, 10));
  const ratings = data.ratings.filter((r) => r.studentId === student.id && r.ratedAt >= since);
  const mastery = masteryByTopic(ratings);
  const byLesson = new Map(lessons.map((l) => [l.id, l]));
  const notes = data.notes
    .filter((n) => byLesson.has(n.lessonId) && n.summary)
    .sort((a, b) => byLesson.get(b.lessonId)!.start.localeCompare(byLesson.get(a.lessonId)!.start));
  return {
    firstName: student.fullName.split(' ')[0],
    lessonsTaught: attended,
    attendancePercent: happened.length ? Math.round((attended / happened.length) * 100) : null,
    homeworkPercent: hw.length ? Math.round((hw.filter((h) => h.done).length / hw.length) * 100) : null,
    topicsCovered: [...mastery.values()].map((m) => ({ topicId: m.topicId, rating: m.rating })),
    improved: [...mastery.values()].filter((m) => m.trend > 0 || m.rating >= 4).sort((a, b) => b.rating - a.rating).slice(0, 4),
    needsWork: focusTopics(mastery, 3),
    recentNotes: notes.slice(0, 5).map((n) => n.summary),
  };
}

export interface ReportDraft {
  strengths: string;
  nextSteps: string;
  comment: string;
}

/**
 * A plain template draft written from the facts. Used in demo mode and whenever the AI service isn't available,
 * so tutors always get a starting point.
 */
export function sampleReportDraft(facts: ReportFacts, topicName: (id: string) => string): ReportDraft {
  const name = facts.firstName;
  const strong = facts.improved.map((m) => topicName(m.topicId));
  const weak = facts.needsWork.map((m) => topicName(m.topicId));
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const attendance =
    facts.attendancePercent === null ? '' : facts.attendancePercent >= 90 ? `${name}'s attendance has been excellent. ` : `${name} has attended ${facts.attendancePercent}% of lessons. `;
  const homework =
    facts.homeworkPercent === null
      ? ''
      : facts.homeworkPercent >= 80
        ? 'Homework has been completed consistently and to a good standard. '
        : `Homework completion (${facts.homeworkPercent}%) is an area to improve — regular practice will make a real difference. `;
  return {
    strengths: strong.length
      ? `${name} is now confident with ${list(strong)}${facts.improved.some((m) => m.trend > 0) ? ', and has made clear progress this term' : ''}.`
      : `${name} has engaged well in lessons and is building a secure foundation.`,
    nextSteps: weak.length
      ? `Focus next on ${list(weak)} (currently ${weak.length === 1 ? RATING_LABELS[facts.needsWork[0].rating].toLowerCase() : 'still developing'}), with regular exam-style practice.`
      : 'Continue with timed exam-style questions to build speed and accuracy.',
    comment: `${attendance}${homework}Across ${facts.lessonsTaught} lesson${facts.lessonsTaught === 1 ? '' : 's'} this term we have covered ${facts.topicsCovered.length} topic${facts.topicsCovered.length === 1 ? '' : 's'}. ${strong.length ? `${name} should be proud of the progress in ${strong[0]}. ` : ''}${weak.length ? `With continued work on ${weak[0]}, I'm confident ${name} will keep improving.` : `I'm confident ${name} will continue to make excellent progress.`}`,
  };
}

/** One-tap grade scales used on the writing screen and in the family's copy. */
export const EFFORT_LABELS: Record<number, string> = { 1: 'Needs attention', 2: 'Inconsistent', 3: 'Good', 4: 'Very good', 5: 'Outstanding' };
export const PROGRESS_LABELS: Record<number, string> = { 1: 'Below expected', 2: 'Slower than expected', 3: 'As expected', 4: 'Above expected', 5: 'Exceptional' };

/** The facts in plain words, as sent to the AI drafting service (topic ids resolved to names, no surnames). */
export function factsForAi(facts: ReportFacts, topicName: (id: string) => string, context: { curriculum: string; syllabus?: string; attainment?: string; effort?: number; progress?: number }) {
  const named = (ms: { topicId: string; rating: number }[]) => ms.map((m) => `${topicName(m.topicId)} (${RATING_LABELS[m.rating]})`);
  return {
    firstName: facts.firstName,
    curriculum: context.syllabus ?? context.curriculum,
    workingAt: context.attainment || undefined,
    effort: context.effort ? EFFORT_LABELS[context.effort] : undefined,
    progress: context.progress ? PROGRESS_LABELS[context.progress] : undefined,
    lessonsAttended: facts.lessonsTaught,
    attendancePercent: facts.attendancePercent,
    homeworkPercent: facts.homeworkPercent,
    topicsCovered: named(facts.topicsCovered),
    strongOrImproved: named(facts.improved),
    needsWork: named(facts.needsWork),
    recentLessonNotes: facts.recentNotes,
  };
}
