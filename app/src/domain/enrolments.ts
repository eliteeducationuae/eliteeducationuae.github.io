import type { Enrolment, Lesson, Service, Tutor } from './types';

/** An enrolment as edited on a form: no student yet, and the server sets the topic list. */
export interface EnrolmentDraft {
  id?: string;
  subject: string;
  curriculum?: string;
  level?: string;
  examBoard?: string;
  tutorId?: string;
  syllabusId?: string;
  active: boolean;
  /** Custom AED per hour for the tutor; undefined uses their usual rate. */
  tutorPay?: number;
  /** Custom AED per hour for the family; undefined uses the service price. */
  familyPrice?: number;
}

const norm = (v?: string) => (v ?? '').trim().toLowerCase();

/** Same subject, ignoring case and outer spaces. False if either is empty. */
export function sameSubject(a?: string, b?: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && x === y;
}

/** The key shared topic lists are found by: 'subject|curriculum|level', lower-cased and trimmed. */
export function topicListKey(subject: string, curriculum?: string, level?: string): string {
  return [norm(subject), norm(curriculum), norm(level)].join('|');
}

/** 'IGCSE Chemistry', 'IB DP Maths (AA HL)' or 'Arabic'. */
export function enrolmentTitle(e: Pick<Enrolment, 'subject' | 'curriculum' | 'level'>): string {
  const base = [e.curriculum?.trim(), e.subject.trim()].filter(Boolean).join(' ');
  const level = e.level?.trim();
  return level ? `${base} (${level})` : base;
}

/** 'Cambridge · with Sarah Khan', or '' when there is nothing to add. */
export function enrolmentDetail(e: Pick<Enrolment, 'examBoard' | 'level' | 'tutorId'>, tutorName?: string): string {
  const parts: string[] = [];
  if (e.examBoard?.trim()) parts.push(e.examBoard.trim());
  if (e.tutorId && tutorName?.trim()) parts.push(`with ${tutorName.trim()}`);
  return parts.join(' · ');
}

/** A student's active enrolments, sorted by subject. */
export function activeEnrolments(all: Enrolment[], studentId: string): Enrolment[] {
  return all
    .filter((e) => e.active && e.studentId === studentId)
    .sort((a, b) => a.subject.localeCompare(b.subject) || enrolmentTitle(a).localeCompare(enrolmentTitle(b)));
}

/** 'Chemistry, Maths', or '' when the student has no active subject. */
export function studentSubjects(all: Enrolment[], studentId: string): string {
  return [...new Set(activeEnrolments(all, studentId).map((e) => e.subject))].join(', ');
}

/** The lesson's subject, or else the subject of the first student's only active enrolment. */
export function lessonSubject(lesson: Pick<Lesson, 'subject' | 'studentIds'>, all: Enrolment[]): string | undefined {
  if (lesson.subject?.trim()) return lesson.subject;
  const first = lesson.studentIds[0];
  if (!first) return undefined;
  const active = activeEnrolments(all, first);
  return active.length === 1 ? active[0].subject : undefined;
}

/** The student's active enrolment for a subject; with no subject, their only active one (if exactly one). */
export function enrolmentFor(all: Enrolment[], studentId: string, subject?: string): Enrolment | undefined {
  const active = activeEnrolments(all, studentId);
  if (!subject?.trim()) return active.length === 1 ? active[0] : undefined;
  return active.find((e) => sameSubject(e.subject, subject));
}

