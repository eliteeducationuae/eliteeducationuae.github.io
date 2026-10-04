import { factsForAi, reportFacts } from '../reports';
import type { Homework, Lesson, LessonNote, Student, TopicRating } from '../types';

const student: Student = { id: 's1', familyId: 'f1', fullName: 'Layla Al Mansoori' };
const lesson = (id: string, subject: string | undefined, day: number, status: Lesson['status'] = 'completed'): Lesson => ({
  id,
  tutorId: 't1',
  studentIds: ['s1'],
  serviceId: 'svc',
  subject,
  start: new Date(2026, 8, day, 16).toISOString(),
  end: new Date(2026, 8, day, 17).toISOString(),
  location: 'online',
  status,
});
const rating = (id: string, topicId: string, lessonId: string | undefined, value: TopicRating['rating'], day: number): TopicRating => ({
  id,
  studentId: 's1',
  topicId,
  lessonId,
  rating: value,
  ratedAt: new Date(2026, 8, day, 16).toISOString(),
});

const data = {
  lessons: [lesson('m1', 'Maths', 2), lesson('m2', 'Maths', 9, 'no-show'), lesson('c1', 'Chemistry', 3), lesson('c2', ' chemistry', 10), lesson('x', undefined, 11)],
  notes: [
    { lessonId: 'm1', summary: 'Quadratics', topicIds: [], attendance: {}, createdAt: '' },
    { lessonId: 'c1', summary: 'The mole', topicIds: [], attendance: {}, createdAt: '' },
  ] as LessonNote[],
  homework: [
    { id: 'hm', studentId: 's1', lessonId: 'm1', title: 'Maths', dueDate: '2026-09-08', done: false },
    { id: 'hc', studentId: 's1', lessonId: 'c1', title: 'Chemistry', dueDate: '2026-09-09', done: true },
    { id: 'hx', studentId: 's1', title: 'Reading', dueDate: '2026-09-10', done: true },
  ] as Homework[],
  ratings: [
    rating('r1', 'quad', 'm1', 2, 2),
    rating('r2', 'mole', 'c1', 4, 3),
    // Rated outside a Chemistry lesson, but on a Chemistry topic.
    rating('r3', 'bonding', undefined, 3, 12),
  ],
};
const since = new Date(2026, 8, 1).toISOString();

describe('reportFacts per subject', () => {
  it('without a scope, counts everything as before', () => {
    const f = reportFacts(student, data, since);
    expect(f.lessonsTaught).toBe(4);
    expect(f.attendancePercent).toBe(80);
    expect(f.homeworkPercent).toBe(67);
    expect(f.topicsCovered.map((t) => t.topicId).sort()).toEqual(['bonding', 'mole', 'quad']);
    expect(f.recentNotes).toEqual(['The mole', 'Quadratics']);
  });

  it('limits Chemistry facts to Chemistry lessons, their homework and Chemistry topics', () => {
    const f = reportFacts(student, data, since, { subject: 'Chemistry', topicIds: new Set(['mole', 'bonding']) });
    expect(f.lessonsTaught).toBe(2);
    expect(f.attendancePercent).toBe(100);
    // Chemistry homework plus homework set outside a lesson; never the Maths homework.
    expect(f.homeworkPercent).toBe(100);
    expect(f.topicsCovered.map((t) => t.topicId).sort()).toEqual(['bonding', 'mole']);
    expect(f.recentNotes).toEqual(['The mole']);
  });

  it('limits Maths facts to Maths lessons and ratings from them', () => {
    const f = reportFacts(student, data, since, { subject: 'maths' });
    expect(f.lessonsTaught).toBe(1);
    expect(f.attendancePercent).toBe(50);
    expect(f.homeworkPercent).toBe(50);
    expect(f.topicsCovered.map((t) => t.topicId)).toEqual(['quad']);
  });

  it('counts lessons without a subject only when there is no subject in scope', () => {
    expect(reportFacts(student, data, since, { subject: 'Arabic' }).lessonsTaught).toBe(0);
    expect(reportFacts(student, data, since, { topicIds: new Set(['quad']) }).topicsCovered.map((t) => t.topicId).sort()).toEqual(['mole', 'quad']);
  });

  it('passes the subject to the AI drafting service', () => {
    const f = reportFacts(student, data, since, { subject: 'Chemistry', topicIds: new Set(['mole']) });
    const ai = factsForAi(f, (id) => id, { subject: 'Chemistry', curriculum: 'IGCSE' });
    expect(ai).toMatchObject({ firstName: 'Layla', subject: 'Chemistry', curriculum: 'IGCSE' });
    expect(factsForAi(f, (id) => id, {}).subject).toBeUndefined();
  });
});
