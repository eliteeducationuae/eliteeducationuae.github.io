import { minutesBetween } from '@/domain/dates';

import { AccessError, cmd, enr } from '../demo/db';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';
import { enrolmentRatesFromRow, setEnrolmentRatesArgs } from '../rpc-mapping';

const NOW = new Date(2026, 9, 4, 12, 0);
type DB = ReturnType<typeof createSeed>;
const who = (db: DB, role: string) => db.profiles.find((p) => p.role === role)!;
const tutorProfile = (db: DB, tutorId: string) => ({ ...who(db, 'tutor'), id: `u-${tutorId}`, tutorId });
const raw = (db: DB, id: string) => db.enrolments.find((e) => e.id === id)!;
const complete = (db: DB, lessonId: string) =>
  cmd.completeLesson(db, who(db, 'admin'), { lessonId, status: 'completed', attendance: {}, summary: 's', topicIds: [], ratings: [], homework: [] });

describe('enrolmentRatesFromRow', () => {
  it('reads an embedded object', () => {
    expect(
      enrolmentRatesFromRow({ id: 'e', enrolment_tutor_pay: { hourly_pay: 240, source: 'opportunity' }, enrolment_family_price: { hourly_price: 480 } }),
    ).toEqual({ tutorPay: 240, tutorPaySource: 'opportunity', familyPrice: 480 });
  });

  it('reads a one-element array and string numerics', () => {
    expect(
      enrolmentRatesFromRow({ enrolment_tutor_pay: [{ hourly_pay: '199.50', source: 'custom' }], enrolment_family_price: [{ hourly_price: '320.00' }] }),
    ).toEqual({ tutorPay: 199.5, tutorPaySource: 'custom', familyPrice: 320 });
  });

  it('leaves out hidden or missing rates', () => {
    expect(enrolmentRatesFromRow({ enrolment_tutor_pay: null, enrolment_family_price: [] })).toEqual({});
    expect(enrolmentRatesFromRow({ id: 'e' })).toEqual({});
    expect(enrolmentRatesFromRow({ enrolment_tutor_pay: { hourly_pay: 0, source: 'custom' } })).toEqual({ tutorPay: 0, tutorPaySource: 'custom' });
  });
});

describe('setEnrolmentRatesArgs', () => {
  it('maps to the RPC arguments, keeping nulls', () => {
    expect(setEnrolmentRatesArgs({ enrolmentId: 'e1', tutorPay: 250, familyPrice: null })).toEqual({
      p_enrolment_id: 'e1',
      p_tutor_pay: 250,
      p_family_price: null,
    });
  });
});

describe('demo seed rates', () => {
  const db = createSeed(NOW);

  it('seeds the custom rates and leaves Layla’s Chemistry on the defaults', () => {
    expect(raw(db, 'enr-omar-arabic')).toMatchObject({ familyPrice: 480 });
    expect(raw(db, 'enr-karim-maths')).toMatchObject({ tutorPay: 240, tutorPaySource: 'opportunity' });
    expect(raw(db, 'enr-yasmin-english-literature')).toMatchObject({ familyPrice: 320 });
    expect(raw(db, 'enr-layla-chemistry').tutorPay).toBeUndefined();
    expect(raw(db, 'enr-layla-chemistry').familyPrice).toBeUndefined();
  });

  it('charges seeded lessons at the custom prices and pays the group rule', () => {
    const arabic = db.charges.find((c) => c.studentId === 's-omar' && c.priceSource === 'custom' && c.status !== 'package')!;
    expect(arabic).toMatchObject({ hourlyPrice: 480 });
    const lesson = db.lessons.find((l) => l.id === arabic.lessonId)!;
    expect(arabic.amount).toBe(Math.round((480 * minutesBetween(new Date(lesson.start), new Date(lesson.end))) / 60 * 100) / 100);
    const haddadLines = db.tutorInvoices
      .filter((i) => i.tutorId === 't-sarah')
      .flatMap((i) => i.items)
      .filter((x) => x.lessonId && db.lessons.find((l) => l.id === x.lessonId)!.studentIds.includes('s-karim'));
    expect(haddadLines.length).toBeGreaterThan(0);
    expect(haddadLines.every((x) => x.unitPrice === 240 && x.rateSource === 'custom')).toBe(true);
  });
});

