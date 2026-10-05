import { enrolmentFor } from '@/domain/enrolments';
import { validateHandoverNote, type HandoverSources } from '@/domain/handover';
import { normalisePlan, validatePlan } from '@/domain/plans';
import type { Enrolment, Handover, HandoverReason, Lesson, LessonPlan, Profile } from '@/domain/types';

import type { LessonPlanInput } from '../source';
import { AccessError, canSeeLesson, newId, visibleStudentIds, type DemoDB } from './db';

// Session plans and tutor handover packs. Mirrors the rules in the 20261110000000_handover migration
// (lesson_plans policies, save_lesson_plan, delete_lesson_plan, handovers policies, handover_pack,
// save_handover_note, mark_handover_viewed and the triggers that create handovers).

/** Older persisted demo databases predate these collections. */
const plansOf = (db: DemoDB) => (db.lessonPlans ??= []);
const handoversOf = (db: DemoDB) => (db.handovers ??= []);

/**
 * A second change of tutor for the same student, subject and incoming tutor within this many days reuses the
 * existing handover (filling in any missing links), whichever lesson, enrolment or role caused it.
 */
export const HANDOVER_DEDUPE_DAYS = 14;
/** How many past lessons a pack draws on. */
export const HANDOVER_LESSON_LIMIT = 10;
/** How many plans a pack draws on (handover_pack uses the same limit). */
export const HANDOVER_PLAN_LIMIT = 5;
/** How much open homework a pack lists (handover_pack uses the same limit). */
export const HANDOVER_HOMEWORK_LIMIT = 20;

const norm = (v?: string) => (v ?? '').trim().toLowerCase();

/** Handover subject matching: either side blank, or the same subject ignoring case. */
const subjectMatches = (handoverSubject?: string, lessonSubject?: string) =>
  !norm(handoverSubject) || !norm(lessonSubject) || norm(handoverSubject) === norm(lessonSubject);

/** Admins see every plan; the lesson's tutor sees theirs; families see shared plans of lessons they can see. */
function canReadPlan(db: DemoDB, viewer: Profile, plan: LessonPlan): boolean {
  const lesson = db.lessons.find((l) => l.id === plan.lessonId);
  if (!lesson) return false;
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'tutor') return !!viewer.tutorId && lesson.tutorId === viewer.tutorId;
  return plan.sharedWithFamily && canSeeLesson(db, viewer, lesson);
}

const isStaffFor = (db: DemoDB, viewer: Profile, plan: LessonPlan) =>
  viewer.role === 'admin' ||
  (viewer.role === 'tutor' && !!viewer.tutorId && db.lessons.find((l) => l.id === plan.lessonId)?.tutorId === viewer.tutorId);

/**
 * What a reader may see of a plan, as visible_lesson_plans returns it. Staff see it whole; families see only
 * general planned homework and homework for their own children (a group lesson spans several families).
 */
function planFor(db: DemoDB, viewer: Profile, plan: LessonPlan): LessonPlan {
  if (isStaffFor(db, viewer, plan)) return plan;
  const mine = visibleStudentIds(db, viewer);
  return { ...plan, homework: plan.homework.filter((h) => !h.studentId || mine.has(h.studentId)) };
}

/** The lesson's tutor or an admin, on a scheduled lesson. */
function plannableLesson(db: DemoDB, viewer: Profile, lessonId: string): Lesson {
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson || !canSeeLesson(db, viewer, lesson)) throw new Error('Lesson not found.');
  if (viewer.role !== 'admin' && !(viewer.role === 'tutor' && viewer.tutorId && lesson.tutorId === viewer.tutorId)) {
    throw new AccessError('Only the lesson’s tutor or an admin can plan this lesson.');
  }
  if (lesson.status !== 'scheduled') throw new Error('Only scheduled lessons can be planned.');
  return lesson;
}

export interface NewHandover {
  id?: string;
  reason: HandoverReason;
  studentId: string;
  subject?: string;
  enrolmentId?: string;
  lessonId?: string;
  opportunityId?: string;
  fromTutorId?: string;
  toTutorId: string;
  note?: string;
}

