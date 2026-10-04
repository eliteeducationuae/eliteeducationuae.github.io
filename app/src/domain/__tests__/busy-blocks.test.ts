import { coverOptions, findBusyClashes, openSlots, type BusyTime } from '../scheduling';
import type { Availability, Lesson, Tutor } from '../types';

// Monday 5 Oct 2026
const MON = new Date(2026, 9, 5);
const at = (day: number, h: number, m = 0) => new Date(2026, 9, 5 + day, h, m);
const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'l',
  tutorId: 't1',
  studentIds: ['s1'],
  serviceId: 'svc',
  start: at(0, 16).toISOString(),
  end: at(0, 17).toISOString(),
  location: 'online',
  status: 'scheduled',
  ...over,
});
const busy = (tutorId: string, from: Date, to: Date): BusyTime => ({ tutorId, start: from.toISOString(), end: to.toISOString() });
const avail: Availability[] = [
  { id: 'a', tutorId: 't1', weekday: 0, start: '15:00', end: '18:00' },
  { id: 'b', tutorId: 't2', weekday: 0, start: '09:00', end: '20:00' },
];
const base = {
  tutorId: 't1',
  from: MON,
  days: 1,
  durationMin: 60,
  availability: avail,
  lessons: [] as Lesson[],
  closures: [],
  absences: [],
  noticeHours: 24,
  now: new Date(2026, 9, 1),
};
const times = (slots: { start: Date }[]) => slots.map((s) => `${s.start.getHours()}:${String(s.start.getMinutes()).padStart(2, '0')}`);

describe('openSlots with Google Calendar busy blocks', () => {
  it('is unchanged without busy blocks', () => {
    expect(times(openSlots(base))).toEqual(['15:00', '15:30', '16:00', '16:30', '17:00']);
    expect(times(openSlots({ ...base, busyBlocks: [] }))).toEqual(['15:00', '15:30', '16:00', '16:30', '17:00']);
  });

  it('removes starts that overlap a busy block, keeping touching edges', () => {
    const busyBlocks = [busy('t1', at(0, 16), at(0, 17, 30))];
    // 15:00-16:00 ends exactly as the block starts, so it stays.
    expect(times(openSlots({ ...base, busyBlocks }))).toEqual(['15:00']);
    // With 30-minute lessons, 17:30-18:00 starts exactly as the block ends and fits before 18:00.
    expect(times(openSlots({ ...base, durationMin: 30, busyBlocks }))).toEqual(['15:00', '15:30', '17:30']);
  });

  it('does not hide a slot that starts exactly when a busy block ends', () => {
    const busyBlocks = [busy('t1', at(0, 14), at(0, 15))];
    expect(times(openSlots({ ...base, busyBlocks }))).toEqual(['15:00', '15:30', '16:00', '16:30', '17:00']);
  });

  it("ignores another tutor's busy blocks", () => {
    const busyBlocks = [busy('t2', at(0, 15), at(0, 18))];
    expect(times(openSlots({ ...base, busyBlocks }))).toEqual(['15:00', '15:30', '16:00', '16:30', '17:00']);
  });

  it('combines busy blocks with existing lessons', () => {
    const busyBlocks = [busy('t1', at(0, 17), at(0, 18))];
    expect(times(openSlots({ ...base, lessons: [lesson({ start: at(0, 15).toISOString(), end: at(0, 16).toISOString() })], busyBlocks }))).toEqual([
      '16:00',
    ]);
  });
});

describe('findBusyClashes', () => {
  const slot = { tutorId: 't1', start: at(0, 16), end: at(0, 17) };
  it('returns overlapping blocks for the tutor, earliest first', () => {
    const late = { ...busy('t1', at(0, 16, 30), at(0, 18)), id: 'late' };
    const early = { ...busy('t1', at(0, 15, 30), at(0, 16, 15)), id: 'early' };
    expect(findBusyClashes(slot, [late, early]).map((b) => b.id)).toEqual(['early', 'late']);
  });

  it('ignores touching edges and other tutors', () => {
    expect(findBusyClashes(slot, [busy('t1', at(0, 15), at(0, 16)), busy('t1', at(0, 17), at(0, 18))])).toEqual([]);
    expect(findBusyClashes(slot, [busy('t2', at(0, 16), at(0, 17))])).toEqual([]);
  });
});

describe('coverOptions with busy blocks', () => {
  const tutors: Tutor[] = ['t1', 't2', 't3'].map((id) => ({ id, fullName: id.toUpperCase(), email: '', hourlyPay: 0, subjects: [], color: '' }));
  const lessons = [lesson({})];
  it('keeps the old behaviour by default', () => {
    expect(coverOptions(lessons[0], tutors, lessons, avail, []).map((o) => o.tutor.id)).toEqual(['t2', 't3']);
  });

  it('excludes a tutor who is busy in their Google Calendar', () => {
    const blocks = [busy('t2', at(0, 16, 30), at(0, 17, 30)), busy('t3', at(0, 17), at(0, 18))];
    expect(coverOptions(lessons[0], tutors, lessons, avail, [], blocks).map((o) => o.tutor.id)).toEqual(['t3']);
  });
});
