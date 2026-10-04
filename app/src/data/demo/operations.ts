import { toDateKey } from '@/domain/dates';
import { monthBounds, normaliseIban, isValidIban, tutorInvoiceLines, tutorInvoiceNumber } from '@/domain/tutor-pay';
import type { Expense, Opportunity, PaymentDetails, Profile, ReportStatus, StudentReport, TutorInvoiceItem } from '@/domain/types';

import type { NewOpportunity, NewTutorApplication, ReportFields } from '../source';
import { AccessError, newId, requireAdmin, type DemoDB } from './db';

/** Demo versions of roles, hiring, tutor pay, reports and expenses. Each mirrors a database function or policy. */

function canSeeOpportunity(db: DemoDB, viewer: Profile, o: Opportunity): boolean {
  if (viewer.role === 'admin') return true;
  if (!viewer.tutorId) return false;
  return (
    (o.status === 'open' && (o.visibility === 'all' || o.invitedTutorIds.includes(viewer.tutorId))) ||
    o.awardedTutorId === viewer.tutorId ||
    db.bids.some((b) => b.opportunityId === o.id && b.tutorId === viewer.tutorId)
  );
}

const isStaffTutor = (viewer: Profile, tutorId: string) => viewer.role === 'admin' || viewer.tutorId === tutorId;

