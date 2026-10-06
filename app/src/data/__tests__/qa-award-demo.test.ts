import { awardSubject, awardSubjectChoices } from '@/domain/enrolments';
import { monthSeries } from '@/domain/finance';
import type { Profile } from '@/domain/types';

import { AccessError, type DemoDB } from '../demo/db';
import { ho } from '../demo/handover';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';
import { tax } from '../demo/tax';
import { SOURCE_ACCESS } from '../view-as';

/**
 * Mirrors 20261114000700_qa_award.sql: awarding a role always settles the subject, so the handover pack the winning
 * tutor is told about opens; and the accountant's monthly tutor-cost estimates.
 */

const NOW = new Date(2026, 9, 4, 12, 0);
const who = (db: DemoDB, role: string) => db.profiles.find((p) => p.role === role)!;
const james: Profile = {
  id: 'u-t-james',
  role: 'tutor',
  fullName: 'James',
  email: 'james@example.com',
  tutorId: 't-james',
};

function seed() {
  const db = createSeed(NOW);
  db.vettingEnforced = false;
  return db;
}

/** A seeded student with more than one active subject. */
function multiSubjectStudent(db: DemoDB) {
  const s = db.students.find((x) => db.enrolments.filter((e) => e.active && e.studentId === x.id).length > 1)!;
  expect(s).toBeDefined();
  return s;
}

/** What the demo source does when an admin awards a role. */
function award(db: DemoDB, bidId: string, subject?: string) {
  const before = ho.tutorBeforeAward(db, bidId, subject);
  ops.awardOpportunity(db, who(db, 'admin'), bidId, NOW, subject);
  return ho.afterAward(db, db.bids.find((b) => b.id === bidId)!.opportunityId, NOW, before);
}

describe('awarding a role for a student with several subjects (mirror award_opportunity)', () => {
  it('refuses without a subject, and changes nothing', () => {
    const db = seed();
    const student = multiSubjectStudent(db);
    const role = ops.saveOpportunity(
      db,
      who(db, 'admin'),
      {
        title: 'Tutor wanted',
        studentId: student.id,
        payRate: 230,
        visibility: 'all',
        invitedTutorIds: [],
      },
      NOW,
    );
    ops.placeBid(db, james, role.id, 'Happy to help.', undefined, NOW);
    const bidId = db.bids[db.bids.length - 1].id;
    const handovers = (db.handovers ?? []).length;
    const first = student.fullName.split(' ')[0];
    expect(() => award(db, bidId)).toThrow(`Please choose which subject this role is for: ${first} has more than one subject.`);
    expect(() => award(db, bidId, 'Underwater basket weaving')).toThrow("Please choose one of the student's current subjects.");
    expect(db.opportunities.find((o) => o.id === role.id)).toMatchObject({
      status: 'open',
    });
    expect(db.opportunities.find((o) => o.id === role.id)!.subject).toBeUndefined();
    expect(db.bids.find((b) => b.id === bidId)!.status).toBe('pending');
    expect((db.handovers ?? []).length).toBe(handovers);
  });

  it('moves the chosen subject to the winning tutor, and the pack opens', () => {
    const db = seed();
    const student = multiSubjectStudent(db);
    const choices = awardSubjectChoices(db.enrolments, {
      studentId: student.id,
    });
    expect(choices.length).toBeGreaterThan(1);
    const target = db.enrolments.find((e) => e.active && e.studentId === student.id && e.tutorId !== 't-james')!;
    const others = db.enrolments.filter((e) => e.active && e.studentId === student.id && e.id !== target.id).map((e) => ({ id: e.id, tutorId: e.tutorId }));
    const role = ops.saveOpportunity(
      db,
      who(db, 'admin'),
      {
        title: 'Tutor wanted',
        studentId: student.id,
        payRate: 230,
        visibility: 'all',
        invitedTutorIds: [],
      },
      NOW,
    );
    ops.placeBid(db, james, role.id, 'Happy to help.', undefined, NOW);
    const h = award(db, db.bids[db.bids.length - 1].id, ` ${target.subject.toUpperCase()} `)!;
    expect(db.opportunities.find((o) => o.id === role.id)).toMatchObject({
      status: 'awarded',
      subject: target.subject,
      awardedTutorId: 't-james',
    });
    expect(db.enrolments.find((e) => e.id === target.id)).toMatchObject({
      tutorId: 't-james',
      tutorPay: 230,
      tutorPaySource: 'opportunity',
    });
    for (const o of others) expect(db.enrolments.find((e) => e.id === o.id)!.tutorId).toBe(o.tutorId);
    expect(h).toMatchObject({
      reason: 'awarded',
      subject: target.subject,
      enrolmentId: target.id,
      toTutorId: 't-james',
    });
    expect(ho.sources(db, james, h.id, NOW).closed).toBeFalsy();
  });

  it('needs no choice when the role has a subject or the student has one subject', () => {
    const db = seed();
    const student = multiSubjectStudent(db);
    const subject = db.enrolments.find((e) => e.active && e.studentId === student.id)!.subject;
    expect(awardSubjectChoices(db.enrolments, { studentId: student.id, subject })).toEqual([]);
    expect(awardSubjectChoices(db.enrolments, {})).toEqual([]);
    expect(() => awardSubject(db.enrolments, { studentId: student.id, subject }, 'Other')).toThrow(`This role is already for ${subject}.`);
    expect(awardSubject(db.enrolments, { studentId: student.id, subject }, subject.toLowerCase())).toBeUndefined();
    const single = db.students.find((x) => db.enrolments.filter((e) => e.active && e.studentId === x.id).length === 1);
    if (single) {
      expect(awardSubjectChoices(db.enrolments, { studentId: single.id })).toEqual([]);
      expect(awardSubject(db.enrolments, { studentId: single.id }, undefined)).toBeUndefined();
    }
  });
});

