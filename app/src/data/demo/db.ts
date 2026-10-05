import { SYLLABUSES } from '@/data/curriculum';
import type { AuditEvent } from '@/domain/audit';
import { chargesForLesson, invoiceTotals, itemsFromCharges, newInvoiceDraft, roundMoney } from '@/domain/billing';
import { toDateKey } from '@/domain/dates';
import { enrolmentTitle, sameSubject, topicListKey, type EnrolmentDraft } from '@/domain/enrolments';
import { cancellationOutcome, type CancellationOutcome } from '@/domain/scheduling';
import type {
  Expense,
  Opportunity,
  OpportunityBid,
  PaymentDetails,
  ReportCycle,
  StudentReport,
  TutorApplication,
  TutorInvoice,
  Announcement,
  Availability,
  BusyBlock,
  CalendarConnection,
  Charge,
  Closure,
  Enquiry,
  Enrolment,
  LessonRequest,
  Message,
  TutorAbsence,
  Family,
  FamilyContact,
  Homework,
  HomeworkSubmission,
  Invoice,
  InvoiceStatus,
  Lesson,
  LessonNote,
  LessonPackage,
  PaymentMethod,
  Profile,
  Resource,
  Service,
  Settings,
  Student,
  Tutor,
  Topic,
  TopicList,
  TopicRating,
  PackageOffer,
} from '@/domain/types';

import type { CompleteLessonInput, NewLesson } from '../source';

import { syncPrimaryFromFamily } from './contacts';

/** The whole demo database — a plain object so it can be persisted as JSON and tested directly. */
export interface DemoDB {
  version: number;
  settings: Settings;
  profiles: Profile[];
  tutors: Tutor[];
  families: Family[];
  students: Student[];
  services: Service[];
  lessons: Lesson[];
  notes: LessonNote[];
  homework: Homework[];
  ratings: TopicRating[];
  packages: LessonPackage[];
  charges: Charge[];
  invoices: Invoice[];
  availability: Availability[];
  closures: Closure[];
  absences: TutorAbsence[];
  enquiries: Enquiry[];
  requests: LessonRequest[];
  messages: Message[];
  /** profileId → familyId → last read ISO time. */
  reads: Record<string, Record<string, string>>;
  announcements: Announcement[];
  opportunities: Opportunity[];
  bids: OpportunityBid[];
  applications: TutorApplication[];
  paymentDetails: PaymentDetails[];
  tutorInvoices: TutorInvoice[];
  reportCycles: ReportCycle[];
  reports: StudentReport[];
  expenses: Expense[];
  enrolments: Enrolment[];
  topicLists: TopicList[];
  topics: Topic[];
  /** Messages the office would receive (mirrors public.notify_admins writing to notification_outbox). */
  outbox: OutboxMessage[];
  submissions: HomeworkSubmission[];
  resources: Resource[];
  // Google Calendar. Optional because demo databases saved before this feature lack them: read with `?? []`.
  busyBlocks?: BusyBlock[];
  calendarConnections?: CalendarConnection[];
  /** Card payments: lesson packages parents can buy. Optional because databases saved before it lack the field. */
  packageOffers?: PackageOffer[];
  /** Family contacts. Optional because databases saved before it lack the field: read with allContacts in ./contacts, which backfills each family's main contact. */
  familyContacts?: FamilyContact[];
  /** Audit trail (mirrors public.audit_events). Optional: databases saved before it lack the field. */
  audit?: AuditEvent[];
}

export interface OutboxMessage {
  id: string;
  createdAt: string;
  audience: 'admins';
  subject: string;
  body: string;
  url?: string;
}

/** Mirrors public.notify_admins: queue a message for the office. */
export function notifyAdmins(db: DemoDB, subject: string, body: string, url?: string, now = new Date()) {
  (db.outbox ??= []).push({ id: newId('out'), createdAt: now.toISOString(), audience: 'admins', subject, body, url });
}

