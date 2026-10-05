import { invoiceTotals } from '@/domain/billing';

import { AccessError, cmd, q } from '../demo/db';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026, midday
const viewer = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;
const YEAR = { from: '2000-01-01', to: '2100-01-01' };

describe('demo seed', () => {
  const db = createSeed(NOW);

  it('builds a consistent history', () => {
    expect(db.lessons.length).toBeGreaterThan(50);
    const past = db.lessons.filter((l) => new Date(l.end) < new Date(2026, 9, 2));
    // Exactly one past lesson is left waiting for notes, to demo that workflow.
    expect(past.filter((l) => l.status === 'scheduled')).toHaveLength(1);
    expect(db.notes.length).toBe(db.lessons.filter((l) => l.status === 'completed').length);
    // Older charges are invoiced; the last fortnight is waiting to be billed.
    const cutoff = new Date(2026, 8, 18).toISOString();
    expect(db.charges.every((c) => c.status !== 'unbilled' || c.date >= cutoff)).toBe(true);
    expect(db.charges.some((c) => c.status === 'unbilled')).toBe(true);
    const pkg = db.packages[0];
    expect(pkg.lessonsUsed).toBe(db.charges.filter((c) => c.packageId === pkg.id).length);
    expect(pkg.lessonsUsed).toBeLessThanOrEqual(pkg.lessonsTotal);
  });

  it('has lessons today so the dashboard is never empty', () => {
    const today = db.lessons.filter((l) => new Date(l.start).toDateString() === NOW.toDateString());
    expect(today.length).toBeGreaterThanOrEqual(3);
  });
});

describe('visibility (mirrors row-level security)', () => {
  const db = createSeed(NOW);

  it('parents only see their own family', () => {
    const parent = viewer(db, 'parent');
    expect(q.students(db, parent).map((s) => s.familyId)).toEqual(['f-mansoori', 'f-mansoori']);
    expect(q.invoices(db, parent).every((i) => i.familyId === 'f-mansoori')).toBe(true);
    expect(q.lessons(db, parent, YEAR.from, YEAR.to).every((l) => l.studentIds.some((id) => id === 's-omar' || id === 's-layla'))).toBe(true);
    expect(q.charges(db, parent, 'f-sharma')).toEqual([]);
  });

  it('hides private tutor notes and student notes from families', () => {
    const parent = viewer(db, 'parent');
    expect(q.notes(db, parent).some((n) => n.privateNote)).toBe(false);
    expect(q.notes(db, viewer(db, 'admin')).some((n) => n.privateNote)).toBe(true);
    expect(q.students(db, parent).every((s) => s.notes === undefined)).toBe(true);
  });

  it('tutors see their own lessons and students but no billing', () => {
    const tutor = viewer(db, 'tutor');
    expect(q.lessons(db, tutor, YEAR.from, YEAR.to).every((l) => l.tutorId === 't-sarah')).toBe(true);
    // Sarah covers one of Charlotte's lessons in the seed, so Charlotte is hers to see too.
    expect(q.students(db, tutor).map((s) => s.id).sort()).toEqual(['s-charlotte', 's-karim', 's-layla', 's-yasmin']);
    expect(q.invoices(db, tutor)).toEqual([]);
  });

  it('students see only themselves', () => {
    const student = viewer(db, 'student');
    expect(q.students(db, student).map((s) => s.id)).toEqual(['s-omar']);
    expect(q.homework(db, student).every((h) => h.studentId === 's-omar')).toBe(true);
  });
});