export const ho = {
  // ---- Session plans ----

  plan(db: DemoDB, viewer: Profile, lessonId: string): LessonPlan | null {
    const plan = plansOf(db).find((p) => p.lessonId === lessonId);
    return plan && canReadPlan(db, viewer, plan) ? planFor(db, viewer, plan) : null;
  },

  plans(db: DemoDB, viewer: Profile, range: { from: string; to: string }): LessonPlan[] {
    return plansOf(db)
      .filter((p) => {
        const lesson = db.lessons.find((l) => l.id === p.lessonId);
        return !!lesson && lesson.start >= range.from && lesson.start < range.to && canReadPlan(db, viewer, p);
      })
      .map((p) => planFor(db, viewer, p));
  },

  savePlan(db: DemoDB, viewer: Profile, input: LessonPlanInput, now = new Date()): LessonPlan {
    const lesson = plannableLesson(db, viewer, input.lessonId);
    const clean = normalisePlan(input);
    const problem = validatePlan(clean, lesson.studentIds);
    if (problem) throw new Error(problem);
    const list = plansOf(db);
    const existing = list.find((p) => p.lessonId === lesson.id);
    const saved: LessonPlan = {
      ...clean,
      lessonId: lesson.id,
      tutorId: lesson.tutorId,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (existing) Object.assign(existing, saved);
    else list.push(saved);
    return saved;
  },

  deletePlan(db: DemoDB, viewer: Profile, lessonId: string) {
    plannableLesson(db, viewer, lessonId);
    db.lessonPlans = plansOf(db).filter((p) => p.lessonId !== lessonId);
  },

  // ---- Handovers ----

  handovers(db: DemoDB, viewer: Profile, filter: { studentId?: string; lessonId?: string } = {}): Handover[] {
    return handoversOf(db)
      .filter((h) => {
        if (filter.studentId && h.studentId !== filter.studentId) return false;
        if (filter.lessonId && h.lessonId !== filter.lessonId) return false;
        if (viewer.role === 'admin') return true;
        return viewer.role === 'tutor' && !!viewer.tutorId && (h.toTutorId === viewer.tutorId || h.fromTutorId === viewer.tutorId);
      })
      // Older demo handovers predate the stored name.
      .map((h) => (h.studentName ? h : { ...h, studentName: db.students.find((s) => s.id === h.studentId)?.fullName }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** The material for a pack: the incoming tutor and admins only. */
  sources(db: DemoDB, viewer: Profile, id: string): HandoverSources {
    const handover = handoversOf(db).find((h) => h.id === id);
    const allowed =
      !!handover && (viewer.role === 'admin' || (viewer.role === 'tutor' && !!viewer.tutorId && handover.toTutorId === viewer.tutorId));
    if (!handover || !allowed) throw new Error('Handover pack not found.');
    const student = db.students.find((s) => s.id === handover.studentId);
    if (!student) throw new Error('Handover pack not found.');

    const enrolment = handover.enrolmentId
      ? db.enrolments.find((e) => e.id === handover.enrolmentId)
      : handover.subject
        ? enrolmentFor(db.enrolments, student.id, handover.subject)
        : undefined;

    const studentLessons = db.lessons.filter((l) => l.studentIds.includes(student.id) && subjectMatches(handover.subject, l.subject));
    const lessons = studentLessons
      .filter((l) => l.status === 'completed' || l.status === 'no-show')
      .sort((a, b) => b.start.localeCompare(a.start))
      .slice(0, HANDOVER_LESSON_LIMIT);
    const lessonIds = new Set(lessons.map((l) => l.id));
    const notes = db.notes
      .filter((n) => lessonIds.has(n.lessonId))
      .map((n) => {
        const lesson = lessons.find((l) => l.id === n.lessonId)!;
        // A private note is only for its own tutor and admins.
        if (viewer.role === 'admin' || lesson.tutorId === viewer.tutorId) return n;
        const { privateNote: _hidden, ...rest } = n;
        return rest;
      });

    const lessonById = new Map(db.lessons.map((l) => [l.id, l]));
    const homework = db.homework
      .filter((h) => {
        if (h.studentId !== student.id || h.done) return false;
        const lesson = h.lessonId ? lessonById.get(h.lessonId) : undefined;
        return !lesson || subjectMatches(handover.subject, lesson.subject);
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      .slice(0, HANDOVER_HOMEWORK_LIMIT);

    const studentLessonIds = new Map(studentLessons.map((l) => [l.id, l]));
    const plans = plansOf(db)
      .filter((p) => studentLessonIds.has(p.lessonId))
      .map((p) => ({ ...p, lessonStart: studentLessonIds.get(p.lessonId)!.start }))
      .sort((a, b) => b.lessonStart.localeCompare(a.lessonStart))
      .slice(0, HANDOVER_PLAN_LIMIT);

    const ratings = db.ratings.filter((r) => r.studentId === student.id);

    const referenced = new Set<string>();
    for (const p of plans) for (const rid of p.resourceIds) referenced.add(rid);
    for (const h of homework) for (const a of h.attachments ?? []) if (a.resourceId) referenced.add(a.resourceId);
    const resources = (db.resources ?? [])
      // Same filter as handover_pack: planned or attached, or shared with this student.
      .filter((r) => referenced.has(r.id) || (r.visibility === 'students' && r.studentIds.includes(student.id)))
      // Never reveal which other children a resource is shared with.
      .map((r) => ({ ...r, studentIds: [] }));

    // As handover_pack: same subject (or either blank), most recently published first.
    const reportDate = (r: { publishedAt?: string; updatedAt: string }) => r.publishedAt ?? r.updatedAt;
    const latestReport = db.reports
      .filter(
        (r) =>
          r.studentId === student.id &&
          (r.status === 'approved' || r.status === 'published') &&
          subjectMatches(handover.subject, r.subject),
      )
      .sort((a, b) => reportDate(b).localeCompare(reportDate(a)))[0];

    const out: HandoverSources = { handover, student, lessons, notes, homework, plans, ratings, resources };
    if (enrolment) out.enrolment = enrolment;
    if (latestReport) out.latestReport = latestReport;
    return out;
  },

  /** The outgoing tutor or an admin. An empty note clears it. */
  saveNote(db: DemoDB, viewer: Profile, id: string, note: string, now = new Date()) {
    const handover = handoversOf(db).find((h) => h.id === id);
    const allowed =
      !!handover && (viewer.role === 'admin' || (viewer.role === 'tutor' && !!viewer.tutorId && handover.fromTutorId === viewer.tutorId));
    if (!handover || !allowed) throw new AccessError('Only the previous tutor or an admin can write the handover note.');
    const problem = validateHandoverNote(note);
    if (problem) throw new Error(problem);
    const text = note.trim();
    handover.note = text || undefined;
    handover.noteUpdatedAt = now.toISOString();
  },

  /** The incoming tutor opened the pack. No-op for anyone else, or once already viewed. */
  markViewed(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const handover = handoversOf(db).find((h) => h.id === id);
    if (!handover || handover.viewedAt || viewer.role !== 'tutor' || !viewer.tutorId || handover.toTutorId !== viewer.tutorId) return;
    handover.viewedAt = now.toISOString();
  },

  /**
   * Records a handover, unless the tutor is unchanged. Like create_handover, a handover for the same student,
   * incoming tutor and subject within the last 14 days is reused: any missing lesson, enrolment, role or
   * outgoing tutor is filled in and the existing handover is returned. Returns the new or existing handover, or null.
   */
  createHandover(db: DemoDB, input: NewHandover, now = new Date()): Handover | null {
    if (!input.toTutorId || input.fromTutorId === input.toTutorId) return null;
    const list = handoversOf(db);
    const since = new Date(now.getTime() - HANDOVER_DEDUPE_DAYS * 86_400_000).toISOString();
    const duplicate = list
      .filter(
        (h) =>
          h.studentId === input.studentId &&
          h.toTutorId === input.toTutorId &&
          norm(h.subject) === norm(input.subject) &&
          h.createdAt > since,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (duplicate) {
      const links = ['lessonId', 'enrolmentId', 'opportunityId', 'fromTutorId'] as const;
      for (const key of links) if (!duplicate[key] && input[key]) duplicate[key] = input[key];
      return duplicate;
    }
    const created: Handover = {
      id: input.id ?? newId('ho'),
      createdAt: now.toISOString(),
      reason: input.reason,
      studentId: input.studentId,
      toTutorId: input.toTutorId,
    };
    const studentName = db.students.find((s) => s.id === input.studentId)?.fullName;
    if (studentName) created.studentName = studentName;
    const optional = ['subject', 'enrolmentId', 'lessonId', 'opportunityId', 'fromTutorId'] as const;
    for (const key of optional) if (input[key]) created[key] = input[key];
    if (input.note?.trim()) {
      created.note = input.note.trim();
      created.noteUpdatedAt = now.toISOString();
    }
    list.push(created);
    return created;
  },

  /**
   * After an admin gives a lesson to another tutor: a cover handover for each student. Moving it back to the
   * student's regular tutor (undoing a cover) creates nothing, and withdraws the unread cover pack sent to the
   * tutor it was taken from.
   */
  afterLessonReassigned(db: DemoDB, lesson: Lesson, oldTutorId: string | undefined, now = new Date()): Handover[] {
    const current = db.lessons.find((l) => l.id === lesson.id) ?? lesson;
    if (!oldTutorId || current.tutorId === oldTutorId) return [];
    const out: Handover[] = [];
    for (const studentId of current.studentIds) {
      const enrolment = enrolmentFor(db.enrolments, studentId, current.subject);
      if (enrolment?.active && enrolment.tutorId && enrolment.tutorId === current.tutorId) {
        db.handovers = handoversOf(db).filter(
          (h) => !(h.lessonId === current.id && h.reason === 'cover' && h.studentId === studentId && h.toTutorId === oldTutorId && !h.viewedAt),
        );
        continue;
      }
      const h = ho.createHandover(
        db,
        {
          reason: 'cover',
          studentId,
          subject: current.subject ?? enrolment?.subject,
          enrolmentId: enrolment?.id,
          lessonId: current.id,
          fromTutorId: oldTutorId,
          toTutorId: current.tutorId,
        },
        now,
      );
      if (h) out.push(h);
    }
    return out;
  },

  /** After an enrolment is saved with a different tutor: a handover to the new tutor. */
  afterEnrolmentSaved(db: DemoDB, before: Enrolment | undefined, after: Enrolment, now = new Date()): Handover | null {
    // As the enrolments trigger: only a change from one tutor to another, not a first assignment.
    if (!before?.tutorId || !after.active || !after.tutorId || before.tutorId === after.tutorId) return null;
    return ho.createHandover(
      db,
      {
        reason: 'reassigned',
        studentId: after.studentId,
        subject: after.subject,
        enrolmentId: after.id,
        fromTutorId: before.tutorId,
        toTutorId: after.tutorId,
      },
      now,
    );
  },

  /** After a role for a known student is awarded: a handover to the winning tutor. */
  /**
   * The subject's tutor before a bid is awarded. Awarding (rates) moves the enrolment to the winner straight away, so
   * the handover's previous tutor is read first, as the database trigger sees it before award_opportunity's enrolment update.
   */
  tutorBeforeAward(db: DemoDB, bidId: string): string | undefined {
    const o = db.opportunities.find((x) => x.id === db.bids.find((b) => b.id === bidId)?.opportunityId);
    return o?.studentId && o.subject ? enrolmentFor(db.enrolments, o.studentId, o.subject)?.tutorId : undefined;
  },
  afterAward(db: DemoDB, opportunityId: string, now = new Date(), previousTutorId?: string): Handover | null {
    const o = db.opportunities.find((x) => x.id === opportunityId);
    if (!o || o.status !== 'awarded' || !o.studentId || !o.awardedTutorId) return null;
    const enrolment = o.subject ? enrolmentFor(db.enrolments, o.studentId, o.subject) : undefined;
    return ho.createHandover(
      db,
      {
        reason: 'awarded',
        studentId: o.studentId,
        subject: o.subject ?? enrolment?.subject,
        enrolmentId: enrolment?.id,
        opportunityId: o.id,
        fromTutorId: previousTutorId ?? enrolment?.tutorId,
        toTutorId: o.awardedTutorId,
      },
      now,
    );
  },
};
