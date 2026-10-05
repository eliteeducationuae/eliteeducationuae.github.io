import { draftFromEnrolment, ratesChanged, tutorChoicePatch } from '../enrolments';
import { monthFigures, type FinanceData } from '../finance';
import {
  familyPricePlaceholder,
  lessonEnrolment,
  lessonFamilyCharge,
  lessonTutorRate,
  parseRate,
  serviceForEnrolment,
  serviceHourly,
  studentTutorRate,
  tutorPayPlaceholder,
} from '../rates';
import { tutorInvoiceLines } from '../tutor-pay';
import type { Enrolment, Lesson, Service, Student, Tutor } from '../types';

const sarah: Tutor = { id: 't-sarah', fullName: 'Sarah Khan', email: '', hourlyPay: 200, subjects: [], curricula: [], phases: [], color: '' };
const cover: Tutor = { ...sarah, id: 't-cover', fullName: 'Cover Tutor', hourlyPay: 180 };
const igcse: Service = { id: 'svc-igcse', name: 'IGCSE and GCSE 1:1', durationMin: 60, rate: 350, phase: 'GCSE and IGCSE' };
const alevel: Service = { id: 'svc-alevel', name: 'A-Level 1:1', durationMin: 90, rate: 550, phase: 'Sixth Form and IB Diploma' };
const enrol = (over: Partial<Enrolment> & Pick<Enrolment, 'id' | 'studentId'>): Enrolment => ({ subject: 'Maths', active: true, ...over });
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).toISOString();
const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: 'l1',
  tutorId: 't-sarah',
  studentIds: ['s1'],
  serviceId: 'svc-igcse',
  subject: 'Maths',
  start: at(10, 16),
  end: at(10, 17, 30),
  location: 'online',
  status: 'completed',
  ...over,
});

describe('lessonEnrolment', () => {
  const enrolments = [
    enrol({ id: 'm', studentId: 's1', subject: 'Maths' }),
    enrol({ id: 'c', studentId: 's1', subject: 'Chemistry' }),
    enrol({ id: 'old', studentId: 's1', subject: 'Physics', active: false }),
    enrol({ id: 'only', studentId: 's2', subject: 'English' }),
  ];

  it('finds the enrolment by subject, ignoring case and spaces', () => {
    expect(lessonEnrolment({ subject: '  chemistry ' }, 's1', enrolments)?.id).toBe('c');
    expect(lessonEnrolment({ subject: 'MATHS' }, 's1', enrolments)?.id).toBe('m');
  });

  it('uses the only active enrolment when the lesson has no subject', () => {
    expect(lessonEnrolment({}, 's2', enrolments)?.id).toBe('only');
    expect(lessonEnrolment({ subject: ' ' }, 's1', enrolments)).toBeUndefined();
  });

  it('finds nothing for an inactive or missing subject', () => {
    expect(lessonEnrolment({ subject: 'Physics' }, 's1', enrolments)).toBeUndefined();
    expect(lessonEnrolment({ subject: 'Maths' }, 's9', enrolments)).toBeUndefined();
  });
});

describe('studentTutorRate', () => {
  const e = enrol({ id: 'e', studentId: 's1', tutorId: 't-sarah', tutorPay: 240 });

  it('uses the custom pay only for the enrolment’s own tutor', () => {
    expect(studentTutorRate(sarah, e)).toEqual({ rate: 240, source: 'custom' });
    expect(studentTutorRate(cover, e)).toEqual({ rate: 180, source: 'usual' });
  });

  it('falls back to the usual rate with no enrolment or no custom pay', () => {
    expect(studentTutorRate(sarah)).toEqual({ rate: 200, source: 'usual' });
    expect(studentTutorRate(sarah, { ...e, tutorPay: undefined })).toEqual({ rate: 200, source: 'usual' });
  });

  it('honours a custom pay of zero', () => {
    expect(studentTutorRate(sarah, { ...e, tutorPay: 0 })).toEqual({ rate: 0, source: 'custom' });
  });
});

