import type { Enrolment } from '@/domain/types';

import {
  agreedPriceSentence,
  awardPaySentence,
  bookingPriceNotes,
  customBadgeLabel,
  hasCustomFamilyPrice,
  packagePriceNotes,
  payrollSubtitle,
  RATE_INVALID,
  rateFieldError,
  rateFieldText,
  rateSummary,
  tutorCustomRateLines,
} from '../rate-rules';

const sarah = { id: 'tut-sarah', fullName: 'Sarah Thompson', hourlyPay: 200 };
const igcse = { name: 'IGCSE and GCSE 1:1', rate: 350, durationMin: 60 };

const enr = (over: Partial<Enrolment> = {}): Enrolment => ({
  id: 'enr-1',
  studentId: 'stu-layla',
  subject: 'Chemistry',
  tutorId: 'tut-sarah',
  active: true,
  ...over,
});

const names: Record<string, string> = { 'stu-layla': 'Layla Al Mansoori', 'stu-omar': 'Omar Al Mansoori' };
const name = (id: string) => names[id];

describe('rate field text', () => {
  it('starts blank for no custom rate and shows the number otherwise', () => {
    expect(rateFieldText(undefined)).toBe('');
    expect(rateFieldText(null)).toBe('');
    expect(rateFieldText(NaN)).toBe('');
    expect(rateFieldText(265)).toBe('265');
    expect(rateFieldText(199.5)).toBe('199.5');
  });

  it('flags only text that is not a valid amount', () => {
    expect(rateFieldError('')).toBeUndefined();
    expect(rateFieldError('  ')).toBeUndefined();
    expect(rateFieldError('200')).toBeUndefined();
    expect(rateFieldError('199.50')).toBeUndefined();
    expect(rateFieldError('1.')).toBe(RATE_INVALID);
    expect(rateFieldError('abc')).toBe(RATE_INVALID);
    expect(rateFieldError('-5')).toBe(RATE_INVALID);
    expect(rateFieldError('1.234')).toBe(RATE_INVALID);
  });
});

describe('customBadgeLabel', () => {
  it('names an awarded role rate differently from a custom one', () => {
    expect(customBadgeLabel('opportunity')).toBe('Agreed role rate');
    expect(customBadgeLabel('custom')).toBe('Custom');
    expect(customBadgeLabel(undefined)).toBe('Custom');
  });
});

describe('rateSummary', () => {
  const both = enr({ tutorPay: 265, tutorPaySource: 'custom', familyPrice: 415 });

  it('shows admins both rates with Custom badges', () => {
    const lines = rateSummary({ enrolment: both, tutor: sarah, service: igcse, viewer: { role: 'admin' } });
    expect(lines.map((l) => [l.label, l.value, l.badge])).toEqual([
      ['Tutor pay per hour', 'AED 265', 'Custom'],
      ['Family price per hour', 'AED 415', 'Custom'],
    ]);
  });

  it('explains the defaults to admins when no custom rate is set', () => {
    const lines = rateSummary({ enrolment: enr(), tutor: sarah, service: igcse, viewer: { role: 'admin' } });
    expect(lines[0]).toMatchObject({ value: 'AED 200', note: 'Default — Sarah’s usual rate' });
    expect(lines[0].badge).toBeUndefined();
    expect(lines[1]).toMatchObject({ value: 'AED 350', note: 'Default — IGCSE and GCSE 1:1 price' });
  });

  it('shows the teaching tutor only their own pay, never the family price', () => {
    const lines = rateSummary({ enrolment: both, tutor: sarah, service: igcse, viewer: { role: 'tutor', tutorId: 'tut-sarah' } });
    expect(lines).toEqual([{ key: 'tutor-pay', label: 'Your pay for this subject', value: 'AED 265 per hour', badge: 'Custom' }]);
    expect(JSON.stringify(lines)).not.toMatch(/415|Family/);
  });

  it('shows the teaching tutor their usual rate when no custom pay is set', () => {
    const lines = rateSummary({ enrolment: enr({ familyPrice: 415 }), tutor: sarah, viewer: { role: 'tutor', tutorId: 'tut-sarah' } });
    expect(lines).toEqual([{ key: 'tutor-pay', label: 'Your pay for this subject', value: 'AED 200 per hour', note: 'Your usual rate' }]);
  });

  it('shows another tutor nothing', () => {
    expect(rateSummary({ enrolment: both, tutor: sarah, viewer: { role: 'tutor', tutorId: 'tut-james' } })).toEqual([]);
    expect(rateSummary({ enrolment: both, tutor: sarah, viewer: { role: 'tutor' } })).toEqual([]);
  });

  it('shows a family only its agreed price, never the tutor pay', () => {
    const lines = rateSummary({ enrolment: both, tutor: sarah, service: igcse, viewer: { role: 'parent' } });
    expect(lines).toEqual([{ key: 'family-price', label: 'Agreed price', value: 'AED 415 per hour', sentence: true }]);
    expect(JSON.stringify(lines)).not.toMatch(/265|Tutor/);
  });

  it('shows a family nothing without an agreed price, and a student nothing at all', () => {
    expect(rateSummary({ enrolment: enr({ tutorPay: 265 }), tutor: sarah, viewer: { role: 'parent' } })).toEqual([]);
    expect(rateSummary({ enrolment: both, tutor: sarah, viewer: { role: 'student' } })).toEqual([]);
  });
});

