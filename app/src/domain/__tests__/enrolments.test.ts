import {
  activeEnrolments,
  defaultSubject,
  draftFromEnrolment,
  enrolmentDetail,
  enrolmentFor,
  enrolmentTitle,
  lessonSubject,
  sameSubject,
  studentSubjects,
  subjectsFor,
  topicListKey,
  tutorTeaches,
  validateEnrolments,
  type EnrolmentDraft,
} from '../enrolments';
import type { Enrolment } from '../types';

const e = (over: Partial<Enrolment>): Enrolment => ({ id: 'e', studentId: 's1', subject: 'Maths', active: true, ...over });

const all: Enrolment[] = [
  e({ id: 'm1', studentId: 's1', subject: 'Maths', curriculum: 'IGCSE', tutorId: 't1' }),
  e({ id: 'c1', studentId: 's1', subject: 'Chemistry', curriculum: 'IGCSE', examBoard: 'Cambridge', tutorId: 't2' }),
  e({ id: 'p1', studentId: 's1', subject: 'Physics', active: false }),
  e({ id: 'm2', studentId: 's2', subject: 'maths ', curriculum: 'IB DP', level: 'AA HL' }),
  e({ id: 'a3', studentId: 's3', subject: 'Arabic' }),
];

describe('sameSubject and topicListKey', () => {
  it('ignores case and outer spaces, and never matches an empty subject', () => {
    expect(sameSubject(' Maths', 'maths ')).toBe(true);
    expect(sameSubject('Maths', 'Further Maths')).toBe(false);
    expect(sameSubject('', '')).toBe(false);
    expect(sameSubject(undefined, 'Maths')).toBe(false);
  });
  it('builds a lower-cased, trimmed key', () => {
    expect(topicListKey(' Chemistry ', 'IGCSE')).toBe('chemistry|igcse|');
    expect(topicListKey('Maths', 'IB DP', 'AA HL')).toBe('maths|ib dp|aa hl');
  });
});

describe('titles', () => {
  it('names an enrolment', () => {
    expect(enrolmentTitle({ subject: 'Chemistry', curriculum: 'IGCSE' })).toBe('IGCSE Chemistry');
    expect(enrolmentTitle({ subject: 'Maths', curriculum: 'IB DP', level: 'AA HL' })).toBe('IB DP Maths (AA HL)');
    expect(enrolmentTitle({ subject: 'Arabic' })).toBe('Arabic');
  });
  it('describes the exam board and tutor, or nothing', () => {
    expect(enrolmentDetail({ examBoard: 'Cambridge', tutorId: 't2' }, 'Sarah Khan')).toBe('Cambridge · with Sarah Khan');
    expect(enrolmentDetail({ tutorId: 't2' }, 'Sarah Khan')).toBe('with Sarah Khan');
    expect(enrolmentDetail({ examBoard: 'AQA' })).toBe('AQA');
    expect(enrolmentDetail({})).toBe('');
  });
});

describe('a student’s subjects', () => {
  it('lists active enrolments sorted by subject', () => {
    expect(activeEnrolments(all, 's1').map((x) => x.id)).toEqual(['c1', 'm1']);
    expect(studentSubjects(all, 's1')).toBe('Chemistry, Maths');
    expect(studentSubjects(all, 'nobody')).toBe('');
  });
  it('finds the enrolment for a subject, or the only one', () => {
    expect(enrolmentFor(all, 's1', 'chemistry')?.id).toBe('c1');
    expect(enrolmentFor(all, 's1', 'Physics')).toBeUndefined(); // inactive
    expect(enrolmentFor(all, 's1')).toBeUndefined(); // two active subjects
    expect(enrolmentFor(all, 's2')?.id).toBe('m2');
  });
  it('collects unique subjects across students', () => {
    expect(subjectsFor(all, ['s1', 's2', 's3'])).toEqual(['Arabic', 'Chemistry', 'Maths']);
    expect(subjectsFor(all, [])).toEqual([]);
  });
});

describe('lesson subjects', () => {
  it('uses the lesson’s subject, else the first student’s only subject', () => {
    expect(lessonSubject({ subject: 'Chemistry', studentIds: ['s2'] }, all)).toBe('Chemistry');
    expect(lessonSubject({ studentIds: ['s2'] }, all)).toBe('maths ');
    expect(lessonSubject({ studentIds: ['s1'] }, all)).toBeUndefined();
    expect(lessonSubject({ studentIds: [] }, all)).toBeUndefined();
  });
  it('defaults to the service subject, else the one subject every student shares', () => {
    expect(defaultSubject(all, ['s1'], { subject: 'Physics' })).toBe('Physics');
    expect(defaultSubject(all, ['s1', 's2'])).toBe('Maths');
    expect(defaultSubject(all, ['s1'])).toBeUndefined(); // Chemistry and Maths
    expect(defaultSubject(all, ['s1', 's3'])).toBeUndefined();
    expect(defaultSubject(all, [])).toBeUndefined();
  });
  it('checks whether a tutor teaches a subject', () => {
    expect(tutorTeaches({ subjects: ['Maths', 'Chemistry'] }, 'chemistry')).toBe(true);
    expect(tutorTeaches({ subjects: ['Maths'] }, 'Arabic')).toBe(false);
    expect(tutorTeaches({ subjects: [] }, undefined)).toBe(true);
    expect(tutorTeaches({ subjects: [] }, ' ')).toBe(true);
  });
});

describe('validateEnrolments', () => {
  const d = (over: Partial<EnrolmentDraft>): EnrolmentDraft => ({ subject: 'Maths', active: true, ...over });
  it('accepts distinct subjects and ignores inactive rows', () => {
    expect(validateEnrolments([d({}), d({ subject: 'Chemistry' }), d({ subject: '', active: false })])).toBeNull();
    expect(validateEnrolments([d({}), d({ subject: 'maths', active: false })])).toBeNull();
    expect(validateEnrolments([d({ curriculum: 'IGCSE' }), d({ curriculum: 'A-Level' })])).toBeNull();
    expect(validateEnrolments([])).toBeNull();
  });
  it('asks for a subject on every active row', () => {
    expect(validateEnrolments([d({}), d({ subject: '  ' })])).toBe('Please choose a subject for every row.');
  });
  it('refuses the same subject, curriculum and level twice', () => {
    expect(validateEnrolments([d({ curriculum: 'IB DP', level: 'HL' }), d({ subject: ' maths', curriculum: 'ib dp', level: 'hl' })])).toBe(
      'Maths is listed twice. Please remove one.',
    );
  });
  it('round-trips an enrolment into a draft', () => {
    const c1 = all[1];
    expect(draftFromEnrolment({ ...c1, topicListId: 'tl', createdAt: 'x' })).toEqual({
      id: 'c1', subject: 'Chemistry', curriculum: 'IGCSE', level: undefined, examBoard: 'Cambridge', tutorId: 't2', syllabusId: undefined, active: true,
    });
  });
});