describe('lessonTutorRate', () => {
  it('uses a single student’s custom pay', () => {
    const enrolments = [enrol({ id: 'e', studentId: 's1', tutorId: 't-sarah', tutorPay: 260 })];
    expect(lessonTutorRate(lesson(), sarah, enrolments)).toEqual({ rate: 260, source: 'custom', group: false });
  });

  it('pays the highest rate in a group', () => {
    const enrolments = [
      enrol({ id: 'a', studentId: 's1', tutorId: 't-sarah', tutorPay: 240 }),
      enrol({ id: 'b', studentId: 's2', tutorId: 't-sarah', tutorPay: 220 }),
    ];
    expect(lessonTutorRate(lesson({ studentIds: ['s1', 's2'] }), sarah, enrolments)).toEqual({ rate: 240, source: 'custom', group: true });
  });

  it('keeps the usual rate when a group’s custom pay is lower', () => {
    const enrolments = [enrol({ id: 'a', studentId: 's1', tutorId: 't-sarah', tutorPay: 150 }), enrol({ id: 'b', studentId: 's2' })];
    expect(lessonTutorRate(lesson({ studentIds: ['s1', 's2'] }), sarah, enrolments)).toEqual({ rate: 200, source: 'usual', group: true });
  });

  it('prefers the custom source on a tie', () => {
    const enrolments = [enrol({ id: 'a', studentId: 's1' }), enrol({ id: 'b', studentId: 's2', tutorId: 't-sarah', tutorPay: 200 })];
    expect(lessonTutorRate(lesson({ studentIds: ['s1', 's2'] }), sarah, enrolments)).toEqual({ rate: 200, source: 'custom', group: true });
  });

  it('uses the usual rate with no students', () => {
    expect(lessonTutorRate(lesson({ studentIds: [] }), sarah, [])).toEqual({ rate: 200, source: 'usual', group: false });
  });
});

describe('family prices', () => {
  it('works out the service price per hour', () => {
    expect(serviceHourly(igcse)).toBe(350);
    expect(serviceHourly(alevel)).toBe(366.67);
    expect(serviceHourly({ rate: 300, durationMin: 0 })).toBe(0);
  });

  it('charges a custom price for the lesson length', () => {
    const enrolments = [enrol({ id: 'e', studentId: 's1', familyPrice: 300 })];
    // 90 minutes = 1.5 hours.
    expect(lessonFamilyCharge(lesson(), igcse, 's1', enrolments)).toEqual({ amount: 450, hourly: 300, source: 'custom' });
  });

  it('charges the service price by default', () => {
    expect(lessonFamilyCharge(lesson(), igcse, 's1', [])).toEqual({ amount: 350, hourly: 350, source: 'service' });
    expect(lessonFamilyCharge(lesson(), alevel, 's1', [enrol({ id: 'e', studentId: 's1' })])).toEqual({ amount: 550, hourly: 366.67, source: 'service' });
  });

  it('rounds a custom charge to fils', () => {
    const enrolments = [enrol({ id: 'e', studentId: 's1', familyPrice: 333.33 })];
    const l = lesson({ start: at(10, 16), end: at(10, 16, 50) });
    expect(lessonFamilyCharge(l, igcse, 's1', enrolments).amount).toBe(277.78);
  });
});

describe('serviceForEnrolment', () => {
  const english: Service = { id: 'svc-eng', name: 'English 1:1', durationMin: 60, rate: 300, subject: 'English' };
  const services = [alevel, igcse, english];

  it('matches the subject first, then the student’s phase', () => {
    expect(serviceForEnrolment(services, { subject: ' english ' })?.id).toBe('svc-eng');
    expect(serviceForEnrolment(services, { subject: 'Maths' }, { phase: 'GCSE and IGCSE' })?.id).toBe('svc-igcse');
    expect(serviceForEnrolment(services, { subject: 'Maths' })).toBeUndefined();
    expect(serviceForEnrolment(services, { subject: 'Maths' }, { phase: 'Primary' })).toBeUndefined();
  });
});

describe('placeholders', () => {
  it('describes the tutor’s usual rate', () => {
    expect(tutorPayPlaceholder(sarah)).toBe('Default: AED 200 — Sarah’s usual rate');
    expect(tutorPayPlaceholder({ fullName: 'Nour Al Hashimi', hourlyPay: 1250.5 })).toBe('Default: AED 1,250.50 — Nour’s usual rate');
    expect(tutorPayPlaceholder()).toBe('Choose a tutor first');
  });

  it('describes the service price per hour', () => {
    expect(familyPricePlaceholder(igcse)).toBe('Default: AED 350 — IGCSE and GCSE 1:1 price');
    expect(familyPricePlaceholder(alevel)).toBe('Default: AED 366.67 — A-Level 1:1 price');
    expect(familyPricePlaceholder()).toBe("Default: the lesson's service price");
  });
});

describe('parseRate', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['0', 0],
    ['200', 200],
    [' 199.5 ', 199.5],
    ['99999.99', 99999.99],
    ['-1', 'invalid'],
    ['abc', 'invalid'],
    ['1.234', 'invalid'],
    ['100000', 'invalid'],
    ['1e3', 'invalid'],
  ])('%j → %j', (text, expected) => {
    expect(parseRate(text)).toBe(expected);
  });
});

