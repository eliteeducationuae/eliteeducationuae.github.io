import { cancellationOutcome, expandWeekly, findClashes } from '../scheduling';
import type { Lesson } from '../types';

const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'l1',
  tutorId: 't1',
  studentIds: ['s1'],
  serviceId: 'svc',
  start: new Date(2026, 9, 5, 16, 0).toISOString(),
  end: new Date(2026, 9, 5, 17, 0).toISOString(),
  location: 'online',
  status: 'scheduled',
  ...over,
});

describe('expandWeekly', () => {
  it('creates weekly slots keeping wall-clock time', () => {
    const slots = expandWeekly({ start: new Date(2026, 9, 5, 16, 30), durationMin: 60, intervalWeeks: 1, count: 3 });
    expect(slots).toHaveLength(3);
    expect(slots[2].start.getDate()).toBe(19);
    expect(slots[2].start.getHours()).toBe(16);
    expect(slots[2].end.getHours()).toBe(17);
    expect(slots[2].end.getMinutes()).toBe(30);
  });

  it('supports fortnightly and caps runaway counts', () => {
    const slots = expandWeekly({ start: new Date(2026, 0, 1, 9), durationMin: 45, intervalWeeks: 2, count: 500 });
    expect(slots).toHaveLength(104);
    expect(slots[1].start.getDate()).toBe(15);
  });
});

describe('findClashes', () => {
  const existing = [
    lesson({ id: 'a' }),
    lesson({ id: 'b', tutorId: 't2', studentIds: ['s2'] }),
    lesson({ id: 'c', tutorId: 't3', studentIds: ['s3'], status: 'cancelled' }),
  ];
  const slot = { start: new Date(2026, 9, 5, 16, 30), end: new Date(2026, 9, 5, 17, 30) };

  it('flags the same tutor', () => {
    const clashes = findClashes({ ...slot, tutorId: 't1', studentIds: ['s9'] }, existing);
    expect(clashes.map((c) => [c.lesson.id, c.reason])).toEqual([['a', 'tutor']]);
  });

  it('flags a double-booked student with another tutor', () => {
    const clashes = findClashes({ ...slot, tutorId: 't9', studentIds: ['s2'] }, existing);
    expect(clashes).toEqual([expect.objectContaining({ reason: 'student', studentIds: ['s2'] })]);
  });

  it('ignores cancelled lessons, back-to-back lessons and the lesson being edited', () => {
    expect(findClashes({ ...slot, tutorId: 't3', studentIds: ['s3'] }, existing)).toHaveLength(0);
    const after = { start: new Date(2026, 9, 5, 17, 0), end: new Date(2026, 9, 5, 18, 0) };
    expect(findClashes({ ...after, tutorId: 't1', studentIds: ['s1'] }, existing)).toHaveLength(0);
    expect(findClashes({ ...slot, tutorId: 't1', studentIds: ['s1'], ignoreLessonId: 'a' }, existing)).toHaveLength(0);
  });
});

describe('cancellationOutcome', () => {
  const policy = { cancellationHours: 24, lateCancelFee: 1 };
  const l = lesson({});

  it('is free with enough notice', () => {
    const out = cancellationOutcome(l, new Date(2026, 9, 3, 12), policy);
    expect(out).toMatchObject({ status: 'cancelled', chargeable: false, fee: 0 });
  });

  it('is chargeable inside the window', () => {
    const out = cancellationOutcome(l, new Date(2026, 9, 5, 9), policy);
    expect(out).toMatchObject({ status: 'late-cancel', chargeable: true, fee: 1 });
    expect(out.hoursNotice).toBe(7);
  });

  it('can be waived, and a zero fee is never chargeable', () => {
    expect(cancellationOutcome(l, new Date(2026, 9, 5, 9), policy, { waiveFee: true }).chargeable).toBe(false);
    expect(cancellationOutcome(l, new Date(2026, 9, 5, 9), { ...policy, lateCancelFee: 0 }).status).toBe('cancelled');
  });
});
