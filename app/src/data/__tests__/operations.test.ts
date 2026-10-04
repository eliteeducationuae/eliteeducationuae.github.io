import { tutorInvoiceTotal } from '@/domain/tutor-pay';

import { AccessError } from '../demo/db';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 4, 12, 0);
const who = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;

describe('seeded operations data', () => {
  const db = createSeed(NOW);
  it('has roles with bids, invoices in several states, a report round and expenses', () => {
    expect(db.opportunities.filter((o) => o.status === 'open')).toHaveLength(2);
    expect(new Set(db.tutorInvoices.map((i) => i.status))).toEqual(new Set(['paid', 'submitted']));
    expect(db.reports.length).toBeGreaterThan(3);
    expect(db.expenses.length).toBeGreaterThanOrEqual(5);
  });
  it('never double-claims a lesson across invoices', () => {
    const ids = db.tutorInvoices.flatMap((i) => i.items.map((x) => x.lessonId).filter(Boolean));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('roles & bids (mirror place_bid / award_opportunity)', () => {
  it('lets tutors bid on visible roles and admins award one', () => {
    const db = createSeed(NOW);
    const tutor = who(db, 'tutor'); // Sarah
    const visible = ops.opportunities(db, tutor);
    expect(visible.every((o) => o.status === 'open' || o.awardedTutorId === 't-sarah' || db.bids.some((b) => b.opportunityId === o.id && b.tutorId === 't-sarah'))).toBe(true);
    const ia = db.opportunities.find((o) => o.title.startsWith('IGCSE Physics'))!;
    ops.placeBid(db, tutor, ia.id, 'I would be pleased to teach this student.', undefined, NOW);
    expect(() => ops.awardOpportunity(db, tutor, db.bids[db.bids.length - 1].id)).toThrow(AccessError);
    ops.awardOpportunity(db, who(db, 'admin'), db.bids[db.bids.length - 1].id, NOW);
    expect(ia).toMatchObject({ status: 'awarded', awardedTutorId: 't-sarah' });
    expect(() => ops.placeBid(db, tutor, ia.id, 'again', undefined, NOW)).toThrow('closed');
  });
  it('hides invite-only roles and blocks parents', () => {
    const db = createSeed(NOW);
    ops.saveOpportunity(db, who(db, 'admin'), { title: 'Secret', payRate: 200, visibility: 'invited', invitedTutorIds: ['t-james'] }, NOW);
    expect(ops.opportunities(db, who(db, 'tutor')).some((o) => o.title === 'Secret')).toBe(false);
    expect(ops.opportunities(db, who(db, 'parent'))).toEqual([]);
  });
});

describe('tutor invoices and bank details', () => {
  it('runs draft → submitted → approved → paid', () => {
    const db = createSeed(NOW);
    const tutor = who(db, 'tutor');
    const admin = who(db, 'admin');
    const id = ops.createTutorInvoice(db, tutor, 't-sarah', '2026-10-01', NOW);
    const inv = db.tutorInvoices.find((i) => i.id === id)!;
    const lessonsTotal = tutorInvoiceTotal(inv.items);
    ops.updateTutorInvoice(db, tutor, id, [{ description: 'Workshop', quantity: 1, unitPrice: 300 }]);
    expect(tutorInvoiceTotal(inv.items)).toBe(lessonsTotal + 300);
    ops.submitTutorInvoice(db, tutor, id, NOW);
    expect(() => ops.updateTutorInvoice(db, tutor, id, [])).toThrow('can’t be edited');
    expect(() => ops.markTutorInvoicePaid(db, admin, id, 'x')).toThrow('approved');
    ops.reviewTutorInvoice(db, admin, id, true);
    ops.markTutorInvoicePaid(db, admin, id, 'FT1');
    expect(inv.status).toBe('paid');
  });
  it('keeps bank details private and checks the IBAN', () => {
    const db = createSeed(NOW);
    const tutor = who(db, 'tutor');
    expect(() => ops.paymentDetails(db, tutor, 't-james')).toThrow(AccessError);
    expect(() => ops.savePaymentDetails(db, tutor, { tutorId: 't-sarah', accountName: 'S', bankName: 'B', iban: 'AE00 1234' })).toThrow('IBAN');
    expect(ops.paymentDetails(db, who(db, 'admin'), 't-sarah')?.iban).toBe('AE070331234567890123456');
  });
});

describe('reports', () => {
  it('only shows parents published reports', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    expect(ops.reports(db, parent)).toEqual([]);
    const layla = db.reports.find((r) => r.studentId === 's-layla' && r.subject === 'Maths')!;
    ops.setReportStatus(db, who(db, 'admin'), layla.id, 'published', NOW);
    expect(ops.reports(db, parent).map((r) => r.studentId)).toEqual(['s-layla']);
  });
});
