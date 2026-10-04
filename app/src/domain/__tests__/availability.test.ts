import { coverOptions, expandWeeklySkipping, lessonsDuringAbsence, openSlots } from '../scheduling';
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
  lessons: [lesson({})],
  closures: [],
  absences: [],
  noticeHours: 24,
  now: new Date(2026, 9, 1),
};
const times = (slots: { start: Date }[]) => slots.map((s) => `${s.start.getHours()}:${String(s.start.getMinutes()).padStart(2, '0')}`);

describe('openSlots (mirrors public.open_slots)', () => {
  it('offers 30-minute steps inside availability, avoiding existing lessons', () => {
    expect(times(openSlots(base))).toEqual(['15:00', '17:00']);
  });

  it('ignores the lesson being rescheduled and cancelled lessons', () => {
    expect(times(openSlots({ ...base, ignoreLessonId: 'l' }))).toEqual(['15:00', '15:30', '16:00', '16:30', '17:00']);
    expect(openSlots({ ...base, lessons: [lesson({ status: 'cancelled' })] })).toHaveLength(5);
  });

  it('respects closures, absences and booking notice', () => {
    expect(openSlots({ ...base, closures: [{ id: 'c', name: 'Holiday', startDate: '2026-10-05', endDate: '2026-10-05' }] })).toEqual([]);
    expect(openSlots({ ...base, absences: [{ id: 'x', tutorId: 't1', startDate: '2026-10-01', endDate: '2026-10-09' }] })).toEqual([]);
    expect(times(openSlots({ ...base, now: at(-1, 16, 15) }))).toEqual(['17:00']);
  });
});

describe('expandWeeklySkipping', () => {
  it('skips closure weeks and still schedules the requested number', () => {
    const { slots, skipped } = expandWeeklySkipping(
      { start: at(0, 16), durationMin: 60, intervalWeeks: 1, count: 3 },
      [{ startDate: '2026-10-12', endDate: '2026-10-16' }],
    );
    expect(slots.map((s) => s.start.getDate())).toEqual([5, 19, 26]);
    expect(skipped.map((d) => d.getDate())).toEqual([12]);
  });
});

describe('cover', () => {
  const tutors: Tutor[] = ['t1', 't2', 't3'].map((id) => ({ id, fullName: id.toUpperCase(), email: '', hourlyPay: 0, subjects: [], curricula: [], phases: [], color: '' }));
  it('lists free tutors, available ones first, excluding absent or busy tutors', () => {
    const lessons = [lesson({}), lesson({ id: 'busy', tutorId: 't3', studentIds: ['s9'] })];
    expect(coverOptions(lessons[0], tutors, lessons, avail, []).map((o) => [o.tutor.id, o.available])).toEqual([['t2', true]]);
    const noBusy = [lesson({})];
    expect(coverOptions(noBusy[0], tutors, noBusy, avail, []).map((o) => [o.tutor.id, o.available])).toEqual([
      ['t2', true],
      ['t3', false],
    ]);
    expect(
      coverOptions(noBusy[0], tutors, noBusy, avail, [{ id: 'a', tutorId: 't2', startDate: '2026-10-05', endDate: '2026-10-05' }]).map((o) => o.tutor.id),
    ).toEqual(['t3']);
  });

  it('finds lessons affected by an absence', () => {
    const lessons = [lesson({}), lesson({ id: 'later', start: at(10, 16).toISOString(), end: at(10, 17).toISOString() })];
    expect(lessonsDuringAbsence({ id: 'a', tutorId: 't1', startDate: '2026-10-05', endDate: '2026-10-06' }, lessons).map((l) => l.id)).toEqual(['l']);
  });
});
