import {
  chargesForLesson,
  displayStatus,
  formatAED,
  invoiceTotals,
  itemsFromCharges,
  newInvoiceDraft,
  tutorEarnings,
} from '../billing';
import type { Charge, Invoice, Lesson, LessonPackage, Service, Student, Tutor } from '../types';

const service: Service = { id: 'svc', name: 'IB AA HL 1:1', durationMin: 60, rate: 450 };
const students: Student[] = [
  { id: 's1', familyId: 'f1', fullName: 'Omar', curriculum: 'IB', syllabusId: 'ib-aa-hl' },
  { id: 's2', familyId: 'f2', fullName: 'Lina', curriculum: 'IB', syllabusId: 'ib-aa-hl' },
];
const settings = { lateCancelFee: 1, noShowFee: 0.5 };
const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: 'l1',
  tutorId: 't1',
  studentIds: ['s1'],
  serviceId: 'svc',
  start: new Date(2026, 9, 5, 16).toISOString(),
  end: new Date(2026, 9, 5, 17, 30).toISOString(),
  location: 'online',
  status: 'completed',
  ...over,
});
const pkg = (over: Partial<LessonPackage> = {}): LessonPackage => ({
  id: 'p1',
  familyId: 'f1',
  name: '10 lessons',
  lessonsTotal: 10,
  lessonsUsed: 9,
  price: 4000,
  purchasedAt: '2026-09-01',
  ...over,
});

describe('chargesForLesson', () => {
  it('charges each student in a group the full rate', () => {
    const { charges, packageDraws } = chargesForLesson(lesson({ studentIds: ['s1', 's2'] }), service, students, [], settings);
    expect(charges.map((c) => [c.familyId, c.amount, c.status])).toEqual([
      ['f1', 450, 'unbilled'],
      ['f2', 450, 'unbilled'],
    ]);
    expect(packageDraws).toEqual([]);
  });

  it('draws a package credit instead of invoicing, only once per remaining credit', () => {
    const l = lesson({ studentIds: ['s1', 's1'] });
    const { charges, packageDraws } = chargesForLesson(l, service, students, [pkg()], settings);
    expect(packageDraws).toEqual(['p1']);
    expect(charges.map((c) => c.status)).toEqual(['package', 'unbilled']);
  });

  it('ignores packages for other services or past expiry', () => {
    const packages = [pkg({ serviceId: 'other' }), pkg({ id: 'p2', expiresAt: '2026-09-30' })];
    const { packageDraws } = chargesForLesson(lesson(), service, students, packages, settings);
    expect(packageDraws).toEqual([]);
  });

  it('applies no-show and late-cancel fees, and invoices reduced fees even with credits', () => {
    const noShow = chargesForLesson(lesson({ status: 'no-show' }), service, students, [pkg()], settings);
    expect(noShow.charges[0]).toMatchObject({ amount: 225, status: 'unbilled' });
    expect(noShow.charges[0].description).toContain('missed lesson');

    const late = chargesForLesson(lesson({ status: 'late-cancel' }), service, students, [], settings);
    expect(late.charges[0]).toMatchObject({ amount: 450 });

    const absent = chargesForLesson(lesson(), service, students, [], settings, { s1: 'absent' });
    expect(absent.charges[0].amount).toBe(225);
  });

  it('charges nothing for scheduled or cancelled lessons, or zero fees', () => {
    expect(chargesForLesson(lesson({ status: 'scheduled' }), service, students, [], settings).charges).toEqual([]);
    expect(chargesForLesson(lesson({ status: 'cancelled' }), service, students, [], settings).charges).toEqual([]);
    expect(
      chargesForLesson(lesson({ status: 'no-show' }), service, students, [], { ...settings, noShowFee: 0 }).charges,
    ).toEqual([]);
  });
});

describe('invoices', () => {
  const invoice: Invoice = {
    id: 'i1',
    number: 'INV-0001',
    familyId: 'f1',
    issueDate: '2026-10-01',
    dueDate: '2026-10-08',
    status: 'sent',
    items: [
      { description: 'a', quantity: 2, unitPrice: 450 },
      { description: 'b', quantity: 1, unitPrice: 99.99 },
    ],
    vatRate: 0.05,
    payments: [{ id: 'p', invoiceId: 'i1', amount: 500, method: 'card', paidAt: '2026-10-02' }],
  };

  it('totals with VAT and payments', () => {
    expect(invoiceTotals(invoice)).toEqual({ subtotal: 999.99, vat: 50, total: 1049.99, paid: 500, credited: 0, refunded: 0, balance: 549.99 });
  });

  it('derives part-paid, overdue and paid', () => {
    expect(displayStatus(invoice, new Date(2026, 9, 5))).toBe('part-paid');
    expect(displayStatus(invoice, new Date(2026, 9, 9))).toBe('overdue');
    const settled = { ...invoice, payments: [{ ...invoice.payments[0], amount: 1049.99 }] };
    expect(displayStatus(settled, new Date(2026, 9, 9))).toBe('paid');
    expect(displayStatus({ ...invoice, status: 'draft' })).toBe('draft');
  });

  it('builds a draft from unbilled charges only, oldest first', () => {
    const charges: Charge[] = [
      { id: 'c2', lessonId: 'l2', studentId: 's1', familyId: 'f1', description: 'later', amount: 450, status: 'unbilled', date: '2026-10-05T12:00:00Z' },
      { id: 'c1', lessonId: 'l1', studentId: 's1', familyId: 'f1', description: 'earlier', amount: 400, status: 'unbilled', date: '2026-10-01T12:00:00Z' },
      { id: 'c3', lessonId: 'l3', studentId: 's1', familyId: 'f1', description: 'done', amount: 400, status: 'invoiced', date: '2026-09-01T12:00:00Z' },
    ];
    const items = itemsFromCharges(charges);
    expect(items.map((i) => i.chargeId)).toEqual(['c1', 'c2']);
    const draft = newInvoiceDraft('f1', items, { vatRate: 0, invoiceDueDays: 7, nextInvoiceNumber: 42 }, new Date(2026, 9, 2));
    expect(draft).toMatchObject({ number: 'INV-0042', issueDate: '2026-10-02', dueDate: '2026-10-09', status: 'draft' });
  });

  it('formats AED', () => {
    expect(formatAED(12500)).toBe('AED 12,500');
    expect(formatAED(99.5)).toBe('AED 99.50');
  });
});

describe('tutorEarnings', () => {
  const tutor: Tutor = { id: 't1', fullName: 'T', email: 't@x', hourlyPay: 200, subjects: [], curricula: [], phases: [], color: '#000' };
  it('pays completed, no-show and (optionally) late-cancelled lessons by duration', () => {
    const lessons = [
      lesson({ id: 'a' }),
      lesson({ id: 'b', status: 'late-cancel' }),
      lesson({ id: 'c', status: 'cancelled' }),
      lesson({ id: 'd', tutorId: 'other' }),
    ];
    expect(tutorEarnings(tutor, lessons, { payTutorForLateCancel: true })).toEqual({ lessons: 2, hours: 3, amount: 600 });
    expect(tutorEarnings(tutor, lessons, { payTutorForLateCancel: false })).toEqual({ lessons: 1, hours: 1.5, amount: 300 });
  });
});