describe('rate visibility (mirrors the RLS on the rate tables)', () => {
  const db = createSeed(NOW);
  enr.setEnrolmentRates(db, who(db, 'admin'), { enrolmentId: 'enr-layla-chemistry', tutorPay: 260, familyPrice: 380 });
  enr.setEnrolmentRates(db, who(db, 'admin'), { enrolmentId: 'enr-layla-maths', tutorPay: 230, familyPrice: null });

  it('shows the admin every rate', () => {
    const all = enr.enrolments(db, who(db, 'admin'));
    expect(all.find((e) => e.id === 'enr-layla-chemistry')).toMatchObject({ tutorPay: 260, tutorPaySource: 'custom', familyPrice: 380 });
    expect(all.find((e) => e.id === 'enr-karim-maths')).toMatchObject({ tutorPay: 240 });
  });

  it('shows a tutor only their own pay, never family prices', () => {
    const sarah = enr.enrolments(db, who(db, 'tutor'));
    expect(sarah.find((e) => e.id === 'enr-layla-chemistry')).toMatchObject({ tutorPay: 260 });
    expect(sarah.every((e) => e.familyPrice === undefined)).toBe(true);
    // Craig teaches Omar's Maths; Sarah can see Omar only if she teaches him, and never Nour's or Craig's pay.
    expect(sarah.filter((e) => e.tutorId !== 't-sarah').every((e) => e.tutorPay === undefined && e.tutorPaySource === undefined)).toBe(true);
    const nour = enr.enrolments(db, tutorProfile(db, 't-nour'));
    expect(nour.find((e) => e.id === 'enr-omar-arabic')?.familyPrice).toBeUndefined();
  });

  it('shows a parent only their family’s prices, never tutor pay', () => {
    const parent = enr.enrolments(db, who(db, 'parent'));
    expect(parent.find((e) => e.id === 'enr-omar-arabic')).toMatchObject({ familyPrice: 480 });
    expect(parent.find((e) => e.id === 'enr-layla-chemistry')).toMatchObject({ familyPrice: 380 });
    expect(parent.every((e) => e.tutorPay === undefined && e.tutorPaySource === undefined)).toBe(true);
  });

  it('shows a student neither', () => {
    const student = enr.enrolments(db, who(db, 'student'));
    expect(student.length).toBeGreaterThan(0);
    expect(student.every((e) => e.tutorPay === undefined && e.familyPrice === undefined)).toBe(true);
  });

  it('returns copies, so stripping never touches the stored rows', () => {
    enr.enrolments(db, who(db, 'student'));
    expect(raw(db, 'enr-omar-arabic').familyPrice).toBe(480);
  });
});

describe('setEnrolmentRates (mirrors set_enrolment_rates)', () => {
  it('is for admins only and checks its input', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const input = { enrolmentId: 'enr-layla-chemistry', tutorPay: 250, familyPrice: null };
    expect(() => enr.setEnrolmentRates(db, who(db, 'tutor'), input)).toThrow(AccessError);
    expect(() => enr.setEnrolmentRates(db, who(db, 'parent'), input)).toThrow(AccessError);
    expect(() => enr.setEnrolmentRates(db, admin, { ...input, enrolmentId: 'nope' })).toThrow('Subject not found');
    expect(() => enr.setEnrolmentRates(db, admin, { ...input, tutorPay: -1 })).toThrow('Please enter a rate of zero or more.');
    expect(() => enr.setEnrolmentRates(db, admin, { ...input, tutorPay: null, familyPrice: -5 })).toThrow('Please enter a rate of zero or more.');
    raw(db, 'enr-layla-chemistry').tutorId = undefined;
    expect(() => enr.setEnrolmentRates(db, admin, input)).toThrow('Please choose a tutor for this subject before setting their pay.');
    // A family price alone needs no tutor.
    enr.setEnrolmentRates(db, admin, { ...input, tutorPay: null, familyPrice: 300 });
    expect(raw(db, 'enr-layla-chemistry').familyPrice).toBe(300);
  });

  it('sets, keeps the opportunity source when unchanged, and clears with null', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-karim-maths', tutorPay: 240, familyPrice: 300 });
    expect(raw(db, 'enr-karim-maths')).toMatchObject({ tutorPay: 240, tutorPaySource: 'opportunity', familyPrice: 300 });
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-karim-maths', tutorPay: 250, familyPrice: 300 });
    expect(raw(db, 'enr-karim-maths')).toMatchObject({ tutorPay: 250, tutorPaySource: 'custom' });
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-karim-maths', tutorPay: null, familyPrice: null });
    const e = raw(db, 'enr-karim-maths');
    expect('tutorPay' in e || 'tutorPaySource' in e || 'familyPrice' in e).toBe(false);
  });

  it('clears the tutor pay, but not the family price, when the tutor changes', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-layla-chemistry', tutorPay: 260, familyPrice: 380 });
    const e = raw(db, 'enr-layla-chemistry');
    // Saving with the same tutor keeps both.
    enr.saveEnrolment(db, admin, { ...e, studentId: e.studentId });
    expect(raw(db, 'enr-layla-chemistry')).toMatchObject({ tutorPay: 260, familyPrice: 380 });
    enr.saveEnrolment(db, admin, { ...e, studentId: e.studentId, tutorId: 't-james' });
    const after = raw(db, 'enr-layla-chemistry');
    expect(after.tutorId).toBe('t-james');
    expect(after.tutorPay).toBeUndefined();
    expect(after.tutorPaySource).toBeUndefined();
    expect(after.familyPrice).toBe(380);
  });
});

