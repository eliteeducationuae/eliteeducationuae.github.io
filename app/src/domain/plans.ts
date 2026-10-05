import { resourceAttachment } from './homework';
import type { Attachment, Lesson, LessonPlan, PlannedHomework, Resource } from './types';

/** A plan as the tutor edits it (the same shape as LessonPlanInput in src/data/source.ts). */
type PlanInput = Omit<LessonPlan, 'tutorId' | 'createdAt' | 'updatedAt'>;

/** Upper limits on a session plan, matching the checks in save_lesson_plan. */
export const PLAN_LIMITS = { objectives: 4000, topics: 50, resources: 20, homework: 10, title: 200, details: 4000 } as const;

const unique = (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

/** Trim text, drop blank planned homework and repeated ids. */
export function normalisePlan(input: PlanInput): PlanInput {
  const homework: PlannedHomework[] = [];
  for (const h of input.homework ?? []) {
    const title = (h.title ?? '').trim();
    const details = (h.details ?? '').trim();
    if (!title && !details) continue;
    const item: PlannedHomework = { title };
    if (h.studentId) item.studentId = h.studentId;
    if (details) item.details = details;
    homework.push(item);
  }
  return {
    lessonId: input.lessonId,
    objectives: (input.objectives ?? '').trim(),
    topicIds: unique(input.topicIds ?? []),
    resourceIds: unique(input.resourceIds ?? []),
    homework,
    sharedWithFamily: !!input.sharedWithFamily,
  };
}

/** True when the plan has nothing in it. */
export function isPlanEmpty(plan?: Pick<LessonPlan, 'objectives' | 'topicIds' | 'resourceIds' | 'homework'> | null): boolean {
  if (!plan) return true;
  return (
    !(plan.objectives ?? '').trim() &&
    !(plan.topicIds ?? []).length &&
    !(plan.resourceIds ?? []).length &&
    !(plan.homework ?? []).some((h) => (h.title ?? '').trim() || (h.details ?? '').trim())
  );
}

/**
 * Checks a (normalised) plan. Returns a message for the tutor, or null when it can be saved.
 * Pass the lesson's students to check that per-student homework is for someone in the lesson.
 */
export function validatePlan(input: PlanInput, lessonStudentIds?: string[]): string | null {
  if (isPlanEmpty(input)) return 'Please add an objective, a topic, a resource or planned homework.';
  if ((input.objectives ?? '').length > PLAN_LIMITS.objectives) {
    return `Please keep the objectives to ${PLAN_LIMITS.objectives.toLocaleString('en-GB')} characters or fewer.`;
  }
  if ((input.topicIds ?? []).length > PLAN_LIMITS.topics) return `Please choose no more than ${PLAN_LIMITS.topics} topics.`;
  if ((input.resourceIds ?? []).length > PLAN_LIMITS.resources) return `Please choose no more than ${PLAN_LIMITS.resources} resources.`;
  const homework = input.homework ?? [];
  if (homework.length > PLAN_LIMITS.homework) return `Please plan no more than ${PLAN_LIMITS.homework} pieces of homework.`;
  for (const h of homework) {
    if (!(h.title ?? '').trim()) return 'Each piece of planned homework needs a title.';
    if (h.title.length > PLAN_LIMITS.title) return `Please keep each homework title to ${PLAN_LIMITS.title} characters or fewer.`;
    if ((h.details ?? '').length > PLAN_LIMITS.details) {
      return `Please keep the homework details to ${PLAN_LIMITS.details.toLocaleString('en-GB')} characters or fewer.`;
    }
    if (h.studentId && lessonStudentIds && !lessonStudentIds.includes(h.studentId)) {
      return 'Planned homework must be for a student in this lesson.';
    }
  }
  return null;
}

/**
 * The tutor's scheduled lessons starting within the next `hours` (from now, inclusive, to now + hours,
 * exclusive) that have no plan, or only an empty one. Soonest first.
 */
export function lessonsNeedingPlan(lessons: Lesson[], plans: LessonPlan[], tutorId: string | undefined, now: Date, hours = 48): Lesson[] {
  if (!tutorId) return [];
  const from = now.getTime();
  const to = from + hours * 3_600_000;
  const planned = new Set(plans.filter((p) => !isPlanEmpty(p)).map((p) => p.lessonId));
  return lessons
    .filter((l) => {
      if (l.status !== 'scheduled' || l.tutorId !== tutorId || planned.has(l.id)) return false;
      const start = new Date(l.start).getTime();
      return start >= from && start < to;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** What the record-lesson screen starts with when the lesson was planned. */
export interface RecordPrefill {
  summary: string;
  topicIds: string[];
  /** Homework title per student. */
  homework: Record<string, string>;
  homeworkExtras: Record<string, { open: boolean; details: string; attachments: Attachment[] }>;
}

/**
 * Turns a plan into a starting point for recording the lesson. Homework without a student goes to every
 * student; several pieces for one student are joined. The plan's resources are attached to each student's
 * homework.
 */
export function prefillFromPlan(plan: LessonPlan | null | undefined, studentIds: string[], resources: Resource[]): RecordPrefill {
  const out: RecordPrefill = { summary: '', topicIds: [], homework: {}, homeworkExtras: {} };
  if (!plan || isPlanEmpty(plan)) return out;
  const objectives = (plan.objectives ?? '').trim();
  out.summary = objectives ? `Objectives: ${objectives}` : '';
  out.topicIds = [...(plan.topicIds ?? [])];

  const byId = new Map(resources.map((r) => [r.id, r]));
  const attachments = (plan.resourceIds ?? []).map((id) => byId.get(id)).filter((r): r is Resource => !!r).map(resourceAttachment);

  for (const studentId of studentIds) {
    const items = (plan.homework ?? []).filter((h) => (!h.studentId || h.studentId === studentId) && (h.title ?? '').trim());
    if (!items.length) continue;
    const details = items.map((h) => (h.details ?? '').trim()).filter(Boolean).join('\n\n');
    out.homework[studentId] = items.map((h) => h.title.trim()).join('; ');
    out.homeworkExtras[studentId] = {
      open: !!details || attachments.length > 0,
      details,
      attachments: attachments.map((a) => ({ ...a })),
    };
  }
  return out;
}
