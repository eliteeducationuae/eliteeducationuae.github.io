import { chargesForLesson, invoiceTotals, itemsFromCharges, newInvoiceDraft } from '@/domain/billing';
import { toDateKey } from '@/domain/dates';
import { cancellationOutcome, type CancellationOutcome } from '@/domain/scheduling';
import type {
  Charge,
  Family,
  Homework,
  Invoice,
  InvoiceStatus,
  Lesson,
  LessonNote,
  LessonPackage,
  PaymentMethod,
  Profile,
  Service,
  Settings,
  Student,
  Tutor,
  TopicRating,
} from '@/domain/types';

import type { CompleteLessonInput, NewLesson } from '../source';

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
}

export const DEMO_DB_VERSION = 1;

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
      return new Set(db.lessons.filter((l) => l.tutorId === viewer.tutorId).flatMap((l) => l.studentIds));
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

function requireAdmin(viewer: Profile) {
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
  homework(db: DemoDB, viewer: Profile, studentId?: string): Homework[] {
    const ids = visibleStudentIds(db, viewer);
    return db.homework.filter((h) => ids.has(h.studentId) && (!studentId || h.studentId === studentId));
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
    return upsert(db.families, family, 'fam');
  },
  saveStudent(db: DemoDB, viewer: Profile, student: Omit<Student, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    return upsert(db.students, student, 'stu');
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
      db.homework.push({ id: newId('hw'), lessonId: lesson.id, done: false, ...h, title: h.title.trim() });
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
  const { charges, packageDraws } = chargesForLesson(lesson, service, db.students, db.packages, db.settings, attendance);
  for (const c of charges) db.charges.push({ ...c, id: newId('chg') });
  for (const pid of packageDraws) {
    const p = db.packages.find((x) => x.id === pid);
    if (p) p.lessonsUsed += 1;
  }
}
