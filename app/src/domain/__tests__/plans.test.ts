import { isPlanEmpty, lessonsNeedingPlan, normalisePlan, PLAN_LIMITS, prefillFromPlan, validatePlan } from '../plans';
import type { Lesson, LessonPlan, Resource } from '../types';

type Input = Omit<LessonPlan, 'tutorId' | 'createdAt' | 'updatedAt'>;
const base: Input = { lessonId: 'les-1', objectives: '', topicIds: [], resourceIds: [], homework: [], sharedWithFamily: false };

const lesson = (id: string, start: Date, patch: Partial<Lesson> = {}): Lesson => ({
  id,
  tutorId: 't-sarah',
  studentIds: ['s-layla'],
  serviceId: 'svc',
  start: start.toISOString(),
  end: new Date(start.getTime() + 3_600_000).toISOString(),
  location: 'online',
  status: 'scheduled',
  ...patch,
});

const plan = (lessonId: string, patch: Partial<LessonPlan> = {}): LessonPlan => ({ ...base, lessonId, updatedAt: '2026-10-01T00:00:00Z', ...patch });

const resource = (id: string, kind: 'file' | 'link' = 'file'): Resource => ({
  id,
  title: `Resource ${id}`,
  kind,
  path: kind === 'file' ? `resources/${id}.pdf` : undefined,
  url: kind === 'link' ? `https://example.com/${id}` : undefined,
  mimeType: kind === 'file' ? 'application/pdf' : undefined,
  tags: [],
  visibility: 'tutors',
  studentIds: [],
  createdAt: '2026-09-01T00:00:00Z',
});

describe('validatePlan', () => {
  it('asks for something to be planned', () => {
    expect(validatePlan(base)).toBe('Please add an objective, a topic, a resource or planned homework.');
    expect(validatePlan({ ...base, objectives: '   ' })).toBe('Please add an objective, a topic, a resource or planned homework.');
    expect(validatePlan({ ...base, objectives: 'Quadratics' })).toBeNull();
    expect(validatePlan({ ...base, topicIds: ['t1'] })).toBeNull();
    expect(validatePlan({ ...base, resourceIds: ['r1'] })).toBeNull();
    expect(validatePlan({ ...base, homework: [{ title: 'Exercise 4' }] })).toBeNull();
  });

  it('needs a title for each piece of homework', () => {
    expect(validatePlan({ ...base, homework: [{ title: ' ', details: 'Questions 1 to 5' }] })).toBe('Each piece of planned homework needs a title.');
  });

  it('only allows homework for students in the lesson', () => {
    const input = { ...base, homework: [{ studentId: 's-omar', title: 'Exercise 4' }] };
    expect(validatePlan(input, ['s-layla'])).toBe('Planned homework must be for a student in this lesson.');
    expect(validatePlan(input, ['s-omar'])).toBeNull();
    // Without the lesson's students the check is left to the server.
    expect(validatePlan(input)).toBeNull();
  });

  it('enforces the limits in full sentences', () => {
    const checks: [Partial<Input>, RegExp][] = [
      [{ objectives: 'x'.repeat(PLAN_LIMITS.objectives + 1) }, /^Please keep the objectives to 4,000 characters or fewer\.$/],
      [{ topicIds: Array.from({ length: PLAN_LIMITS.topics + 1 }, (_, i) => `t${i}`) }, /^Please choose no more than 50 topics\.$/],
      [{ resourceIds: Array.from({ length: PLAN_LIMITS.resources + 1 }, (_, i) => `r${i}`) }, /^Please choose no more than 20 resources\.$/],
      [{ homework: Array.from({ length: PLAN_LIMITS.homework + 1 }, (_, i) => ({ title: `H${i}` })) }, /^Please plan no more than 10 pieces of homework\.$/],
      [{ homework: [{ title: 'x'.repeat(PLAN_LIMITS.title + 1) }] }, /^Please keep each homework title to 200 characters or fewer\.$/],
      [{ homework: [{ title: 'H', details: 'x'.repeat(PLAN_LIMITS.details + 1) }] }, /^Please keep the homework details to 4,000 characters or fewer\.$/],
    ];
    for (const [patch, message] of checks) expect(validatePlan({ ...base, ...patch })).toMatch(message);
    expect(validatePlan({ ...base, objectives: 'x'.repeat(PLAN_LIMITS.objectives) })).toBeNull();
  });
});

describe('normalisePlan', () => {
  it('trims, drops blank homework and repeated ids', () => {
    const out = normalisePlan({
      lessonId: 'les-1',
      objectives: '  Revise vectors  ',
      topicIds: ['t1', ' t1 ', 't2', ''],
      resourceIds: ['r1', 'r1'],
      homework: [
        { title: '  Exercise 4 ', details: '  ' },
        { title: ' ', details: ' ' },
        { studentId: 's-layla', title: 'Past paper', details: ' Question 3 ' },
      ],
      sharedWithFamily: true,
    });
    expect(out).toEqual({
      lessonId: 'les-1',
      objectives: 'Revise vectors',
      topicIds: ['t1', 't2'],
      resourceIds: ['r1'],
      homework: [{ title: 'Exercise 4' }, { studentId: 's-layla', title: 'Past paper', details: 'Question 3' }],
      sharedWithFamily: true,
    });
    expect(Object.keys(out.homework[0])).toEqual(['title']);
  });

  it('keeps homework that has details but no title, so validation can ask for one', () => {
    const out = normalisePlan({ ...base, homework: [{ title: '', details: 'Questions' }] });
    expect(validatePlan(out)).toBe('Each piece of planned homework needs a title.');
  });
});