describe('tutor cost estimates (mirror tutor_cost_estimates)', () => {
  it('gives admins and the accountant monthly totals only, and nobody else', () => {
    const db = createSeed(NOW);
    const rows = tax.tutorCostEstimates(db, who(db, 'accountant'), '2025-11-01', '2026-10-05');
    expect(rows.map((r) => r.month)).toEqual(Array.from({ length: 12 }, (_, i) => `${i < 2 ? 2025 : 2026}-${String(((10 + i) % 12) + 1).padStart(2, '0')}`));
    expect(rows.every((r) => Object.keys(r).sort().join() === 'amount,month')).toBe(true);
    expect(tax.tutorCostEstimates(db, who(db, 'admin'), '2025-11-01', '2026-10-05')).toEqual(rows);
    expect(() => tax.tutorCostEstimates(db, who(db, 'tutor'), '2026-01-01', '2026-02-01')).toThrow(AccessError);
    expect(() => tax.tutorCostEstimates(db, who(db, 'parent'), '2026-01-01', '2026-02-01')).toThrow(AccessError);
    expect(() => tax.tutorCostEstimates(db, who(db, 'admin'), '2026-03-01', '2026-01-01')).toThrow('Please choose a valid range of months.');
    expect(() => tax.tutorCostEstimates(db, who(db, 'admin'), '2023-01-01', '2026-01-01')).toThrow('Please choose at most 36 months.');
    expect(SOURCE_ACCESS.tutorCostEstimates).toBe('read');
  });

  it('gives the accountant the same tutor costs the admin sees, though they cannot read lessons', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const base = {
      charges: [],
      packages: [],
      invoices: [],
      tutors: db.tutors,
      tutorInvoices: db.tutorInvoices,
      expenses: [],
      settings: db.settings,
      enrolments: db.enrolments,
      creditNotes: [],
      refunds: [],
    };
    const adminView = monthSeries(NOW, 12, { ...base, lessons: db.lessons });
    const from = `${adminView[0].month}-01`;
    const estimates = tax.tutorCostEstimates(db, admin, from, `${adminView[11].month}-01`);
    const accountantView = monthSeries(NOW, 12, {
      ...base,
      lessons: [],
      tutors: [],
      tutorCostEstimates: estimates,
    });
    expect(accountantView.map((m) => [m.month, m.tutorCosts, m.tutorCostsEstimated])).toEqual(
      adminView.map((m) => [m.month, m.tutorCosts, m.tutorCostsEstimated]),
    );
    // The seed has lessons to estimate, so this is not a comparison of zeros.
    expect(adminView.some((m) => m.tutorCostsEstimated && m.tutorCosts > 0)).toBe(true);
    // Without the estimates (the old behaviour) the accountant would have seen less.
    const before = monthSeries(NOW, 12, { ...base, lessons: [], tutors: [] });
    expect(before.reduce((s, m) => s + m.tutorCosts, 0)).toBeLessThan(accountantView.reduce((s, m) => s + m.tutorCosts, 0));
  });
});