describe('tutor invoices and finance with per-student pay', () => {
  const students: Student[] = [
    { id: 's1', familyId: 'f1', fullName: 'Yasmin Haddad' },
    { id: 's2', familyId: 'f1', fullName: 'Karim Haddad' },
  ];
  const enrolments = [
    enrol({ id: 'y', studentId: 's1', tutorId: 't-sarah' }),
    enrol({ id: 'k', studentId: 's2', tutorId: 't-sarah', tutorPay: 240, tutorPaySource: 'opportunity' }),
  ];
  const lessons = [
    lesson({ id: 'a', studentIds: ['s1'] }),
    lesson({ id: 'b', studentIds: ['s1', 's2'], start: at(12, 10), end: at(12, 11, 30) }),
    lesson({ id: 'c', studentIds: ['s2'], tutorId: 't-cover', start: at(13, 10), end: at(13, 11) }),
  ];

  it('prices each line at the lesson’s rate and records its source', () => {
    const lines = tutorInvoiceLines(sarah, lessons, [igcse], students, new Date(2026, 8, 1), { payTutorForLateCancel: true }, new Set(), enrolments);
    expect(lines.map((l) => [l.lessonId, l.quantity, l.unitPrice, l.rateSource])).toEqual([
      ['a', 1.5, 200, 'usual'],
      ['b', 1.5, 240, 'custom'],
    ]);
    // A cover tutor teaching Karim gets their usual rate.
    const coverLines = tutorInvoiceLines(cover, lessons, [igcse], students, new Date(2026, 8, 1), { payTutorForLateCancel: true }, new Set(), enrolments);
    expect(coverLines.map((l) => [l.lessonId, l.unitPrice, l.rateSource])).toEqual([['c', 180, 'usual']]);
  });

  it('keeps the usual rate when enrolments are omitted', () => {
    const lines = tutorInvoiceLines(sarah, lessons, [igcse], students, new Date(2026, 8, 1), { payTutorForLateCancel: true });
    expect(lines.map((l) => [l.unitPrice, l.rateSource])).toEqual([
      [200, 'usual'],
      [200, 'usual'],
    ]);
  });

  it('estimates tutor costs with the custom rates', () => {
    const data: FinanceData = {
      charges: [],
      packages: [],
      invoices: [],
      lessons,
      tutors: [sarah],
      tutorInvoices: [],
      expenses: [],
      settings: { payTutorForLateCancel: true },
    };
    // 1.5h × 200 + 1.5h × 240
    expect(monthFigures(new Date(2026, 8, 1), { ...data, enrolments }).tutorCosts).toBe(660);
    expect(monthFigures(new Date(2026, 8, 1), data).tutorCosts).toBe(600);
  });
});

describe('enrolment drafts and rates', () => {
  const saved = enrol({ id: 'e', studentId: 's1', tutorId: 't-sarah', tutorPay: 240, tutorPaySource: 'opportunity', familyPrice: 400 });

  it('copies the rates into a draft', () => {
    expect(draftFromEnrolment(saved)).toMatchObject({ tutorPay: 240, familyPrice: 400 });
  });

  it('notices when a rate changes or is cleared', () => {
    const draft = draftFromEnrolment(saved);
    expect(ratesChanged(draft, saved)).toBe(false);
    expect(ratesChanged({ ...draft, tutorPay: 250 }, saved)).toBe(true);
    expect(ratesChanged({ ...draft, familyPrice: undefined }, saved)).toBe(true);
  });

  it('clears custom pay for a different tutor and restores it for the saved tutor', () => {
    const draft = draftFromEnrolment(saved);
    expect(tutorChoicePatch(draft, 't-sarah', saved)).toEqual({ tutorId: 't-sarah' });
    const changed = { ...draft, ...tutorChoicePatch(draft, 't-james', saved) };
    expect(changed).toMatchObject({ tutorId: 't-james', tutorPay: undefined });
    const back = { ...changed, ...tutorChoicePatch(changed, 't-sarah', saved) };
    expect(back).toMatchObject({ tutorId: 't-sarah', tutorPay: 240 });
    expect(ratesChanged(back, saved)).toBe(false);
    expect(tutorChoicePatch(draft, undefined, saved)).toEqual({ tutorId: undefined, tutorPay: undefined });
    expect(tutorChoicePatch({}, 't-james')).toEqual({ tutorId: 't-james', tutorPay: undefined });
  });

  it('for a new enrolment, is true only when a rate is set', () => {
    expect(ratesChanged({ subject: 'Maths', active: true })).toBe(false);
    expect(ratesChanged({ subject: 'Maths', active: true, familyPrice: 0 })).toBe(true);
  });
});