describe('commands', () => {
  it('completing a lesson records notes, ratings, homework and a charge', () => {
    const db = createSeed(NOW);
    const admin = viewer(db, 'admin');
    const lesson = db.lessons.find((l) => l.status === 'scheduled' && l.studentIds.includes('s-omar'))!;
    const chargesBefore = db.charges.length;
    cmd.completeLesson(db, admin, {
      lessonId: lesson.id,
      status: 'completed',
      attendance: { 's-omar': 'present' },
      summary: 'Vectors',
      topicIds: ['x'],
      ratings: [{ studentId: 's-omar', topicId: 'x', rating: 4 }],
      homework: [{ studentId: 's-omar', title: 'Ex 4B', dueDate: '2026-10-09' }],
    });
    expect(lesson.status).toBe('completed');
    expect(db.charges.length).toBe(chargesBefore + 1);
    expect(db.charges[db.charges.length - 1]).toMatchObject({ amount: 450, status: 'unbilled', familyId: 'f-mansoori' });
    expect(() =>
      cmd.completeLesson(db, admin, { lessonId: lesson.id, status: 'completed', attendance: {}, summary: '', topicIds: [], ratings: [], homework: [] }),
    ).toThrow('already been recorded');
  });

  it('a tutor cannot complete someone else’s lesson', () => {
    const db = createSeed(NOW);
    const lesson = db.lessons.find((l) => l.status === 'scheduled' && l.tutorId === 't-craig')!;
    expect(() =>
      cmd.completeLesson(db, viewer(db, 'tutor'), { lessonId: lesson.id, status: 'completed', attendance: {}, summary: '', topicIds: [], ratings: [], homework: [] }),
    ).toThrow(AccessError);
  });

  it('a parent cancelling late is charged; a tutor cancelling never charges the family', () => {
    const db = createSeed(NOW);
    const soon = db.lessons.find((l) => l.status === 'scheduled' && l.studentIds.includes('s-omar') && new Date(l.start) > NOW)!;
    const outcome = cmd.cancelLesson(db, viewer(db, 'parent'), soon.id, 'Clash', false, NOW);
    expect(outcome.status).toBe('late-cancel'); // today 18:00, 6 hours' notice
    expect(db.charges.some((c) => c.lessonId === soon.id && c.amount === 450)).toBe(true);

    const tutorLesson = db.lessons.find((l) => l.status === 'scheduled' && l.tutorId === 't-sarah' && new Date(l.start) > NOW)!;
    expect(cmd.cancelLesson(db, viewer(db, 'tutor'), tutorLesson.id, 'Ill', false, NOW).chargeable).toBe(false);
  });

  it('invoices unbilled charges and takes payment', () => {
    const db = createSeed(NOW);
    const admin = viewer(db, 'admin');
    const lesson = db.lessons.find((l) => l.status === 'scheduled' && l.studentIds.includes('s-charlotte'))!;
    cmd.completeLesson(db, admin, { lessonId: lesson.id, status: 'completed', attendance: {}, summary: 's', topicIds: [], ratings: [], homework: [] });
    const invoice = cmd.invoiceUnbilled(db, admin, 'f-hughes', NOW)!;
    expect(invoice.items.length).toBeGreaterThanOrEqual(1);
    expect(cmd.invoiceUnbilled(db, admin, 'f-hughes', NOW)).toBeNull();
    const { total } = invoiceTotals(invoice);
    cmd.recordPayment(db, viewer(db, 'admin'), invoice.id, total, 'card', undefined, NOW);
    expect(invoice.status).toBe('paid');
  });

  it('selling a package issues an invoice and credits are used first', () => {
    const db = createSeed(NOW);
    const admin = viewer(db, 'admin');
    const invoice = cmd.sellPackage(db, admin, { familyId: 'f-hughes', name: 'IB 5 pack', serviceId: 'svc-ib', lessonsTotal: 5, price: 2000 }, NOW);
    // The seeded business is VAT registered: 5% on top of the package price.
    expect(invoiceTotals(invoice)).toMatchObject({ subtotal: 2000, vat: 100, total: 2100 });
    const lesson = db.lessons.find((l) => l.status === 'scheduled' && l.studentIds.includes('s-charlotte'))!;
    cmd.completeLesson(db, admin, { lessonId: lesson.id, status: 'completed', attendance: {}, summary: 's', topicIds: [], ratings: [], homework: [] });
    const pkg = db.packages.find((p) => p.name === 'IB 5 pack')!;
    expect(pkg.lessonsUsed).toBe(1);
  });
});
