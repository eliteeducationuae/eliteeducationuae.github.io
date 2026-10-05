/**
 * Admissions advisory: map Supabase rows (snake_case, nulls) to app types and back.
 * Columns follow supabase/migrations/20261018000000_admissions.sql.
 */
import type {
  AdmissionsCase,
  AdmissionsDocument,
  AdmissionsEvent,
  AdmissionsKeyDate,
  AdmissionsKeyDateInput,
  AdmissionsTarget,
  AdmissionsTargetInput,
  AdmissionsTask,
  AdmissionsTaskInput,
  AdvisoryUpdate,
} from '@/domain/admissions';

type Row = Record<string, any>;

/** null → undefined, so optional fields are simply absent. */
const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);

/** Blank strings → null for writes. */
const nul = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : v;
  return t ? t : null;
};

/** `HH:MM` from a stored time (text `HH:MM`, tolerating `HH:MM:SS`). */
const hhmm = (v: string | null | undefined): string | undefined => (v ? String(v).slice(0, 5) : undefined);

/** `YYYY-MM-DD` from a stored date (tolerating a timestamp). */
const dateKey = (v: string | null | undefined): string | undefined => (v ? String(v).slice(0, 10) : undefined);

function omitUndefined<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) if (obj[key] === undefined) delete obj[key];
  return obj;
}

export const toAdmissionsCase = (r: Row): AdmissionsCase =>
  omitUndefined({
    id: r.id,
    studentId: r.student_id,
    familyId: r.family_id,
    kind: r.kind,
    title: r.title,
    entryYear: opt(r.entry_year),
    status: r.status,
    adviserTutorId: opt(r.adviser_tutor_id),
    summary: opt(r.summary),
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  });

export const toAdmissionsTarget = (r: Row): AdmissionsTarget =>
  omitUndefined({
    id: r.id,
    caseId: r.case_id,
    institution: r.institution,
    country: opt(r.country),
    programme: opt(r.programme),
    entryYear: opt(r.entry_year),
    requirements: opt(r.requirements),
    status: r.status,
    decisionDate: dateKey(r.decision_date),
    notes: opt(r.notes),
    sort: Number(r.sort ?? 0),
    updatedAt: r.updated_at ?? r.created_at,
  });

export const toAdmissionsKeyDate = (r: Row): AdmissionsKeyDate =>
  omitUndefined({
    id: r.id,
    caseId: r.case_id,
    targetId: opt(r.target_id),
    kind: r.kind,
    title: r.title,
    dueOn: dateKey(r.due_on)!,
    time: hhmm(r.time_of_day),
    done: !!r.done,
    enrolmentId: opt(r.enrolment_id),
    lessonId: opt(r.lesson_id),
    notes: opt(r.notes),
  });

export const toAdmissionsTask = (r: Row): AdmissionsTask =>
  omitUndefined({
    id: r.id,
    caseId: r.case_id,
    targetId: opt(r.target_id),
    title: r.title,
    details: opt(r.details),
    dueOn: dateKey(r.due_on),
    owner: r.owner,
    doneAt: opt(r.done_at),
    doneByName: opt(r.done_by_name),
    createdAt: r.created_at,
  });

export const toAdmissionsDocument = (r: Row): AdmissionsDocument =>
  omitUndefined({
    id: r.id,
    caseId: r.case_id,
    targetId: opt(r.target_id),
    category: r.category,
    name: r.name,
    path: r.path,
    mimeType: opt(r.mime_type),
    familyVisible: !!r.family_visible,
    uploadedBy: opt(r.uploaded_by),
    uploadedByName: opt(r.uploaded_by_name),
    createdAt: r.created_at,
  });

export const toAdvisoryUpdate = (r: Row): AdvisoryUpdate =>
  omitUndefined({
    id: r.id,
    caseId: r.case_id,
    kind: r.kind,
    title: r.title,
    period: opt(r.period),
    body: r.body ?? '',
    status: r.status,
    aiAssisted: !!r.ai_assisted,
    authorName: opt(r.author_name),
    createdAt: r.created_at,
    submittedAt: opt(r.submitted_at),
    approvedAt: opt(r.approved_at),
    publishedAt: opt(r.published_at),
  });

export const toAdmissionsEvent = (r: Row): AdmissionsEvent =>
  omitUndefined({
    id: r.id,
    caseId: r.case_id,
    at: r.at,
    kind: r.kind,
    title: r.title,
    detail: opt(r.detail),
    familyVisible: !!r.family_visible,
  });

/** Upsert row for admissions_targets (id omitted for a new entry). */
export function targetRow(input: AdmissionsTargetInput): Row {
  const row: Row = {
    case_id: input.caseId,
    institution: input.institution.trim(),
    country: nul(input.country),
    programme: nul(input.programme),
    entry_year: nul(input.entryYear),
    requirements: nul(input.requirements),
    status: input.status,
    decision_date: nul(input.decisionDate),
    notes: nul(input.notes),
  };
  if (input.id) row.id = input.id;
  if (input.sort !== undefined) row.sort = input.sort;
  return row;
}

/** Upsert row for admissions_dates. Never includes reminders_sent, which the server manages. */
export function keyDateRow(input: AdmissionsKeyDateInput): Row {
  const row: Row = {
    case_id: input.caseId,
    target_id: nul(input.targetId),
    kind: input.kind,
    title: input.title.trim(),
    due_on: input.dueOn,
    time_of_day: nul(input.time),
    enrolment_id: nul(input.enrolmentId),
    lesson_id: nul(input.lessonId),
    notes: nul(input.notes),
  };
  if (input.id) row.id = input.id;
  if (input.done !== undefined) row.done = input.done;
  return row;
}

/** Upsert row for admissions_tasks. Completion goes through set_admissions_task_done. */
export function taskRow(input: AdmissionsTaskInput): Row {
  const row: Row = {
    case_id: input.caseId,
    target_id: nul(input.targetId),
    title: input.title.trim(),
    details: nul(input.details),
    due_on: nul(input.dueOn),
    owner: input.owner,
  };
  if (input.id) row.id = input.id;
  return row;
}