describe('payrollSubtitle', () => {
  it('names the usual rate and counts custom-rate lessons', () => {
    expect(payrollSubtitle({ lessons: 4, hours: 4, customLessons: 0 }, 200)).toBe('4 lessons · 4 hours · usual rate AED 200');
    expect(payrollSubtitle({ lessons: 1, hours: 1, customLessons: 1 }, 200)).toBe('1 lesson · 1 hour · usual rate AED 200 · includes 1 at custom rates');
  });
});

describe('tutorCustomRateLines', () => {
  it("lists only the tutor's own active custom rates", () => {
    const all = [
      enr({ tutorPay: 265 }),
      enr({ id: 'e2', studentId: 'stu-omar', subject: 'Maths', tutorPay: 240, tutorPaySource: 'opportunity' }),
      enr({ id: 'e3', tutorId: 'tut-james', tutorPay: 300 }),
      enr({ id: 'e4', subject: 'Physics' }),
      enr({ id: 'e5', subject: 'Biology', tutorPay: 250, active: false }),
    ];
    expect(tutorCustomRateLines(all, 'tut-sarah', name)).toEqual([
      'Layla Al Mansoori · Chemistry: AED 265 per hour (Custom)',
      'Omar Al Mansoori · Maths: AED 240 per hour (Agreed role rate)',
    ]);
    expect(tutorCustomRateLines(all, undefined, name)).toEqual([]);
  });
});

describe('family price notes', () => {
  const all = [enr({ id: 'e1', studentId: 'stu-omar', subject: 'Arabic', familyPrice: 480 }), enr({ id: 'e2', familyPrice: undefined })];

  it('lists chosen students with a custom price for the subject when booking', () => {
    expect(bookingPriceNotes(['stu-omar', 'stu-layla'], 'Arabic', all, name)).toEqual(['Omar Al Mansoori: custom price AED 480 per hour']);
    expect(bookingPriceNotes(['stu-omar'], 'Chemistry', all, name)).toEqual([]);
    expect(bookingPriceNotes(['stu-omar'], undefined, all, name)).toEqual([]);
  });

  it("notes the family's agreed prices when selling a package", () => {
    const students = [
      { id: 'stu-omar', fullName: 'Omar Al Mansoori', familyId: 'fam-mansoori' },
      { id: 'stu-layla', fullName: 'Layla Al Mansoori', familyId: 'fam-mansoori' },
    ];
    expect(packagePriceNotes(students, 'fam-mansoori', all)).toEqual([
      'Note: Omar Al Mansoori has an agreed price of AED 480 per hour for Arabic. Package credits are used before agreed prices apply.',
    ]);
    expect(packagePriceNotes(students, 'fam-other', all)).toEqual([]);
  });

  it('detects any agreed price among active subjects', () => {
    expect(hasCustomFamilyPrice(all)).toBe(true);
    expect(hasCustomFamilyPrice([enr({ familyPrice: 400, active: false })])).toBe(false);
    expect(hasCustomFamilyPrice([])).toBe(false);
  });

  it('words the parent booking sentence only for an agreed price', () => {
    expect(agreedPriceSentence(enr({ familyPrice: 415 }))).toBe('Extra lessons are charged at your agreed price of AED 415 per hour.');
    expect(agreedPriceSentence(enr())).toBeUndefined();
    expect(agreedPriceSentence(undefined)).toBeUndefined();
  });
});

describe('awardPaySentence', () => {
  it('names the subject when there is one', () => {
    expect(awardPaySentence(240, 'Maths')).toBe('Awarding this role sets AED 240 per hour as the tutor’s pay for this student’s Maths.');
    expect(awardPaySentence(240)).toBe('Awarding this role sets AED 240 per hour as the tutor’s pay for this student’s lessons.');
  });
});
