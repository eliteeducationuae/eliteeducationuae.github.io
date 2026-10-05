import { SYLLABUSES } from '@/data/curriculum';
import type { AuditEvent } from '@/domain/audit';
import { chargesForLesson, invoiceTotals, itemsFromCharges, newInvoiceDraft, roundMoney } from '@/domain/billing';
import { toDateKey } from '@/domain/dates';
import { creditableLines, creditRemaining, formatCreditNoteNumber, normaliseTrn, planCreditNote, round2, type CreditNotePlan } from '@/domain/tax';
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
  AccountantInvite,
  CreditNote,
  Refund,
  TaxParty,
  // Tutor vetting and onboarding
  HandbookAcknowledgement,
  HandbookVersion,
  TutorDocument,
  VettingOverride,
  // Launch readiness
  AppErrorRow,
  DeletionRequest,
  FunctionErrorRow,
  Handover,
  LessonPlan,
} from '@/domain/types';

import type { CompleteLessonInput, NewLesson } from '../source';
// Admissions advisory
import type { AdmissionsStore } from './admissions';

import { syncPrimaryFromFamily } from './contacts';
import { assertCleared } from './vetting';

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
  // Tax: credit notes, refunds and accountant access. Optional because older saved databases lack them: read with `?? []`.
  creditNotes?: CreditNote[];
  refunds?: DemoRefund[];
  accountantInvites?: AccountantInvite[];
  // Admissions advisory. Optional and seeded lazily (see demo/admissions.ts) so saved databases need no migration.
  admissions?: AdmissionsStore;
  // Tutor vetting and onboarding. Optional because databases saved before it lack them: read with `?? []`.
  tutorDocuments?: TutorDocument[];
  vettingOverrides?: VettingOverride[];
  handbookVersions?: HandbookVersion[];
  handbookAcks?: HandbookAcknowledgement[];
  /** Block new lessons, students and roles for tutors who are not cleared. Off when absent. */
  vettingEnforced?: boolean;
  /** tutorId → when onboarding began (the application was marked hired). */
  tutorOnboarding?: Record<string, string>;
  // Launch readiness. Optional because databases saved before it lack them: created on first use.
  /** Errors reported by the app (mirrors public.app_errors). */
  appErrors?: AppErrorRow[];
  /** Errors recorded by Edge Functions (mirrors public.function_errors); always empty in the demo. */
  functionErrors?: FunctionErrorRow[];
  /** Account deletion requests (mirrors public.deletion_requests). */
  deletionRequests?: DeletionRequest[];
  /** Public form submissions for rate limiting (mirrors public.submission_log). Optional: read with `??= []`. */
  formSubmissions?: { kind: 'enquiry' | 'application'; email?: string; at: string }[];
  // Session plans and handover packs. Optional because databases saved before them lack the fields: read with `?? []`.
  lessonPlans?: LessonPlan[];
  handovers?: Handover[];
}

/** A refund as stored: the request key makes a retried refund return the first one (never shown to screens). */
export type DemoRefund = Refund & { requestKey?: string };

export interface OutboxMessage {
  id: string;
  createdAt: string;
  /** 'admins' mirrors notify_admins; 'tutor' mirrors notify_tutor (one message per login linked to the tutor). */
  audience: 'admins' | 'tutor';
  tutorId?: string;
  profileId?: string;
  subject: string;
  body: string;
  url?: string;
}

/** Mirrors public.notify_admins: queue a message for the office. */
export function notifyAdmins(db: DemoDB, subject: string, body: string, url?: string, now = new Date()) {
  (db.outbox ??= []).push({ id: newId('out'), createdAt: now.toISOString(), audience: 'admins', subject, body, url });
}

/** Mirrors public.notify_tutor: queue a message for each login linked to the tutor (tutor or admin role). */
export function notifyTutor(db: DemoDB, tutorId: string, subject: string, body: string, url?: string, now = new Date()) {
  for (const p of db.profiles.filter((x) => x.tutorId === tutorId && (x.role === 'tutor' || x.role === 'admin'))) {
    (db.outbox ??= []).push({ id: newId('out'), createdAt: now.toISOString(), audience: 'tutor', tutorId, profileId: p.id, subject, body, url });
  }
}

export const DEMO_DB_VERSION = 10;

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
    case 'accountant':
      // Accountants read the books only: no students, lessons or notes.
      return new Set();
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

/** Admins and accountants read every invoice, payment, credit note, refund, expense and tutor invoice. */
export function isFinanceReader(viewer: Profile): boolean {
  return viewer.role === 'admin' || viewer.role === 'accountant';
}