export const ops = {
  opportunities: (db: DemoDB, viewer: Profile) => db.opportunities.filter((o) => canSeeOpportunity(db, viewer, o)),
  bids: (db: DemoDB, viewer: Profile) => db.bids.filter((b) => viewer.role === 'admin' || b.tutorId === viewer.tutorId),

  saveOpportunity(db: DemoDB, viewer: Profile, o: NewOpportunity & { id?: string; status?: Opportunity['status'] }, now = new Date()): Opportunity {
    requireAdmin(viewer);
    if (!o.title.trim()) throw new Error('Give the role a title');
    const existing = o.id ? db.opportunities.find((x) => x.id === o.id) : undefined;
    if (existing) {
      Object.assign(existing, o);
      return existing;
    }
    const created: Opportunity = { ...o, id: newId('opp'), createdAt: now.toISOString(), status: o.status ?? 'open' };
    db.opportunities.push(created);
    return created;
  },
  placeBid(db: DemoDB, viewer: Profile, opportunityId: string, pitch: string, availability?: string, now = new Date()) {
    if (!viewer.tutorId) throw new AccessError('Only tutors can express interest');
    const o = db.opportunities.find((x) => x.id === opportunityId);
    if (!o || !canSeeOpportunity(db, viewer, o)) throw new Error('Opportunity not found');
    if (o.status !== 'open' || (o.closesOn && o.closesOn < toDateKey(now))) throw new Error('This opportunity has closed');
    if (!pitch.trim()) throw new Error('Tell us why you’d be a great fit');
    const existing = db.bids.find((b) => b.opportunityId === o.id && b.tutorId === viewer.tutorId);
    if (existing) Object.assign(existing, { pitch: pitch.trim(), availability: availability?.trim() || undefined, status: 'pending', createdAt: now.toISOString() });
    else db.bids.push({ id: newId('bid'), createdAt: now.toISOString(), opportunityId: o.id, tutorId: viewer.tutorId, pitch: pitch.trim(), availability: availability?.trim() || undefined, status: 'pending' });
  },
  withdrawBid(db: DemoDB, viewer: Profile, opportunityId: string) {
    const b = db.bids.find((x) => x.opportunityId === opportunityId && x.tutorId === viewer.tutorId && x.status === 'pending');
    if (!b) throw new Error('Nothing to withdraw');
    b.status = 'withdrawn';
  },
  awardOpportunity(db: DemoDB, viewer: Profile, bidId: string, now = new Date()) {
    requireAdmin(viewer);
    const b = db.bids.find((x) => x.id === bidId);
    if (!b || b.status !== 'pending') throw new Error('That bid is no longer available');
    const o = db.opportunities.find((x) => x.id === b.opportunityId)!;
    if (o.status !== 'open') throw new Error('This opportunity has already been awarded or closed');
    Object.assign(o, { status: 'awarded', awardedTutorId: b.tutorId, awardedAt: now.toISOString() });
    b.status = 'awarded';
    for (const other of db.bids) if (other.opportunityId === o.id && other.id !== b.id && other.status === 'pending') other.status = 'declined';
  },

  submitApplication(db: DemoDB, a: NewTutorApplication, now = new Date()) {
    if (!a.fullName.trim()) throw new Error('Please enter your name');
    if (!a.email.includes('@')) throw new Error('Please enter a valid email address');
    db.applications.push({ ...a, id: newId('app'), createdAt: now.toISOString(), fullName: a.fullName.trim(), email: a.email.trim().toLowerCase(), status: 'applied' });
  },
  applications(db: DemoDB, viewer: Profile) {
    requireAdmin(viewer);
    return db.applications;
  },
  updateApplication(db: DemoDB, viewer: Profile, id: string, patch: Partial<DemoDB['applications'][number]>) {
    requireAdmin(viewer);
    const a = db.applications.find((x) => x.id === id);
    if (!a) throw new Error('Application not found');
    Object.assign(a, patch);
  },

  paymentDetails(db: DemoDB, viewer: Profile, tutorId: string): PaymentDetails | null {
    if (!isStaffTutor(viewer, tutorId)) throw new AccessError('Not allowed');
    return db.paymentDetails.find((p) => p.tutorId === tutorId) ?? null;
  },
  savePaymentDetails(db: DemoDB, viewer: Profile, d: Omit<PaymentDetails, 'updatedAt'>, now = new Date()) {
    if (!isStaffTutor(viewer, d.tutorId)) throw new AccessError('Not allowed');
    const iban = normaliseIban(d.iban);
    if (!isValidIban(iban)) throw new Error('That IBAN doesn’t look right — please check it');
    if (!d.accountName.trim() || !d.bankName.trim()) throw new Error('Add the account name and bank');
    db.paymentDetails = db.paymentDetails.filter((p) => p.tutorId !== d.tutorId);
    db.paymentDetails.push({ ...d, iban, swift: d.swift?.trim().toUpperCase() || undefined, updatedAt: now.toISOString() });
  },

  tutorInvoices: (db: DemoDB, viewer: Profile) => db.tutorInvoices.filter((i) => isStaffTutor(viewer, i.tutorId)),
  createTutorInvoice(db: DemoDB, viewer: Profile, tutorId: string, month: string, now = new Date()): string {
    if (!isStaffTutor(viewer, tutorId)) throw new AccessError('Not allowed');
    const tutor = db.tutors.find((t) => t.id === tutorId)!;
    const m = new Date(`${month.slice(0, 7)}-01T12:00:00`);
    const { start, end } = monthBounds(m);
    let inv = db.tutorInvoices.find((i) => i.tutorId === tutorId && i.periodStart === start);
    if (inv && inv.status !== 'draft' && inv.status !== 'rejected') throw new Error('This month’s invoice has already been submitted');
    if (!inv) {
      inv = { id: newId('ti'), createdAt: now.toISOString(), tutorId, number: tutorInvoiceNumber(tutorId, m), periodStart: start, periodEnd: end, status: 'draft', items: [] };
      db.tutorInvoices.push(inv);
    }
    const onOther = new Set(
      db.tutorInvoices.filter((i) => i.id !== inv!.id).flatMap((i) => i.items.map((x) => x.lessonId).filter((x): x is string => !!x)),
    );
    const lines = tutorInvoiceLines(tutor, db.lessons, db.services, db.students, m, db.settings, onOther);
    inv.items = [...lines, ...inv.items.filter((i) => !i.lessonId)];
    inv.status = 'draft';
    return inv.id;
  },
  updateTutorInvoice(db: DemoDB, viewer: Profile, id: string, extras: Omit<TutorInvoiceItem, 'lessonId'>[], notes?: string) {
    const inv = db.tutorInvoices.find((i) => i.id === id && isStaffTutor(viewer, i.tutorId));
    if (!inv) throw new Error('Invoice not found');
    if (inv.status !== 'draft' && inv.status !== 'rejected') throw new Error('Submitted invoices can’t be edited');
    for (const e of extras) {
      if (!e.description.trim() || !(e.quantity > 0) || !(e.unitPrice >= 0)) throw new Error('Each extra line needs a description, a quantity and a price');
    }
    inv.items = [...inv.items.filter((i) => i.lessonId), ...extras.map((e) => ({ ...e, description: e.description.trim() }))];
    inv.notes = notes?.trim() || undefined;
  },
  submitTutorInvoice(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const inv = db.tutorInvoices.find((i) => i.id === id && i.tutorId === viewer.tutorId);
    if (!inv) throw new AccessError('Invoice not found');
    if (inv.status !== 'draft' && inv.status !== 'rejected') throw new Error('This invoice has already been submitted');
    if (inv.items.length === 0) throw new Error('There’s nothing on this invoice yet');
    Object.assign(inv, { status: 'submitted', submittedAt: now.toISOString(), adminComment: undefined });
  },
  reviewTutorInvoice(db: DemoDB, viewer: Profile, id: string, approve: boolean, comment?: string, now = new Date()) {
    requireAdmin(viewer);
    const inv = db.tutorInvoices.find((i) => i.id === id);
    if (!inv || inv.status !== 'submitted') throw new Error('Only submitted invoices can be reviewed');
    Object.assign(inv, { status: approve ? 'approved' : 'rejected', approvedAt: approve ? now.toISOString() : undefined, adminComment: comment?.trim() || undefined });
  },
  markTutorInvoicePaid(db: DemoDB, viewer: Profile, id: string, reference?: string, now = new Date()) {
    requireAdmin(viewer);
    const inv = db.tutorInvoices.find((i) => i.id === id);
    if (!inv || inv.status !== 'approved') throw new Error('Only approved invoices can be marked paid');
    Object.assign(inv, { status: 'paid', paidAt: now.toISOString(), paymentReference: reference?.trim() || undefined });
  },

  reports(db: DemoDB, viewer: Profile): StudentReport[] {
    if (viewer.role === 'admin') return db.reports;
    if (viewer.role === 'tutor') return db.reports.filter((r) => r.tutorId === viewer.tutorId);
    const mine = new Set(db.students.filter((s) => (viewer.role === 'parent' ? s.familyId === viewer.familyId : s.id === viewer.studentId)).map((s) => s.id));
    return db.reports.filter((r) => r.status === 'published' && mine.has(r.studentId));
  },
  openReportCycle(db: DemoDB, viewer: Profile, name: string, startsOn: string, dueDate: string, now = new Date()) {
    requireAdmin(viewer);
    const cycleId = newId('cyc');
    db.reportCycles.push({ id: cycleId, createdAt: now.toISOString(), name: name.trim(), startsOn, dueDate, status: 'open' });
    const counts = new Map<string, Map<string, number>>();
    for (const l of db.lessons) {
      if (l.start < startsOn || !['completed', 'no-show', 'scheduled'].includes(l.status)) continue;
      for (const sid of l.studentIds) {
        const m = counts.get(sid) ?? new Map<string, number>();
        m.set(l.tutorId, (m.get(l.tutorId) ?? 0) + 1);
        counts.set(sid, m);
      }
    }
    for (const [studentId, tutors] of counts) {
      const tutorId = [...tutors.entries()].sort((a, b) => b[1] - a[1])[0][0];
      db.reports.push({ id: newId('rep'), cycleId, studentId, tutorId, status: 'draft', aiAssisted: false, updatedAt: now.toISOString() });
    }
  },
  saveReport(db: DemoDB, viewer: Profile, id: string, f: ReportFields, now = new Date()) {
    const r = db.reports.find((x) => x.id === id && isStaffTutor(viewer, x.tutorId));
    if (!r) throw new AccessError('Report not found');
    if (r.status === 'published' || (viewer.role !== 'admin' && r.status !== 'draft' && r.status !== 'submitted')) throw new Error('This report can no longer be edited');
    Object.assign(r, {
      attainment: f.attainment?.trim() || undefined,
      effort: f.effort,
      progress: f.progress,
      strengths: f.strengths?.trim() || undefined,
      nextSteps: f.nextSteps?.trim() || undefined,
      comment: f.comment?.trim() || undefined,
      aiAssisted: r.aiAssisted || !!f.aiAssisted,
      updatedAt: now.toISOString(),
    });
  },
  submitReport(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const r = db.reports.find((x) => x.id === id && isStaffTutor(viewer, x.tutorId));
    if (!r) throw new AccessError('Report not found');
    if (r.status !== 'draft') throw new Error('This report has already been submitted');
    if (!r.comment || !r.effort || !r.progress) throw new Error('Add effort, progress and a comment before submitting');
    Object.assign(r, { status: 'submitted', submittedAt: now.toISOString() });
  },
  setReportStatus(db: DemoDB, viewer: Profile, id: string, status: ReportStatus, now = new Date()) {
    requireAdmin(viewer);
    const r = db.reports.find((x) => x.id === id);
    if (!r) throw new Error('Report not found');
    if (status === 'published' && r.status !== 'submitted' && r.status !== 'approved') throw new Error('Only finished reports can be published');
    Object.assign(r, { status, publishedAt: status === 'published' ? now.toISOString() : undefined });
  },

  expenses(db: DemoDB, viewer: Profile): Expense[] {
    requireAdmin(viewer);
    return db.expenses;
  },
  saveExpense(db: DemoDB, viewer: Profile, e: Omit<Expense, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    if (!e.category.trim() || !(e.amount >= 0)) throw new Error('Add a category and amount');
    const existing = e.id ? db.expenses.find((x) => x.id === e.id) : undefined;
    if (existing) Object.assign(existing, e);
    else db.expenses.push({ ...e, id: newId('exp') });
  },
  deleteExpense(db: DemoDB, viewer: Profile, id: string) {
    requireAdmin(viewer);
    db.expenses = db.expenses.filter((e) => e.id !== id);
  },
};