export const DEMO_DB_VERSION = 9;

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class AccessError extends Error {}

// ---------------------------------------------------------------------------
// Visibility — mirrors the Supabase row-level security policies.
// ---------------------------------------------------------------------------

export function visibleStudentIds(db: DemoDB, viewer: Profile): Set<string> {
  switch (viewer.role) {
    case 'admin':
      return new Set(db.students.map((s) => s.id));
    case 'tutor':
      // Students they have taught, plus those assigned to them for a subject (before the first lesson).
      return new Set([
        ...db.lessons.filter((l) => l.tutorId === viewer.tutorId).flatMap((l) => l.studentIds),
        ...db.enrolments.filter((e) => e.active && !!viewer.tutorId && e.tutorId === viewer.tutorId).map((e) => e.studentId),
      ]);
    case 'parent':
      return new Set(db.students.filter((s) => s.familyId === viewer.familyId).map((s) => s.id));
    case 'student':
      return new Set(viewer.studentId ? [viewer.studentId] : []);
  }
}

export function canSeeLesson(db: DemoDB, viewer: Profile, lesson: Lesson): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'tutor') return lesson.tutorId === viewer.tutorId;
  const mine = visibleStudentIds(db, viewer);
  return lesson.studentIds.some((id) => mine.has(id));
}

function canSeeFamily(db: DemoDB, viewer: Profile, familyId: string): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'parent') return viewer.familyId === familyId;
  return false;
}

export function requireAdmin(viewer: Profile) {
  if (viewer.role !== 'admin') throw new AccessError('Only an admin can do that.');
}