/** Read access to a family's money (invoices, charges, packages, credit notes, refunds). Writes still use canSeeFamily. */
function canReadFinance(db: DemoDB, viewer: Profile, familyId: string): boolean {
  return isFinanceReader(viewer) || canSeeFamily(db, viewer, familyId);
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
    // Accountants see every family (billing details are stripped by pay.stripBilling).
    if (isFinanceReader(viewer)) return db.families;
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
    return db.packages.filter((p) => canReadFinance(db, viewer, p.familyId) && (!familyId || p.familyId === familyId));
  },
  charges(db: DemoDB, viewer: Profile, familyId?: string): Charge[] {
    return db.charges.filter((c) => canReadFinance(db, viewer, c.familyId) && (!familyId || c.familyId === familyId));
  },
  invoices(db: DemoDB, viewer: Profile, familyId?: string): Invoice[] {
    return db.invoices
      .filter(
        (i) =>
          canReadFinance(db, viewer, i.familyId) &&
          (!familyId || i.familyId === familyId) &&
          // Families never see drafts.
          (isFinanceReader(viewer) || i.status !== 'draft'),
      )
      .map((i) => withTax(db, i));
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

  createLessons(db: DemoDB, viewer: Profile, lessons: NewLesson[], now = new Date()): Lesson[] {
    requireAdmin(viewer);
    // Tutor vetting and onboarding: new lessons only go to cleared tutors.
    for (const tutorId of new Set(lessons.map((l) => l.tutorId))) assertCleared(db, tutorId, 'lesson', now);
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

  setInvoiceStatus(db: DemoDB, viewer: Profile, id: string, status: InvoiceStatus, now = new Date()) {
    requireAdmin(viewer);
    const invoice = db.invoices.find((i) => i.id === id);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === status) return;
    // Tax: an issued invoice is a tax document. It is cancelled with a credit note and never reopened or redrafted.
    if (invoice.status === 'void') throw new Error('A cancelled invoice cannot be reopened.');
    if (status === 'draft') throw new Error('An issued tax invoice cannot be returned to draft. Issue a credit note instead.');
    if (status === 'void' && invoice.status !== 'draft') {
      // Mirrors invoices_cancel_with_credit_note: a closing credit note for everything not yet credited (per line, in
      // order, then any remainder on its own line), with the lessons released to be invoiced again. Only the lines whose
      // lesson is still on the invoice (and so is released below) are rebilled; package sales and ad hoc lines are credits.
      const notes = creditNotesOf(db).filter((n) => n.invoiceId === id);
      const target = creditRemaining(invoice, notes).net;
      if (target > 0) {
        const lines: { description: string; invoiceLine?: number; net: number }[] = [];
        let taken = 0;
        for (const l of creditableLines(invoice, notes)) {
          const rem = Math.min(l.remaining, round2(target - taken));
          if (rem > 0) {
            lines.push({ description: l.description, invoiceLine: l.index, net: rem });
            taken = round2(taken + rem);
          }
        }
        if (round2(target - taken) > 0) lines.push({ description: 'Invoice cancelled', net: round2(target - taken) });
        const rebilledLines = new Set<number>();
        invoice.items.forEach((item, k) => {
          if (item.chargeId && db.charges.some((c) => c.id === item.chargeId && c.invoiceId === id)) rebilledLines.add(k);
        });
        addCreditNote(db, invoice, planCreditNote(invoice, notes, lines), { reason: 'Invoice cancelled', rebilledLines, now });
      }
    }
    stampTaxDetails(db, invoice);
    invoice.status = status;
    if (status === 'void') {
      // Voiding releases the charges so they can be billed again.
      releaseCharges(db, id);
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
    // A family paying by card does so through Stripe (the webhook records it), so it can be refunded by card.
    const viaStripe = viewer.role !== 'admin' && method === 'card';
    invoice.payments.push({ id: newId('pay'), invoiceId, amount, method, reference, paidAt: now.toISOString(), ...(viaStripe ? { viaStripe } : {}) });
    if (invoice.status === 'sent' && invoiceTotals(withTax(db, invoice)).balance <= 0) invoice.status = 'paid';
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
    // Tutor vetting and onboarding: a new (or reactivated) student for a tutor needs their clearance.
    if (draft.active && draft.tutorId && (!existing || existing.tutorId !== draft.tutorId || !existing.active)) {
      assertCleared(db, draft.tutorId, 'enrolment', now);
    }
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
  stampTaxDetails(db, invoice);
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

// ---------------------------------------------------------------------------
// Tax: credit notes, refunds and accountant access (mirrors 20261105000000_tax.sql)
// ---------------------------------------------------------------------------

export const creditNotesOf = (db: DemoDB): CreditNote[] => (db.creditNotes ??= []);
export const refundsOf = (db: DemoDB): DemoRefund[] => (db.refunds ??= []);
export const accountantInvitesOf = (db: DemoDB): AccountantInvite[] => (db.accountantInvites ??= []);

/** A refund as screens see it (without the request key). */
export function publicRefund(r: DemoRefund): Refund {
  const { requestKey: _key, ...rest } = r;
  return rest;
}

/** The invoice with its credit notes (summaries) and refunds attached, as the invoice queries return it. */
export function withTax(db: DemoDB, invoice: Invoice): Invoice {
  const creditNotes = (db.creditNotes ?? [])
    .filter((n) => n.invoiceId === invoice.id)
    .map(({ id, number, issueDate, subtotal, vat, total, rebilled, rebilledNet }) => ({ id, number, issueDate, subtotal, vat, total, rebilled, rebilledNet }));
  const refunds = (db.refunds ?? []).filter((r) => r.invoiceId === invoice.id).map(publicRefund);
  return { ...invoice, creditNotes, refunds };
}

/** The business as printed on tax documents now. */
export function supplierSnapshot(settings: Settings): TaxParty {
  return {
    name: settings.legalName?.trim() || settings.businessName,
    ...(settings.registeredAddress?.trim() ? { address: settings.registeredAddress.trim() } : {}),
    ...(settings.trn ? { trn: normaliseTrn(settings.trn) } : {}),
    ...(settings.notifyEmail ? { email: settings.notifyEmail } : {}),
  };
}

/** The family as printed on tax documents now. */
export function customerSnapshot(family: Family | undefined): TaxParty | undefined {
  if (!family) return undefined;
  return {
    name: family.billingName?.trim() || family.parentName || family.name,
    ...(family.billingAddress?.trim() ? { address: family.billingAddress.trim() } : {}),
    ...(family.trn ? { trn: normaliseTrn(family.trn) } : {}),
    ...(family.email ? { email: family.email } : {}),
  };
}

/**
 * Mirrors invoices_snapshot_tax: when an invoice is issued, freeze the supplier and customer and set the date of supply
 * (the last lesson charged on it, otherwise the issue date). Kept if already set.
 */
export function stampTaxDetails(db: DemoDB, invoice: Invoice) {
  if (invoice.supplier) return;
  invoice.supplier = supplierSnapshot(db.settings);
  const customer = customerSnapshot(db.families.find((f) => f.id === invoice.familyId));
  if (!invoice.customer && customer) invoice.customer = customer;
  const chargeIds = new Set(invoice.items.map((i) => i.chargeId).filter(Boolean));
  const lessonDates = db.charges.filter((c) => chargeIds.has(c.id)).map((c) => toDateKey(new Date(c.date)));
  invoice.supplyDate ??= lessonDates.length ? lessonDates.sort()[lessonDates.length - 1] : invoice.issueDate;
}

/** Put an invoice's charges back to unbilled (all of them, or just those given). */
export function releaseCharges(db: DemoDB, invoiceId: string, only?: Set<string>) {
  for (const c of db.charges) {
    if (c.invoiceId === invoiceId && (!only || only.has(c.id))) {
      c.status = 'unbilled';
      c.invoiceId = undefined;
    }
  }
}

/**
 * Mirrors _make_credit_note: record a planned credit note against an invoice, numbered from settings (the counter only
 * ever goes up), with the invoice's frozen supplier and customer. Does not change the invoice (see settleInvoice).
 */
export function addCreditNote(
  db: DemoDB,
  invoice: Invoice,
  plan: CreditNotePlan,
  opts: { reason: string; rebilledLines?: Set<number>; now?: Date },
): CreditNote {
  const now = opts.now ?? new Date();
  // Mirrors _make_credit_note's p_rebilled_lines: lines crediting an invoice line whose lesson is released are rebilled.
  const lines = plan.lines.map((l) =>
    l.invoiceLine !== undefined && opts.rebilledLines?.has(l.invoiceLine) ? { ...l, rebilled: true } : l,
  );
  const rebilledNet = round2(lines.reduce((s, l) => s + (l.rebilled ? l.net : 0), 0));
  const family = db.families.find((f) => f.id === invoice.familyId);
  const note: CreditNote = {
    id: newId('cn'),
    number: formatCreditNoteNumber(db.settings.nextCreditNoteNumber),
    issueDate: toDateKey(now),
    subtotal: plan.subtotal,
    vat: plan.vat,
    total: plan.total,
    rebilled: rebilledNet > 0,
    rebilledNet,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    familyId: invoice.familyId,
    reason: opts.reason,
    vatRate: invoice.vatRate,
    lines,
    supplier: invoice.supplier ?? supplierSnapshot(db.settings),
    customer: invoice.customer ?? customerSnapshot(family),
    createdAt: now.toISOString(),
  };
  db.settings.nextCreditNoteNumber = (db.settings.nextCreditNoteNumber ?? 1) + 1;
  creditNotesOf(db).push(note);
  return note;
}

/**
 * Mirrors _tax_settle_invoice: after a credit note or refund, an invoice whose net is fully credited is cancelled
 * (its lessons released only when asked); a sent invoice with nothing left to pay is paid.
 */
export function settleInvoice(db: DemoDB, invoice: Invoice, releaseAll: boolean) {
  const subtotal = invoiceTotals({ ...invoice, payments: [] }).subtotal;
  const creditedNet = round2(creditNotesOf(db).filter((n) => n.invoiceId === invoice.id).reduce((s, n) => s + n.subtotal, 0));
  if ((invoice.status === 'sent' || invoice.status === 'paid') && subtotal > 0 && creditedNet >= subtotal) {
    invoice.status = 'void';
    if (releaseAll) releaseCharges(db, invoice.id);
  } else if (invoice.status === 'sent' && invoiceTotals(withTax(db, invoice)).balance <= 0) {
    invoice.status = 'paid';
  }
}
