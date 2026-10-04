import { monthFigures, revenueBySubject, toCSV, type FinanceData } from '../finance';
import { AT_RISK_THRESHOLD, enquiryConversion, familyActivity, studentRisk, tutorUtilisation } from '../insights';
import { factsForAi, reportFacts, sampleReportDraft } from '../reports';
import { formatIban, isValidIban, maskIban, tutorInvoiceLines, tutorInvoiceNumber, tutorInvoiceTotal } from '../tutor-pay';
import type { Charge, Homework, Invoice, Lesson, Service, Student, Tutor, TutorInvoice } from '../types';

const tutor: Tutor = { id: 'abcd1234-0000', fullName: 'Tia One', email: '', hourlyPay: 200, subjects: [], curricula: [], phases: [], color: '' };
const service: Service = { id: 'svc', name: 'IB 1:1', durationMin: 60, rate: 450 };
const student: Student = { id: 's1', familyId: 'f1', fullName: 'Sami Ahmed', curriculum: 'IB', syllabusId: 'ib-aa-sl' };
const at = (m: number, d: number, h = 16) => new Date(2026, m, d, h);
const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'l',
  tutorId: tutor.id,
  studentIds: ['s1'],
  serviceId: 'svc',
  start: at(8, 10).toISOString(),
  end: at(8, 10, 17).toISOString(),
  location: 'online',
  status: 'completed',
  ...over,
});

describe('tutor invoices (mirror create_tutor_invoice)', () => {
  const lessons = [
    lesson({ id: 'a' }),
    lesson({ id: 'b', start: at(8, 17).toISOString(), end: new Date(2026, 8, 17, 17, 30).toISOString() }),
    lesson({ id: 'c', start: at(8, 20).toISOString(), status: 'cancelled' }),
    lesson({ id: 'd', start: at(8, 22).toISOString(), end: at(8, 22, 17).toISOString(), status: 'late-cancel' }),
    lesson({ id: 'e', start: at(9, 1).toISOString() }),
  ];

  it('bills paid lessons in the month by the hour', () => {
    const lines = tutorInvoiceLines(tutor, lessons, [service], [student], at(8, 1), { payTutorForLateCancel: true });
    expect(lines.map((l) => [l.lessonId, l.quantity])).toEqual([
      ['a', 1],
      ['b', 1.5],
      ['d', 1],
    ]);
    expect(lines[0].description).toBe('10 Sep — IB 1:1 — Sami');
    expect(lines[2].description).toContain('(late-cancel)');
    expect(tutorInvoiceTotal(lines)).toBe(700);
  });

  it('respects the late-cancel setting and skips already-invoiced lessons', () => {
    const lines = tutorInvoiceLines(tutor, lessons, [service], [student], at(8, 1), { payTutorForLateCancel: false }, new Set(['a']));
    expect(lines.map((l) => l.lessonId)).toEqual(['b']);
  });

  it('numbers invoices like the database', () => {
    expect(tutorInvoiceNumber('abcd1234-0000', at(8, 1))).toBe('TI-202609-ABCD');
  });
});

describe('bank details', () => {
  it('validates IBANs with the checksum', () => {
    expect(isValidIban('AE07 0331 2345 6789 0123 456')).toBe(true);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isValidIban('AE08 0331 2345 6789 0123 456')).toBe(false);
    expect(isValidIban('hello')).toBe(false);
  });

  it('masks and formats', () => {
    expect(maskIban('AE070331234567890123456')).toBe('AE07 •••• •••• 3456');
    expect(formatIban('ae070331234567890123456')).toBe('AE07 0331 2345 6789 0123 456');
  });
});