describe('isPlanEmpty', () => {
  it('treats missing and blank plans as empty', () => {
    expect(isPlanEmpty(null)).toBe(true);
    expect(isPlanEmpty(undefined)).toBe(true);
    expect(isPlanEmpty({ objectives: ' ', topicIds: [], resourceIds: [], homework: [{ title: ' ' }] })).toBe(true);
    expect(isPlanEmpty({ objectives: 'x', topicIds: [], resourceIds: [], homework: [] })).toBe(false);
  });
});

describe('lessonsNeedingPlan', () => {
  const now = new Date('2026-10-04T08:00:00Z');
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  it('lists the tutor’s unplanned scheduled lessons in the next 48 hours, soonest first', () => {
    const lessons = [
      lesson('later', at(30)),
      lesson('soon', at(2)),
      lesson('now', at(0)),
      lesson('edge', at(48)),
      lesson('past', at(-1)),
      lesson('other-tutor', at(3), { tutorId: 't-james' }),
      lesson('cancelled', at(4), { status: 'cancelled' }),
      lesson('planned', at(5)),
      lesson('empty-plan', at(6)),
    ];
    const plans = [plan('planned', { objectives: 'Vectors' }), plan('empty-plan')];
    expect(lessonsNeedingPlan(lessons, plans, 't-sarah', now).map((l) => l.id)).toEqual(['now', 'soon', 'empty-plan', 'later']);
  });

  it('includes a lesson just inside the window and honours a custom window', () => {
    const lessons = [lesson('inside', new Date(at(48).getTime() - 1)), lesson('day', at(20))];
    expect(lessonsNeedingPlan(lessons, [], 't-sarah', now).map((l) => l.id)).toEqual(['day', 'inside']);
    expect(lessonsNeedingPlan(lessons, [], 't-sarah', now, 24).map((l) => l.id)).toEqual(['day']);
  });

  it('is empty without a tutor', () => {
    expect(lessonsNeedingPlan([lesson('a', at(1))], [], undefined, now)).toEqual([]);
  });
});

describe('prefillFromPlan', () => {
  const resources = [resource('r1'), resource('r2', 'link')];

  it('is empty without a plan', () => {
    const empty = { summary: '', topicIds: [], homework: {}, homeworkExtras: {} };
    expect(prefillFromPlan(null, ['s1'], resources)).toEqual(empty);
    expect(prefillFromPlan(undefined, ['s1'], resources)).toEqual(empty);
    expect(prefillFromPlan(plan('l'), ['s1'], resources)).toEqual(empty);
  });

  it('gives homework without a student to everyone, with the plan’s resources attached', () => {
    const p = plan('l', { objectives: 'Revise vectors', topicIds: ['t1', 't2'], resourceIds: ['r1', 'r2', 'missing'], homework: [{ title: 'Exercise 4' }] });
    const out = prefillFromPlan(p, ['s1', 's2'], resources);
    expect(out.summary).toBe('Objectives: Revise vectors');
    expect(out.topicIds).toEqual(['t1', 't2']);
    expect(out.homework).toEqual({ s1: 'Exercise 4', s2: 'Exercise 4' });
    expect(out.homeworkExtras.s1).toEqual({
      open: true,
      details: '',
      attachments: [
        { kind: 'file', name: 'Resource r1', resourceId: 'r1', path: 'resources/r1.pdf', mimeType: 'application/pdf' },
        { kind: 'link', name: 'Resource r2', resourceId: 'r2', url: 'https://example.com/r2' },
      ],
    });
    // Each student gets their own copies.
    expect(out.homeworkExtras.s1.attachments[0]).not.toBe(out.homeworkExtras.s2.attachments[0]);
  });

  it('joins several pieces for one student and keeps per-student homework to that student', () => {
    const p = plan('l', {
      homework: [
        { title: 'Exercise 4', details: 'Questions 1 to 5' },
        { studentId: 's1', title: 'Past paper', details: 'Question 3' },
        { studentId: 's2', title: 'Reading' },
      ],
    });
    const out = prefillFromPlan(p, ['s1', 's2', 's3'], resources);
    expect(out.summary).toBe('');
    expect(out.homework).toEqual({ s1: 'Exercise 4; Past paper', s2: 'Exercise 4; Reading', s3: 'Exercise 4' });
    expect(out.homeworkExtras.s1).toEqual({ open: true, details: 'Questions 1 to 5\n\nQuestion 3', attachments: [] });
    expect(out.homeworkExtras.s2.details).toBe('Questions 1 to 5');
  });

  it('leaves the extras closed when there are no details or resources', () => {
    const out = prefillFromPlan(plan('l', { homework: [{ studentId: 's1', title: 'Reading' }] }), ['s1', 's2'], resources);
    expect(out.homework).toEqual({ s1: 'Reading' });
    expect(out.homeworkExtras).toEqual({ s1: { open: false, details: '', attachments: [] } });
  });
});