describe('charges and tutor invoices at custom rates', () => {
  it('charges a completed lesson at the custom price and keeps the snapshot when the rate changes', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-layla-chemistry', tutorPay: 260, familyPrice: 400 });
    const lesson = db.lessons.find((l) => l.status === 'scheduled' && l.subject === 'Chemistry' && l.studentIds.includes('s-layla'))!;
    complete(db, lesson.id);
    const hours = minutesBetween(new Date(lesson.start), new Date(lesson.end)) / 60;
    const charge = db.charges.find((c) => c.lessonId === lesson.id)!;
    expect(charge).toMatchObject({ amount: Math.round(400 * hours * 100) / 100, priceSource: 'custom', hourlyPrice: 400, status: 'unbilled' });

    const invoice = cmd.invoiceUnbilled(db, admin, 'f-mansoori', NOW)!;
    const item = invoice.items.find((i) => i.chargeId === charge.id)!;
    expect(item.unitPrice).toBe(charge.amount);

    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-layla-chemistry', tutorPay: 300, familyPrice: 500 });
    expect(db.charges.find((c) => c.id === charge.id)).toMatchObject({ amount: Math.round(400 * hours * 100) / 100, hourlyPrice: 400 });
    expect(db.invoices.find((i) => i.id === invoice.id)!.items.find((i) => i.chargeId === charge.id)!.unitPrice).toBe(item.unitPrice);
  });

  it('bills the tutor invoice line at the custom rate, and keeps it once submitted', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const sarah = who(db, 'tutor');
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-layla-chemistry', tutorPay: 260, familyPrice: null });
    const lesson = db.lessons.find(
      (l) => l.status === 'scheduled' && l.subject === 'Chemistry' && l.studentIds.includes('s-layla') && l.start.slice(0, 7) === '2026-10',
    )!;
    complete(db, lesson.id);
    const id = ops.createTutorInvoice(db, sarah, 't-sarah', '2026-10-01', NOW);
    const inv = db.tutorInvoices.find((i) => i.id === id)!;
    expect(inv.items.find((i) => i.lessonId === lesson.id)).toMatchObject({ unitPrice: 260, rateSource: 'custom' });
    // Her other un-invoiced Layla Chemistry lessons use the new rate too; the rest stay on her usual rate (or the Haddad group rate).
    for (const item of inv.items.filter((i) => i.lessonId)) {
      const l = db.lessons.find((x) => x.id === item.lessonId)!;
      const chem = l.subject === 'Chemistry' && l.studentIds.includes('s-layla');
      const haddad = l.studentIds.includes('s-karim');
      expect(item.unitPrice).toBe(chem ? 260 : haddad ? 240 : 200);
    }

    ops.submitTutorInvoice(db, sarah, id, NOW);
    enr.setEnrolmentRates(db, admin, { enrolmentId: 'enr-layla-chemistry', tutorPay: 300, familyPrice: null });
    expect(db.tutorInvoices.find((i) => i.id === id)!.items.find((i) => i.lessonId === lesson.id)!.unitPrice).toBe(260);
  });
});

describe('awardOpportunity (mirrors award_opportunity)', () => {
  it('gives the winner the student’s enrolment at the role’s pay', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const o = ops.saveOpportunity(
      db,
      admin,
      { title: 'Layla Chemistry', subject: ' chemistry ', studentId: 's-layla', payRate: 275, visibility: 'all', invitedTutorIds: [] },
      NOW,
    );
    ops.placeBid(db, tutorProfile(db, 't-james'), o.id, 'I would be pleased to teach Layla.', undefined, NOW);
    ops.awardOpportunity(db, admin, db.bids.find((b) => b.opportunityId === o.id)!.id, NOW);
    expect(raw(db, 'enr-layla-chemistry')).toMatchObject({ tutorId: 't-james', tutorPay: 275, tutorPaySource: 'opportunity' });
  });

  it('creates the enrolment when the student does not yet study the subject', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const o = ops.saveOpportunity(
      db,
      admin,
      { title: 'Omar Physics', subject: 'Physics', curriculum: 'IB DP', studentId: 's-omar', payRate: 300, visibility: 'all', invitedTutorIds: [] },
      NOW,
    );
    ops.placeBid(db, who(db, 'tutor'), o.id, 'I would be pleased to teach Omar.', undefined, NOW);
    ops.awardOpportunity(db, admin, db.bids.find((b) => b.opportunityId === o.id)!.id, NOW);
    const created = db.enrolments.find((e) => e.studentId === 's-omar' && e.subject === 'Physics')!;
    expect(created).toMatchObject({ curriculum: 'IB DP', tutorId: 't-sarah', tutorPay: 300, tutorPaySource: 'opportunity', active: true });
  });

  it('leaves enrolments alone for a role without a student', () => {
    const db = createSeed(NOW);
    const before = JSON.stringify(db.enrolments);
    const o = db.opportunities.find((x) => x.title.startsWith('IGCSE Physics'))!;
    ops.placeBid(db, who(db, 'tutor'), o.id, 'Happy to help.', undefined, NOW);
    ops.awardOpportunity(db, who(db, 'admin'), db.bids.find((b) => b.opportunityId === o.id)!.id, NOW);
    expect(JSON.stringify(db.enrolments)).toBe(before);
  });
});