describe('profit and loss', () => {
  const charges: Charge[] = [
    { id: 'c1', lessonId: 'a', studentId: 's1', familyId: 'f1', description: '', amount: 450, status: 'invoiced', date: at(8, 10).toISOString() },
    { id: 'c2', lessonId: 'b', studentId: 's1', familyId: 'f1', description: '', amount: 450, status: 'unbilled', date: at(8, 17).toISOString() },
    { id: 'c3', lessonId: 'e', studentId: 's1', familyId: 'f1', description: '', amount: 450, status: 'unbilled', date: at(9, 1).toISOString() },
  ];
  const invoice: Invoice = {
    id: 'i', number: 'INV-1', familyId: 'f1', issueDate: '2026-09-20', dueDate: '2026-09-27', status: 'paid', vatRate: 0,
    items: [{ description: '', quantity: 1, unitPrice: 450 }],
    payments: [{ id: 'p', invoiceId: 'i', amount: 450, method: 'card', paidAt: at(8, 21).toISOString() }],
  };
  const base: FinanceData = {
    charges,
    packages: [],
    invoices: [invoice],
    lessons: [lesson({ id: 'a' }), lesson({ id: 'b', start: at(8, 17).toISOString(), end: at(8, 17, 17).toISOString() })],
    tutors: [tutor],
    tutorInvoices: [],
    expenses: [{ id: 'x', date: '2026-09-05', category: 'Software', amount: 100, vatAmount: 0 }],
    settings: { payTutorForLateCancel: true },
  };

  it('estimates tutor costs from lessons until an invoice is submitted', () => {
    const sep = monthFigures(at(8, 1), base);
    expect(sep).toMatchObject({ month: '2026-09', revenue: 900, tutorCosts: 400, tutorCostsEstimated: true, expenses: 100, profit: 400, cashIn: 450 });
    expect(sep.margin).toBeCloseTo(400 / 900);
  });

  it('uses the tutor invoice once submitted', () => {
    const ti: TutorInvoice = {
      id: 't', createdAt: '', tutorId: tutor.id, number: 'TI', periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'approved',
      items: [{ description: 'all', quantity: 1, unitPrice: 520 }],
    };
    const sep = monthFigures(at(8, 1), { ...base, tutorInvoices: [ti] });
    expect(sep).toMatchObject({ tutorCosts: 520, tutorCostsEstimated: false, profit: 280 });
  });

  it('splits revenue by subject and exports CSV safely', () => {
    const lessons = [lesson({ id: 'a', subject: 'Maths' }), lesson({ id: 'b', subject: 'Chemistry' }), lesson({ id: 'e', subject: ' maths ' })];
    expect(revenueBySubject(charges, lessons, [])).toEqual([
      { subject: 'Maths', revenue: 900 },
      { subject: 'Chemistry', revenue: 450 },
    ]);
    // A charge whose lesson has no subject (or is unknown) counts as Other.
    expect(revenueBySubject(charges, [lesson({ id: 'a' })], [])).toEqual([{ subject: 'Other', revenue: 1350 }]);
    expect(toCSV([['Name', 'Note'], ['Sami', 'said "hi", then left']])).toBe('Name,Note\r\nSami,"said ""hi"", then left"');
  });
});

describe('at-risk students', () => {
  const now = at(9, 4, 12);
  it('flags missed lessons, homework, nothing booked and overdue invoices', () => {
    const lessons = [1, 8, 15, 22].map((d, i) => lesson({ id: `x${i}`, start: at(8, d).toISOString(), end: at(8, d, 17).toISOString(), status: i < 2 ? 'no-show' : 'completed' }));
    const homework: Homework[] = [1, 2, 3, 4].map((i) => ({ id: `h${i}`, studentId: 's1', title: '', dueDate: `2026-09-${10 + i}`, done: i === 1 }));
    const invoice: Invoice = { id: 'i', number: '', familyId: 'f1', issueDate: '2026-09-01', dueDate: '2026-09-08', status: 'sent', vatRate: 0, items: [{ description: '', quantity: 1, unitPrice: 100 }], payments: [] };
    const risk = studentRisk(student, { lessons, homework, ratings: [], invoices: [invoice] }, now);
    expect(risk.signals.map((s) => s.key).sort()).toEqual(['attendance', 'homework', 'no-lessons', 'overdue']);
    expect(risk.score).toBe(100);
    expect(risk.score).toBeGreaterThanOrEqual(AT_RISK_THRESHOLD);
  });

  it('is quiet for a student who is on track', () => {
    const lessons = [lesson({ id: 'p', start: at(8, 28).toISOString() }), lesson({ id: 'f', status: 'scheduled', start: at(9, 10).toISOString(), end: at(9, 10, 17).toISOString() })];
    expect(studentRisk(student, { lessons, homework: [], ratings: [], invoices: [] }, now)).toMatchObject({ score: 0, signals: [] });
  });
});