function stripPrivate(note: LessonNote, viewer: Profile): LessonNote {
  if (viewer.role === 'admin' || viewer.role === 'tutor') return note;
  const { privateNote: _hidden, ...rest } = note;
  return rest;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const q = {
  students(db: DemoDB, viewer: Profile): Student[] {
    const ids = visibleStudentIds(db, viewer);
    return db.students
      .filter((s) => ids.has(s.id))
      .map((s) => (viewer.role === 'admin' || viewer.role === 'tutor' ? s : { ...s, notes: undefined }));
  },
  families(db: DemoDB, viewer: Profile): Family[] {
    if (viewer.role === 'admin') return db.families;
    const familyIds = new Set(q.students(db, viewer).map((s) => s.familyId));
    // Mirrors the "see families" policy: a parent always sees their own family, even before a child is added.
    if (viewer.familyId) familyIds.add(viewer.familyId);
    return db.families.filter((f) => familyIds.has(f.id));
  },
  lessons(db: DemoDB, viewer: Profile, from: string, to: string): Lesson[] {
    return db.lessons.filter((l) => l.start < to && l.end > from && canSeeLesson(db, viewer, l));
  },
  notes(db: DemoDB, viewer: Profile, filter: { studentId?: string; lessonId?: string } = {}): LessonNote[] {
    return db.notes
      .filter((n) => {
        if (filter.lessonId && n.lessonId !== filter.lessonId) return false;
        const lesson = db.lessons.find((l) => l.id === n.lessonId);
        if (!lesson || !canSeeLesson(db, viewer, lesson)) return false;
        return !filter.studentId || lesson.studentIds.includes(filter.studentId);
      })
      .map((n) => stripPrivate(n, viewer));
  },
  homework(db: DemoDB, viewer: Profile, studentId?: string, lessonId?: string): Homework[] {
    const ids = visibleStudentIds(db, viewer);
    return db.homework.filter(
      (h) => ids.has(h.studentId) && (!studentId || h.studentId === studentId) && (!lessonId || h.lessonId === lessonId),
    );
  },
  ratings(db: DemoDB, viewer: Profile, studentId?: string): TopicRating[] {
    const ids = visibleStudentIds(db, viewer);
    return db.ratings.filter((r) => ids.has(r.studentId) && (!studentId || r.studentId === studentId));
  },
  packages(db: DemoDB, viewer: Profile, familyId?: string): LessonPackage[] {
    return db.packages.filter((p) => canSeeFamily(db, viewer, p.familyId) && (!familyId || p.familyId === familyId));
  },
  charges(db: DemoDB, viewer: Profile, familyId?: string): Charge[] {
    return db.charges.filter((c) => canSeeFamily(db, viewer, c.familyId) && (!familyId || c.familyId === familyId));
  },
  invoices(db: DemoDB, viewer: Profile, familyId?: string): Invoice[] {
    return db.invoices.filter(
      (i) =>
        canSeeFamily(db, viewer, i.familyId) &&
        (!familyId || i.familyId === familyId) &&
        // Families never see drafts.
        (viewer.role === 'admin' || i.status !== 'draft'),
    );
  },
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function upsert<T extends { id: string }>(list: T[], item: Omit<T, 'id'> & { id?: string }, prefix: string): T {
  const id = item.id ?? newId(prefix);
  const full = { ...item, id } as T;
  const index = list.findIndex((x) => x.id === id);
  if (index >= 0) list[index] = full;
  else list.push(full);
  return full;
}

export const cmd = {
  saveSettings(db: DemoDB, viewer: Profile, patch: Partial<Settings>) {
    requireAdmin(viewer);
    db.settings = { ...db.settings, ...patch };
  },
  saveTutor(db: DemoDB, viewer: Profile, tutor: Omit<Tutor, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    return upsert(db.tutors, tutor, 'tut');
  },
  saveFamily(db: DemoDB, viewer: Profile, family: Omit<Family, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    const saved = upsert(db.families, family, 'fam');
    syncPrimaryFromFamily(db, saved);
    return saved;
  },
  saveStudent(db: DemoDB, viewer: Profile, student: Omit<Student, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    const isNew = !student.id || !db.students.some((s) => s.id === student.id);
    const saved = upsert(db.students, student, 'stu');
    // Mirrors the students_enrol trigger: older app versions create students with a maths syllabus only.
    if (isNew && saved.syllabusId && !db.enrolments.some((e) => e.studentId === saved.id)) {
      db.enrolments.push(linkList(db, { id: newId('enr'), studentId: saved.id, ...syllabusEnrolment(saved.syllabusId, saved.curriculum), active: true }));
    }
    return saved;
  },
  saveService(db: DemoDB, viewer: Profile, service: Omit<Service, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    return upsert(db.services, service, 'svc');
  },

  createLessons(db: DemoDB, viewer: Profile, lessons: NewLesson[]): Lesson[] {
    requireAdmin(viewer);
    const created = lessons.map((l) => ({ ...l, id: newId('les'), status: 'scheduled' as const }));
    db.lessons.push(...created);
    return created;
  },

  rescheduleLesson(db: DemoDB, viewer: Profile, id: string, start: string, end: string) {
    requireAdmin(viewer);
    const lesson = db.lessons.find((l) => l.id === id);
    if (!lesson) throw new Error('Lesson not found');
    if (lesson.status !== 'scheduled') throw new Error('Only scheduled lessons can be moved.');
    lesson.start = start;
    lesson.end = end;
  },

  cancelLesson(
    db: DemoDB,
    viewer: Profile,
    id: string,
    reason: string,
    waiveFee = false,
    now = new Date(),
  ): CancellationOutcome {
    const lesson = db.lessons.find((l) => l.id === id);
    if (!lesson || !canSeeLesson(db, viewer, lesson)) throw new Error('Lesson not found');
    if (lesson.status !== 'scheduled') throw new Error('This lesson can no longer be cancelled.');
    if (viewer.role === 'student') throw new AccessError('Ask a parent to cancel lessons.');
    // Only the business can waive a late-cancellation fee; tutors cancelling are never charged to the family.
    const waive = viewer.role === 'admin' ? waiveFee : viewer.role === 'tutor';
    const outcome = cancellationOutcome(lesson, now, db.settings, { waiveFee: waive });
    lesson.status = outcome.status;
    lesson.cancelledAt = now.toISOString();
    lesson.cancelReason = reason;
    if (outcome.chargeable) applyCharges(db, lesson);
    return outcome;
  },

  completeLesson(db: DemoDB, viewer: Profile, input: CompleteLessonInput, now = new Date()) {
    const lesson = db.lessons.find((l) => l.id === input.lessonId);
    if (!lesson) throw new Error('Lesson not found');
    if (!(viewer.role === 'admin' || (viewer.role === 'tutor' && lesson.tutorId === viewer.tutorId))) {
      throw new AccessError('Only the lesson’s tutor can complete it.');
    }
    if (lesson.status !== 'scheduled') throw new Error('This lesson has already been recorded.');

    lesson.status = input.status;
    db.notes = db.notes.filter((n) => n.lessonId !== lesson.id);
    db.notes.push({
      lessonId: lesson.id,
      summary: input.summary.trim(),
      privateNote: input.privateNote?.trim() || undefined,
      topicIds: input.topicIds,
      attendance: input.attendance,
      createdAt: now.toISOString(),
    });
    for (const r of input.ratings) {
      if (!lesson.studentIds.includes(r.studentId)) continue;
      db.ratings.push({ id: newId('rat'), lessonId: lesson.id, ratedAt: lesson.start, ...r });
    }
    for (const h of input.homework) {
      if (!lesson.studentIds.includes(h.studentId) || !h.title.trim()) continue;
      db.homework.push({
        id: newId('hw'),
        lessonId: lesson.id,
        studentId: h.studentId,
        title: h.title.trim(),
        dueDate: h.dueDate,
        done: false,
        details: h.details?.trim() || undefined,
        attachments: h.attachments ?? [],
        tutorId: lesson.tutorId,
        createdAt: now.toISOString(),
      });
    }
    applyCharges(db, lesson, input.attendance);
  },

  setHomeworkDone(db: DemoDB, viewer: Profile, id: string, done: boolean) {
    const hw = db.homework.find((h) => h.id === id);
    if (!hw || !visibleStudentIds(db, viewer).has(hw.studentId)) throw new Error('Homework not found');
    hw.done = done;
  },

  sellPackage(
    db: DemoDB,
    viewer: Profile,
    pkg: Omit<LessonPackage, 'id' | 'lessonsUsed' | 'purchasedAt'>,
    now = new Date(),
  ): Invoice {
    requireAdmin(viewer);
    const created: LessonPackage = { ...pkg, id: newId('pkg'), lessonsUsed: 0, purchasedAt: toDateKey(now) };
    db.packages.push(created);
    return addInvoice(db, created.familyId, [
      { description: `${created.name} (${created.lessonsTotal} lessons)`, quantity: 1, unitPrice: created.price, packageId: created.id },
    ], now);
  },

  invoiceUnbilled(db: DemoDB, viewer: Profile, familyId: string, now = new Date()): Invoice | null {
    requireAdmin(viewer);
    const charges = db.charges.filter((c) => c.familyId === familyId && c.status === 'unbilled');
    if (charges.length === 0) return null;
    const invoice = addInvoice(db, familyId, itemsFromCharges(charges), now);
    for (const c of charges) {
      c.status = 'invoiced';
      c.invoiceId = invoice.id;
    }
    return invoice;
  },

  setInvoiceStatus(db: DemoDB, viewer: Profile, id: string, status: InvoiceStatus) {
    requireAdmin(viewer);
    const invoice = db.invoices.find((i) => i.id === id);
    if (!invoice) throw new Error('Invoice not found');
    invoice.status = status;
    if (status === 'void') {
      // Voiding releases the charges so they can be billed again.
      for (const c of db.charges) {
        if (c.invoiceId === id) {
          c.status = 'unbilled';
          c.invoiceId = undefined;
        }
      }
    }
  },

  recordPayment(
    db: DemoDB,
    viewer: Profile,
    invoiceId: string,
    amount: number,
    method: PaymentMethod,
    reference?: string,
    now = new Date(),
  ) {
    const invoice = db.invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    // Families may only pay by card (in production this is done by the Stripe webhook).
    if (viewer.role !== 'admin' && !(method === 'card' && canSeeFamily(db, viewer, invoice.familyId))) {
      throw new AccessError('Not allowed');
    }
    if (amount <= 0) throw new Error('Amount must be positive');
    invoice.payments.push({ id: newId('pay'), invoiceId, amount, method, reference, paidAt: now.toISOString() });
    if (invoiceTotals(invoice).balance <= 0) invoice.status = 'paid';
  },
};

// ---------------------------------------------------------------------------
// Subjects: enrolments and shared topic lists (mirrors 20261007000000_subjects.sql)
// ---------------------------------------------------------------------------

/** Trims and collapses inner spaces; blank becomes undefined (as the database's tidying does). */
export function tidy(v?: string): string | undefined {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/** Mirrors public.syllabus_enrolment: the Maths enrolment a legacy syllabus id stands for. */
export function syllabusEnrolment(syllabusId: string, curriculum?: string): Pick<Enrolment, 'subject' | 'curriculum' | 'level' | 'examBoard' | 'syllabusId'> {
  const s = SYLLABUSES.find((x) => x.id === syllabusId);
  const legacy = tidy(curriculum);
  return {
    subject: s?.subject ?? 'Maths',
    curriculum: s?.curriculum ?? (legacy === 'IB' ? 'IB DP' : legacy),
    level: s?.level,
    examBoard: s?.examBoard,
    syllabusId,
  };
}

/** The shared list for a subject, curriculum and level, if one exists. */
export function topicListFor(db: DemoDB, e: Pick<Enrolment, 'subject' | 'curriculum' | 'level'>): TopicList | undefined {
  const key = topicListKey(e.subject, e.curriculum, e.level);
  return db.topicLists.find((l) => topicListKey(l.subject, l.curriculum, l.level) === key);
}

/** Mirrors the enrolments_write trigger: link an enrolment without a list to the matching shared list. */
export function linkList<T extends Enrolment>(db: DemoDB, e: T): T {
  if (!e.topicListId) {
    const list = topicListFor(db, e);
    if (list) e.topicListId = list.id;
  }
  return e;
}

const sameKey = (a: Pick<Enrolment, 'subject' | 'curriculum' | 'level'>, b: Pick<Enrolment, 'subject' | 'curriculum' | 'level'>) =>
  topicListKey(a.subject, a.curriculum, a.level) === topicListKey(b.subject, b.curriculum, b.level);

/**
 * A copy of an enrolment with the custom rates the viewer may not see removed. Mirrors the RLS on
 * enrolment_tutor_pay (admin and the enrolment's tutor) and enrolment_family_price (admin and the family).
 */
function withVisibleRates(db: DemoDB, viewer: Profile, e: Enrolment): Enrolment {
  const copy: Enrolment = { ...e };
  if (viewer.role === 'admin') return copy;
  const ownTutor = viewer.role === 'tutor' && !!viewer.tutorId && e.tutorId === viewer.tutorId;
  if (!ownTutor) {
    delete copy.tutorPay;
    delete copy.tutorPaySource;
  }
  const family =
    viewer.role === 'parent' && !!viewer.familyId && db.students.some((s) => s.id === e.studentId && s.familyId === viewer.familyId);
  if (!family) delete copy.familyPrice;
  return copy;
}

export const enr = {
  /** Copies, with the custom rates stripped to what the viewer may see. */
  enrolments(db: DemoDB, viewer: Profile, studentId?: string): Enrolment[] {
    const ids = visibleStudentIds(db, viewer);
    return db.enrolments
      .filter((e) => ids.has(e.studentId) && (!studentId || e.studentId === studentId))
      .sort((a, b) => a.subject.localeCompare(b.subject))
      .map((e) => withVisibleRates(db, viewer, e));
  },

  /** Admins only. The same rules as validateEnrolments and the partial unique index on active enrolments. */
  saveEnrolment(db: DemoDB, viewer: Profile, draft: EnrolmentDraft & { studentId: string }, now = new Date()): Enrolment {
    requireAdmin(viewer);
    const subject = tidy(draft.subject);
    if (!subject) throw new Error('Please choose a subject for every row.');
    const curriculum = tidy(draft.curriculum);
    const level = tidy(draft.level);
    const examBoard = tidy(draft.examBoard);
    if (subject.length > 80 || (curriculum?.length ?? 0) > 80 || (level?.length ?? 0) > 80 || (examBoard?.length ?? 0) > 80) {
      throw new Error('Please shorten the subject, curriculum, level or exam board.');
    }
    if (!db.students.some((s) => s.id === draft.studentId)) throw new Error('Student not found');
    const next = { subject, curriculum, level };
    if (
      draft.active &&
      db.enrolments.some((e) => e.active && e.id !== draft.id && e.studentId === draft.studentId && sameKey(e, next))
    ) {
      throw new Error(`${subject} is listed twice. Please remove one.`);
    }
    const existing = draft.id ? db.enrolments.find((e) => e.id === draft.id) : undefined;
    const saved: Enrolment = {
      id: existing?.id ?? draft.id ?? newId('enr'),
      studentId: draft.studentId,
      subject,
      curriculum,
      level,
      examBoard,
      tutorId: draft.tutorId || undefined,
      syllabusId: tidy(draft.syllabusId),
      // The server owns the list: kept while the subject, curriculum and level stay the same.
      topicListId: existing && sameKey(existing, next) ? existing.topicListId : undefined,
      active: draft.active,
      createdAt: existing?.createdAt ?? now.toISOString(),
    };
    linkList(db, saved);
    // A new tutor starts on their usual rate: changing the tutor removes the custom pay (the family price stays).
    if (existing && (existing.tutorId ?? null) !== (saved.tutorId ?? null)) {
      delete existing.tutorPay;
      delete existing.tutorPaySource;
    }
    if (existing) Object.assign(existing, saved);
    else db.enrolments.push(saved);
    return existing ?? saved;
  },

  /** Admins only. Mirrors public.set_enrolment_rates: null clears a rate. */
  setEnrolmentRates(db: DemoDB, viewer: Profile, input: { enrolmentId: string; tutorPay: number | null; familyPrice: number | null }): void {
    requireAdmin(viewer);
    const e = db.enrolments.find((x) => x.id === input.enrolmentId);
    if (!e) throw new Error('Subject not found');
    const round = (v: number | null) => (v === null || v === undefined ? null : roundMoney(v));
    const pay = round(input.tutorPay);
    const price = round(input.familyPrice);
    const negative = (v: number | null) => v !== null && !(Number.isFinite(v) && v >= 0);
    if (negative(pay) || negative(price)) throw new Error('Please enter a rate of zero or more.');
    if ((pay ?? 0) >= 100000 || (price ?? 0) >= 100000) throw new Error('Please enter a rate below 100,000.');
    if (pay !== null && !e.tutorId) throw new Error('Please choose a tutor for this subject before setting their pay.');

    if (pay === null) {
      delete e.tutorPay;
      delete e.tutorPaySource;
    } else {
      // An unchanged pay keeps its source, so pay set by awarding an opportunity stays marked as such.
      const unchanged = e.tutorPay === pay && !!e.tutorPaySource;
      e.tutorPaySource = unchanged ? e.tutorPaySource : 'custom';
      e.tutorPay = pay;
    }
    if (price === null) delete e.familyPrice;
    else e.familyPrice = price;
  },

  topicLists: (db: DemoDB) => [...db.topicLists].sort((a, b) => a.name.localeCompare(b.name)),
  topics: (db: DemoDB, listId?: string) =>
    db.topics.filter((t) => !listId || t.listId === listId).sort((a, b) => a.listId.localeCompare(b.listId) || a.sort - b.sort),

  /** Mirrors public.add_topic. */
  addTopic(db: DemoDB, viewer: Profile, input: { enrolmentId: string; name: string; unit?: string }, now = new Date()): Topic {
    const e = db.enrolments.find((x) => x.id === input.enrolmentId);
    const me = viewer.tutorId;
    const allowed =
      !!e &&
      (viewer.role === 'admin' ||
        (viewer.role === 'tutor' &&
          !!me &&
          (e.tutorId === me ||
            db.lessons.some(
              (l) =>
                l.tutorId === me &&
                l.studentIds.includes(e.studentId) &&
                l.status !== 'cancelled' &&
                (!l.subject?.trim() || sameSubject(l.subject, e.subject)),
            ))));
    if (!e || !allowed) throw new AccessError('You can add topics only for students you teach');
    const name = tidy(input.name) ?? '';
    const unit = tidy(input.unit);
    if (name.length < 1 || name.length > 200) throw new Error('Please enter a topic name of up to 200 characters');
    if ((unit?.length ?? 0) > 120) throw new Error('Please enter a unit name of up to 120 characters');

    let list = topicListFor(db, e);
    if (!list) {
      list = {
        id: newId('tl'),
        subject: e.subject,
        curriculum: e.curriculum,
        level: e.level,
        name: enrolmentTitle(e),
        createdAt: now.toISOString(),
      };
      db.topicLists.push(list);
    }
    for (const other of db.enrolments) if (!other.topicListId && sameKey(other, e)) other.topicListId = list.id;

    const same = db.topics.find(
      (t) => t.listId === list.id && (t.unit ?? '').toLowerCase() === (unit ?? '').toLowerCase() && t.name.toLowerCase() === name.toLowerCase(),
    );
    if (same) return same;
    const sort = Math.max(0, ...db.topics.filter((t) => t.listId === list.id).map((t) => t.sort)) + 1;
    const topic: Topic = { id: newId('top'), listId: list.id, unit, name, sort, createdAt: now.toISOString() };
    db.topics.push(topic);
    return topic;
  },
};

/** Whether a lesson counts towards an enrolment: same subject, or no subject when the student studies only one. */
export function lessonCountsFor(db: DemoDB, lesson: Lesson, e: Enrolment): boolean {
  if (!lesson.studentIds.includes(e.studentId)) return false;
  if (lesson.subject?.trim()) return sameSubject(lesson.subject, e.subject);
  return db.enrolments.filter((o) => o.active && o.studentId === e.studentId).length === 1;
}

function addInvoice(db: DemoDB, familyId: string, items: Invoice['items'], now: Date): Invoice {
  const invoice: Invoice = { ...newInvoiceDraft(familyId, items, db.settings, now), id: newId('inv'), status: 'sent' };
  db.settings.nextInvoiceNumber += 1;
  db.invoices.push(invoice);
  return invoice;
}

/** Create charges for a lesson that has happened (or was late-cancelled) and draw package credits. */
export function applyCharges(db: DemoDB, lesson: Lesson, attendance: CompleteLessonInput['attendance'] = {}) {
  const service = db.services.find((s) => s.id === lesson.serviceId);
  if (!service) return;
  const { charges, packageDraws } = chargesForLesson(
    lesson,
    service,
    db.students,
    db.packages,
    db.settings,
    attendance,
    db.enrolments,
  );
  for (const c of charges) db.charges.push({ ...c, id: newId('chg') });
  for (const pid of packageDraws) {
    const p = db.packages.find((x) => x.id === pid);
    if (p) p.lessonsUsed += 1;
  }
}
