import { daysUntil } from './dates';
import { focusTopics as pickFocusTopics, masteryByTopic, summariseSyllabus } from './progress';
import type { TopicLookup } from './topics';
import type {
  Enrolment,
  Handover,
  HandoverReason,
  Homework,
  Lesson,
  LessonNote,
  LessonPlan,
  LessonStatus,
  Resource,
  Student,
  StudentReport,
  TopicRating,
} from './types';

/**
 * The raw material for a handover pack, as returned by the handover_pack RPC (or the demo). The sources already
 * apply the visibility rules: a lesson's private note is only present when the viewer may read it.
 */
export interface HandoverSources {
  handover: Handover;
  student: Student;
  enrolment?: Enrolment;
  lessons: Lesson[];
  notes: LessonNote[];
  homework: Homework[];
  plans: (LessonPlan & { lessonStart: string })[];
  ratings: TopicRating[];
  resources: Resource[];
  latestReport?: StudentReport;
  /**
   * The incoming tutor no longer teaches the student (the enrolment moved on, or a covered lesson ended over a week
   * ago): only the handover, its note and the student's name are present.
   */
  closed?: boolean;
}

export interface HandoverLessonSummary {
  lessonId: string;
  start: string;
  tutorId: string;
  status: LessonStatus;
  summary: string;
  topicNames: string[];
  privateNote?: string;
}

/** Everything the incoming tutor needs to pick up a student, ready to show. */
export interface HandoverPack {
  handover: Handover;
  student: Student;
  enrolment?: Enrolment;
  subject?: string;
  goals: string[];
  examDate?: string;
  daysToExam?: number;
  mastery: { masteryPercent: number; coveragePercent: number; covered: number; total: number; weakUnits: string[] } | null;
  focusTopics: { topicId: string; name: string; rating: number; trend: number }[];
  /** At most five, newest first. */
  recentLessons: HandoverLessonSummary[];
  /** Not yet done, soonest due first. */
  openHomework: Homework[];
  /** At most three, newest lesson first. */
  recentPlans: { lessonId: string; lessonStart: string; objectives: string; topicNames: string[]; homeworkTitles: string[]; sharedWithFamily: boolean }[];
  /** Each once; those referenced by plans and homework first. */
  resources: Resource[];
  /** The student's tutor-only notes. */
  tutorNotes?: string;
  handoverNote?: string;
  /** Only the handover and its note remain: see HandoverSources.closed. */
  closed?: boolean;
}

export const HANDOVER_REASON_LABEL: Record<HandoverReason, string> = {
  cover: 'Cover lesson',
  reassigned: 'New tutor for this subject',
  awarded: 'New student',
};

export const HANDOVER_LIMITS = { recentLessons: 5, recentPlans: 3, focusTopics: 5 } as const;

/** Longest handover note, matching save_handover_note. */
export const HANDOVER_NOTE_LIMIT = 4000;

/** Checks a handover note before saving; null when it is fine (an empty note clears it). */
export function validateHandoverNote(note: string): string | null {
  return note.trim().length > HANDOVER_NOTE_LIMIT ? 'Please keep the handover note to 4,000 characters or fewer.' : null;
}

/** e.g. 'Charlotte Hughes (Maths)', or just the name when the handover has no subject. */
export function handoverTitle(h: Handover, studentName: string): string {
  const subject = h.subject?.trim();
  return subject ? `${studentName} (${subject})` : studentName;
}

/** Builds the pack from its sources. Pure: never fetches anything. */
export function assembleHandoverPack(src: HandoverSources, topics: TopicLookup, now: Date): HandoverPack {
  const { handover, student, enrolment } = src;
  const subject = handover.subject ?? enrolment?.subject;

  // The card already shows the current and target grades and the exam date, so goals carry only the latest
  // report's next steps.
  const goals: string[] = [];
  const nextSteps = src.latestReport?.nextSteps?.trim();
  if (nextSteps) goals.push(nextSteps);

  // Mastery across the subject's topic tree.
  const tree = enrolment ? topics.treeFor(enrolment) : undefined;
  const treeIds = new Set(tree ? tree.units.flatMap((u) => u.topics.map((t) => t.id)) : []);
  let mastery: HandoverPack['mastery'] = null;
  let relevant = src.ratings;
  if (tree && treeIds.size) {
    relevant = src.ratings.filter((r) => treeIds.has(r.topicId));
    const summary = summariseSyllabus(tree, masteryByTopic(relevant));
    mastery = {
      masteryPercent: summary.masteryPercent,
      coveragePercent: summary.coveragePercent,
      covered: summary.covered,
      total: summary.total,
      weakUnits: summary.units.filter((u) => u.covered > 0 && u.average < 3).map((u) => u.unit.name),
    };
  } else if (subject) {
    // No tree: keep ratings for this subject, and any whose subject is not known.
    const wanted = subject.trim().toLowerCase();
    relevant = src.ratings.filter((r) => {
      const s = topics.subjectOf(r.topicId);
      return !s || s.trim().toLowerCase() === wanted;
    });
  }
  const focus = pickFocusTopics(masteryByTopic(relevant), HANDOVER_LIMITS.focusTopics).map((m) => ({
    topicId: m.topicId,
    name: topics.name(m.topicId),
    rating: m.rating,
    trend: m.trend,
  }));

  const notesByLesson = new Map(src.notes.map((n) => [n.lessonId, n]));
  const recentLessons: HandoverLessonSummary[] = [...src.lessons]
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, HANDOVER_LIMITS.recentLessons)
    .map((l) => {
      const note = notesByLesson.get(l.id);
      const item: HandoverLessonSummary = {
        lessonId: l.id,
        start: l.start,
        tutorId: l.tutorId,
        status: l.status,
        summary: note?.summary ?? '',
        topicNames: (note?.topicIds ?? []).map((id) => topics.name(id)),
      };
      if (note?.privateNote) item.privateNote = note.privateNote;
      return item;
    });

  const openHomework = src.homework.filter((h) => !h.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));

  const plans = [...src.plans].sort((a, b) => b.lessonStart.localeCompare(a.lessonStart));
  const recentPlans = plans.slice(0, HANDOVER_LIMITS.recentPlans).map((p) => ({
    lessonId: p.lessonId,
    lessonStart: p.lessonStart,
    objectives: p.objectives,
    topicNames: p.topicIds.map((id) => topics.name(id)),
    homeworkTitles: p.homework.map((h) => h.title),
    sharedWithFamily: p.sharedWithFamily,
  }));

  // Resources the plans and homework point to come first, then the rest, each once.
  const referenced = new Set<string>();
  for (const p of plans) for (const id of p.resourceIds) referenced.add(id);
  for (const h of src.homework) for (const a of h.attachments ?? []) if (a.resourceId) referenced.add(a.resourceId);
  const seen = new Set<string>();
  const resources: Resource[] = [];
  for (const pass of [true, false]) {
    for (const r of src.resources) {
      if (seen.has(r.id) || referenced.has(r.id) !== pass) continue;
      seen.add(r.id);
      resources.push(r);
    }
  }

  const pack: HandoverPack = {
    handover,
    student,
    enrolment,
    subject,
    goals,
    mastery,
    focusTopics: focus,
    recentLessons,
    openHomework,
    recentPlans,
    resources,
  };
  if (student.examDate) {
    pack.examDate = student.examDate;
    pack.daysToExam = daysUntil(student.examDate, now);
  }
  if (student.notes?.trim()) pack.tutorNotes = student.notes;
  if (handover.note?.trim()) pack.handoverNote = handover.note;
  if (src.closed) pack.closed = true;
  return pack;
}