describe('tutor utilisation', () => {
  it('compares hours taught with hours offered', () => {
    // Mon 7 Sep 2026: 3 hours available, 1 hour taught.
    const u = tutorUtilisation(tutor.id, [lesson({ start: at(8, 7).toISOString(), end: at(8, 7, 17).toISOString() })], [{ id: 'a', tutorId: tutor.id, weekday: 0, start: '15:00', end: '18:00' }], at(8, 7, 0), at(8, 8, 0));
    expect(u).toMatchObject({ taughtHours: 1, availableHours: 3 });
    expect(u.rate).toBeCloseTo(1 / 3);
  });
});

describe('families and enquiries', () => {
  const now = at(9, 4, 12);
  const kids: Student[] = [
    { ...student, id: 'a1', familyId: 'fa' },
    { ...student, id: 'b1', familyId: 'fb' },
    { ...student, id: 'c1', familyId: 'fc' },
  ];
  it('counts active, new and lapsed families', () => {
    const lessons = [
      lesson({ id: '1', studentIds: ['a1'], start: at(3, 1).toISOString() }),
      lesson({ id: '2', studentIds: ['a1'], start: at(8, 25).toISOString() }),
      lesson({ id: '3', studentIds: ['b1'], start: at(9, 1).toISOString() }),
      lesson({ id: '4', studentIds: ['c1'], start: at(6, 1).toISOString() }),
      lesson({ id: '5', studentIds: ['c1'], start: at(9, 20).toISOString(), status: 'cancelled' }),
    ];
    expect(familyActivity(kids, lessons, now)).toEqual({ active: 2, new: 1, lapsed: 1, lapsedFamilyIds: ['fc'] });
  });
  it('measures enquiry conversion on decided enquiries', () => {
    const e = (createdAt: string, status: 'new' | 'enrolled' | 'lost') => ({ createdAt, status });
    expect(enquiryConversion([e('2026-09-01', 'enrolled'), e('2026-09-02', 'lost'), e('2026-09-03', 'enrolled'), e('2026-09-04', 'new'), e('2026-01-01', 'lost')], '2026-08-01')).toEqual({
      total: 4, enrolled: 2, lost: 1, open: 1, rate: 2 / 3,
    });
  });
});

describe('report facts and sample drafts', () => {
  it('summarises the term and writes a usable draft', () => {
    const lessons = [lesson({ id: 'a' }), lesson({ id: 'b', start: at(8, 17).toISOString(), status: 'no-show' })];
    const facts = reportFacts(
      student,
      {
        lessons,
        notes: [{ lessonId: 'a', summary: 'Vectors went well', topicIds: [], attendance: {}, createdAt: '' }],
        homework: [{ id: 'h', studentId: 's1', title: '', dueDate: '2026-09-12', done: true }],
        ratings: [
          { id: 'r1', studentId: 's1', topicId: 'calc', rating: 2, ratedAt: at(8, 3).toISOString() },
          { id: 'r2', studentId: 's1', topicId: 'calc', rating: 4, ratedAt: at(8, 10).toISOString() },
          { id: 'r3', studentId: 's1', topicId: 'vec', rating: 2, ratedAt: at(8, 10).toISOString() },
        ],
      },
      at(8, 1).toISOString(),
    );
    expect(facts).toMatchObject({ firstName: 'Sami', lessonsTaught: 1, attendancePercent: 50, homeworkPercent: 100, recentNotes: ['Vectors went well'] });
    expect(facts.improved.map((m) => m.topicId)).toEqual(['calc']);
    expect(facts.needsWork.map((m) => m.topicId)).toEqual(['vec']);
    const draft = sampleReportDraft(facts, (id) => ({ calc: 'Calculus', vec: 'Vectors' })[id] ?? id);
    expect(draft.strengths).toContain('Calculus');
    expect(draft.nextSteps).toContain('Vectors');
    expect(draft.comment).toContain('Sami has attended 50% of lessons');

    const ai = factsForAi(facts, (id) => ({ calc: 'Calculus', vec: 'Vectors' })[id] ?? id, { curriculum: 'IB', syllabus: 'IB AA SL', effort: 4, progress: 3 });
    expect(ai).toMatchObject({ firstName: 'Sami', curriculum: 'IB AA SL', effort: 'Very good', progress: 'As expected', needsWork: ['Vectors (Emerging)'] });
    expect(JSON.stringify(ai)).not.toContain('Ahmed');
  });
});