/** Unique active subjects across the students, sorted. */
export function subjectsFor(all: Enrolment[], studentIds: string[]): string[] {
  const seen = new Map<string, string>();
  for (const id of studentIds) {
    for (const e of activeEnrolments(all, id)) {
      const k = norm(e.subject);
      if (!seen.has(k)) seen.set(k, e.subject.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The service's subject if set; otherwise the one subject every student shares, if there is exactly one. */
export function defaultSubject(all: Enrolment[], studentIds: string[], service?: Pick<Service, 'subject'>): string | undefined {
  if (service?.subject?.trim()) return service.subject;
  if (!studentIds.length) return undefined;
  const sets = studentIds.map((id) => new Set(activeEnrolments(all, id).map((e) => norm(e.subject))));
  const shared = subjectsFor(all, studentIds).filter((s) => sets.every((set) => set.has(norm(s))));
  return shared.length === 1 ? shared[0] : undefined;
}

/** True when the subject is empty or the tutor lists it. */
export function tutorTeaches(tutor: Pick<Tutor, 'subjects'>, subject?: string): boolean {
  if (!subject?.trim()) return true;
  return tutor.subjects.some((s) => sameSubject(s, subject));
}

/** Checks the active rows of an enrolment form. Returns a message, or null when they are fine. */
export function validateEnrolments(drafts: EnrolmentDraft[]): string | null {
  const active = drafts.filter((d) => d.active);
  if (active.some((d) => !d.subject?.trim())) return 'Please choose a subject for every row.';
  const seen = new Map<string, string>();
  for (const d of active) {
    const key = topicListKey(d.subject, d.curriculum, d.level);
    const first = seen.get(key);
    if (first) return `${first} is listed twice. Please remove one.`;
    seen.set(key, d.subject.trim());
  }
  return null;
}

export function draftFromEnrolment(e: Enrolment): EnrolmentDraft {
  return {
    id: e.id,
    subject: e.subject,
    curriculum: e.curriculum,
    level: e.level,
    examBoard: e.examBoard,
    tutorId: e.tutorId,
    syllabusId: e.syllabusId,
    active: e.active,
    tutorPay: e.tutorPay,
    familyPrice: e.familyPrice,
  };
}

/** True when the draft's rates differ from the saved enrolment's (or, for a new one, when either is set). */
export function ratesChanged(draft: EnrolmentDraft, saved?: Enrolment): boolean {
  return (draft.tutorPay ?? null) !== (saved?.tutorPay ?? null) || (draft.familyPrice ?? null) !== (saved?.familyPrice ?? null);
}

/**
 * The draft change when an admin chooses a tutor (or none). Custom pay belongs to the student, subject and tutor
 * together, so a different tutor starts at their usual rate; choosing the saved tutor again restores the saved pay,
 * so a mistaken tap never deletes an agreed rate. Choosing the current tutor again changes nothing.
 */
export function tutorChoicePatch(
  draft: Pick<EnrolmentDraft, 'tutorId'>,
  tutorId: string | undefined,
  saved?: Pick<Enrolment, 'tutorId' | 'tutorPay'>,
): Partial<EnrolmentDraft> {
  if (draft.tutorId === tutorId) return { tutorId };
  if (saved && (saved.tutorId ?? undefined) === tutorId) return { tutorId, tutorPay: saved.tutorPay };
  return { tutorId, tutorPay: undefined };
}

/**
 * The subjects an admin must choose from when awarding a role: the student's active subjects when the role names a
 * student but no subject and the student has more than one, otherwise none (the role's subject, or the student's only
 * enrolment, decides). Mirrors public.award_opportunity (20261114000100_qa_award.sql).
 */
export function awardSubjectChoices(all: Enrolment[], role: { studentId?: string; subject?: string }): string[] {
  if (!role.studentId || role.subject?.trim()) return [];
  return activeEnrolments(all, role.studentId).length > 1 ? subjectsFor(all, [role.studentId]) : [];
}

/**
 * The subject to save on a role as it is awarded, or undefined when nothing changes. Throws the server's messages: a
 * different subject for a role that has one, a subject the student does not study, or no subject when one is needed.
 */
export function awardSubject(all: Enrolment[], role: { studentId?: string; subject?: string }, chosen: string | undefined, studentName?: string): string | undefined {
  const pick = chosen?.trim();
  if (role.subject?.trim()) {
    if (pick && !sameSubject(pick, role.subject)) throw new Error(`This role is already for ${role.subject.trim()}.`);
    return undefined;
  }
  if (!role.studentId) return undefined;
  if (pick) {
    const match = activeEnrolments(all, role.studentId).find((e) => sameSubject(e.subject, pick));
    if (!match) throw new Error("Please choose one of the student's current subjects.");
    return match.subject.trim().slice(0, 80);
  }
  if (activeEnrolments(all, role.studentId).length > 1) {
    throw new Error(`Please choose which subject this role is for: ${studentName?.trim().split(' ')[0] || 'the student'} has more than one subject.`);
  }
  return undefined;
}
