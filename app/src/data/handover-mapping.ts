import type { HandoverSources } from '@/domain/handover';
import type {
  Enrolment,
  Handover,
  Homework,
  Lesson,
  LessonNote,
  LessonPlan,
  PlannedHomework,
  Resource,
  Student,
  StudentReport,
  TopicRating,
} from '@/domain/types';

import type { LessonPlanInput } from './source';

// Session plans and handover packs: pure mapping between database rows and the domain model.

type Row = Record<string, any>;

const toPlannedHomework = (h: Row): PlannedHomework => {
  const item: PlannedHomework = { title: h.title ?? '' };
  if (h.studentId) item.studentId = h.studentId;
  if (h.details) item.details = h.details;
  return item;
};

/** A lesson_plans row. Its homework jsonb items are already camelCase. */
export const toLessonPlan = (r: Row): LessonPlan => ({
  lessonId: r.lesson_id,
  tutorId: r.tutor_id ?? undefined,
  objectives: r.objectives ?? '',
  topicIds: r.topic_ids ?? [],
  resourceIds: r.resource_ids ?? [],
  homework: ((r.homework ?? []) as Row[]).map(toPlannedHomework),
  sharedWithFamily: !!r.shared_with_family,
  createdAt: r.created_at ?? undefined,
  updatedAt: r.updated_at,
});

/** A handovers row. */
export const toHandover = (r: Row): Handover => ({
  id: r.id,
  createdAt: r.created_at,
  reason: r.reason,
  studentId: r.student_id,
  studentName: r.student_name ?? undefined,
  subject: r.subject ?? undefined,
  enrolmentId: r.enrolment_id ?? undefined,
  lessonId: r.lesson_id ?? undefined,
  opportunityId: r.opportunity_id ?? undefined,
  fromTutorId: r.from_tutor_id ?? undefined,
  toTutorId: r.to_tutor_id,
  note: r.note ?? undefined,
  noteUpdatedAt: r.note_updated_at ?? undefined,
  viewedAt: r.viewed_at ?? undefined,
});

/** Arguments for the save_lesson_plan RPC, from a normalised plan. Homework items carry no undefined keys. */
export const saveLessonPlanArgs = (input: LessonPlanInput) => ({
  p_lesson_id: input.lessonId,
  p_objectives: input.objectives,
  p_topic_ids: input.topicIds,
  p_resource_ids: input.resourceIds,
  p_homework: input.homework.map((h) => {
    const item: Row = { title: h.title };
    if (h.studentId) item.studentId = h.studentId;
    if (h.details) item.details = h.details;
    return item;
  }),
  p_shared: input.sharedWithFamily,
});

/** The row mappers supabase.ts already has for the other tables in a pack. */
export interface PackRowMappers {
  student(r: Row): Student;
  enrolment(r: Row): Enrolment;
  lesson(r: Row): Lesson;
  note(r: Row): LessonNote;
  homework(r: Row): Homework;
  rating(r: Row): TopicRating;
  resource(r: Row): Resource;
  report(r: Row): StudentReport;
}

/**
 * Maps the jsonb returned by handover_pack(p_id):
 * { handover, student (+ student_notes), enrolment|null, lessons, notes (+ lesson_private_notes), homework,
 *   plans (+ lesson_start_at), ratings, resources, latest_report|null }.
 */
export function handoverSourcesFromRpc(json: unknown, map: PackRowMappers): HandoverSources {
  const j = (json ?? {}) as Row;
  if (!j.handover || !j.student) throw new Error('Handover pack not found.');
  const list = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
  const out: HandoverSources = {
    handover: toHandover(j.handover),
    student: map.student(j.student),
    lessons: list(j.lessons).map(map.lesson),
    notes: list(j.notes).map(map.note),
    homework: list(j.homework).map(map.homework),
    plans: list(j.plans).map((p) => ({ ...toLessonPlan(p), lessonStart: new Date(p.lesson_start_at).toISOString() })),
    ratings: list(j.ratings).map(map.rating),
    // The pack never says which other children a resource is shared with.
    resources: list(j.resources).map((r) => ({ ...map.resource(r), studentIds: [] })),
  };
  if (j.enrolment) out.enrolment = map.enrolment(j.enrolment);
  if (j.latest_report) out.latestReport = map.report(j.latest_report);
  return out;
}
