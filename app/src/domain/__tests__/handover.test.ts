import { handoverSourcesFromRpc, saveLessonPlanArgs, toHandover, toLessonPlan, type PackRowMappers } from '@/data/handover-mapping';

import { assembleHandoverPack, HANDOVER_REASON_LABEL, handoverTitle, validateHandoverNote, type HandoverSources } from '../handover';
import type { Syllabus } from '../progress';
import { buildTopicLookup } from '../topics';
import type { Handover, Homework, Lesson, LessonNote, Resource, TopicRating } from '../types';

const SYLLABUS: Syllabus = {
  id: 'syl-test',
  name: 'Test Maths',
  curriculum: 'IB DP',
  subject: 'Maths',
  units: [
    { id: 'u1', name: 'Algebra', topics: [{ id: 'alg-1', name: 'Quadratics' }, { id: 'alg-2', name: 'Logarithms' }] },
    { id: 'u2', name: 'Probability', topics: [{ id: 'pro-1', name: 'Tree diagrams' }, { id: 'pro-2', name: 'Conditional probability' }] },
    { id: 'u3', name: 'Calculus', topics: [{ id: 'cal-1', name: 'Integration' }] },
  ],
};
const topics = buildTopicLookup([SYLLABUS], [], []);
const NOW = new Date(2026, 9, 4, 12, 0);

const handover: Handover = {
  id: 'ho-1', createdAt: '2026-10-03T10:00:00Z', reason: 'cover', studentId: 's-1', subject: 'Maths', lessonId: 'les-next',
  fromTutorId: 't-james', toTutorId: 't-sarah', note: 'Start with a short quiz.',
};

const lesson = (n: number, patch: Partial<Lesson> = {}): Lesson => ({
  id: `les-${n}`, tutorId: 't-james', studentIds: ['s-1'], serviceId: 'svc', subject: 'Maths',
  start: new Date(2026, 8, n, 16).toISOString(), end: new Date(2026, 8, n, 17).toISOString(), location: 'online', status: 'completed', ...patch,
});
const note = (n: number, patch: Partial<LessonNote> = {}): LessonNote => ({
  lessonId: `les-${n}`, summary: `Summary ${n}`, topicIds: ['alg-1'], attendance: {}, createdAt: new Date(2026, 8, n, 17).toISOString(), ...patch,
});
const hw = (id: string, dueDate: string, done = false, patch: Partial<Homework> = {}): Homework => ({ id, studentId: 's-1', title: id, dueDate, done, ...patch });
const rating = (topicId: string, value: TopicRating['rating'], day: number): TopicRating => ({
  id: `${topicId}-${day}`, studentId: 's-1', topicId, rating: value, ratedAt: new Date(2026, 8, day).toISOString(),
});
const res = (id: string): Resource => ({ id, title: id, kind: 'link', url: `https://example.com/${id}`, tags: [], visibility: 'students', studentIds: [], createdAt: '2026-09-01T00:00:00Z' });

function sources(patch: Partial<HandoverSources> = {}): HandoverSources {
  return {
    handover,
    student: { id: 's-1', familyId: 'f-1', fullName: 'Charlotte Hughes', targetGrade: '6', currentGrade: '4', examDate: '2026-11-05', notes: 'Prefers worked examples.' },
    enrolment: { id: 'enr-1', studentId: 's-1', subject: 'Maths', curriculum: 'IB DP', syllabusId: 'syl-test', tutorId: 't-james', active: true },
    lessons: [1, 2, 3, 4, 5, 6, 7].map((n) => lesson(n, n === 7 ? { status: 'no-show' } : {})),
    notes: [note(1), note(2), note(3), note(4), note(5), note(6, { privateNote: 'Anxious about mocks.', topicIds: ['pro-1', 'pro-2'] })],
    homework: [hw('late', '2026-10-09'), hw('done', '2026-10-01', true), hw('early', '2026-10-06', false, { attachments: [{ kind: 'link', name: 'B', url: 'https://example.com/b', resourceId: 'res-b' }] })],
    plans: [1, 2, 3, 4].map((n) => ({
      lessonId: `les-p${n}`, objectives: `Plan ${n}`, topicIds: ['cal-1'], resourceIds: n === 4 ? ['res-a'] : [], homework: [{ title: `Task ${n}` }],
      sharedWithFamily: n % 2 === 0, updatedAt: '2026-10-01T00:00:00Z', lessonStart: new Date(2026, 9, n).toISOString(),
    })),
    ratings: [rating('alg-1', 4, 1), rating('alg-1', 5, 2), rating('pro-1', 2, 1), rating('pro-1', 1, 3), rating('pro-2', 2, 3), rating('other-topic', 1, 3)],
    resources: [res('res-c'), res('res-a'), res('res-b'), res('res-c')],
    latestReport: { id: 'rep-1', cycleId: 'c', studentId: 's-1', tutorId: 't-james', status: 'published', aiAssisted: false, updatedAt: '2026-09-20T00:00:00Z', nextSteps: 'Secure probability before the mocks.' },
    ...patch,
  };
}

describe('assembleHandoverPack', () => {
  const pack = assembleHandoverPack(sources(), topics, NOW);

  it('lists the five newest lessons with their notes', () => {
    expect(pack.recentLessons.map((l) => l.lessonId)).toEqual(['les-7', 'les-6', 'les-5', 'les-4', 'les-3']);
    expect(pack.recentLessons[0]).toEqual({ lessonId: 'les-7', start: lesson(7).start, tutorId: 't-james', status: 'no-show', summary: '', topicNames: [] });
    expect(pack.recentLessons[1]).toMatchObject({ summary: 'Summary 6', topicNames: ['Tree diagrams', 'Conditional probability'], privateNote: 'Anxious about mocks.' });
    expect(pack.recentLessons[2]).not.toHaveProperty('privateNote');
  });

  it('passes a private note through only when the sources include it', () => {
    const withoutPrivate = sources();
    withoutPrivate.notes = withoutPrivate.notes.map(({ privateNote: _p, ...n }) => n);
    const p = assembleHandoverPack(withoutPrivate, topics, NOW);
    expect(p.recentLessons.some((l) => 'privateNote' in l)).toBe(false);
  });

  it('lists open homework, soonest due first', () => {
    expect(pack.openHomework.map((h) => h.id)).toEqual(['early', 'late']);
  });

  it('names the focus topics and summarises mastery over the subject’s tree', () => {
    expect(pack.focusTopics).toEqual([
      { topicId: 'pro-1', name: 'Tree diagrams', rating: 1, trend: -1 },
      { topicId: 'pro-2', name: 'Conditional probability', rating: 2, trend: 0 },
    ]);
    // Three of five topics rated (the unknown topic is ignored); latest 5, 1, 2.
    expect(pack.mastery).toEqual({ masteryPercent: 42, coveragePercent: 60, covered: 3, total: 5, weakUnits: ['Probability'] });
  });

  it('has no mastery without an enrolment', () => {
    const p = assembleHandoverPack(sources({ enrolment: undefined }), topics, NOW);
    expect(p.mastery).toBeNull();
    expect(p.subject).toBe('Maths');
  });

  it('keeps the report’s next steps as goals, without repeating the grades or the exam date', () => {
    expect(pack.goals).toEqual(['Secure probability before the mocks.']);
    expect(pack.examDate).toBe('2026-11-05');
    expect(pack.daysToExam).toBe(32);
    const plain = assembleHandoverPack(
      sources({ student: { id: 's-1', familyId: 'f-1', fullName: 'C', targetGrade: '7' }, latestReport: undefined }),
      topics,
      NOW,
    );
    expect(plain.goals).toEqual([]);
    expect(plain.daysToExam).toBeUndefined();
    expect(plain.tutorNotes).toBeUndefined();
  });

  it('keeps the three newest plans', () => {
    expect(pack.recentPlans.map((p) => p.lessonId)).toEqual(['les-p4', 'les-p3', 'les-p2']);
    expect(pack.recentPlans[0]).toEqual({
      lessonId: 'les-p4', lessonStart: new Date(2026, 9, 4).toISOString(), objectives: 'Plan 4', topicNames: ['Integration'], homeworkTitles: ['Task 4'], sharedWithFamily: true,
    });
  });

  it('lists each resource once, referenced ones first', () => {
    expect(pack.resources.map((r) => r.id)).toEqual(['res-a', 'res-b', 'res-c']);
  });

  it('carries the notes for the incoming tutor', () => {
    expect(pack.tutorNotes).toBe('Prefers worked examples.');
    expect(pack.handoverNote).toBe('Start with a short quiz.');
    expect(pack.handover).toBe(handover);
  });
});

describe('handover wording', () => {
  it('titles a handover with its subject', () => {
    expect(handoverTitle(handover, 'Charlotte Hughes')).toBe('Charlotte Hughes (Maths)');
    expect(handoverTitle({ ...handover, subject: undefined }, 'Charlotte Hughes')).toBe('Charlotte Hughes');
    expect(HANDOVER_REASON_LABEL.awarded).toBe('New student');
  });
  it('limits the note', () => {
    expect(validateHandoverNote('fine')).toBeNull();
    expect(validateHandoverNote('x'.repeat(4001))).toBe('Please keep the handover note to 4,000 characters or fewer.');
  });
});

describe('handover_pack mapping', () => {
  // Minimal stand-ins for the row mappers supabase.ts passes in.
  const mappers: PackRowMappers = {
    student: (r) => ({ id: r.id, familyId: r.family_id, fullName: r.full_name, notes: r.student_notes?.notes ?? undefined }),
    enrolment: (r) => ({ id: r.id, studentId: r.student_id, subject: r.subject, active: r.active }),
    lesson: (r) => ({ id: r.id, tutorId: r.tutor_id, studentIds: r.student_ids, serviceId: r.service_id, start: r.start_at, end: r.end_at, location: r.location, status: r.status }),
    note: (r) => ({ lessonId: r.lesson_id, summary: r.summary, topicIds: r.topic_ids, attendance: r.attendance, createdAt: r.created_at, privateNote: r.lesson_private_notes?.private_note ?? undefined }),
    homework: (r) => ({ id: r.id, studentId: r.student_id, title: r.title, dueDate: r.due_date, done: r.done }),
    rating: (r) => ({ id: r.id, studentId: r.student_id, topicId: r.topic_id, rating: r.rating, ratedAt: r.rated_at }),
    resource: (r) => ({ id: r.id, title: r.title, kind: r.kind, tags: r.tags ?? [], visibility: r.visibility, studentIds: r.student_ids ?? [], createdAt: r.created_at }),
    report: (r) => ({ id: r.id, cycleId: r.cycle_id, studentId: r.student_id, tutorId: r.tutor_id, status: r.status, aiAssisted: r.ai_assisted, updatedAt: r.updated_at, nextSteps: r.next_steps ?? undefined }),
  };
  const handoverRow = {
    id: 'ho-1', created_at: '2026-10-03T10:00:00+00:00', reason: 'cover', student_id: 's-1', subject: 'Maths', enrolment_id: 'enr-1',
    lesson_id: 'les-next', opportunity_id: null, from_tutor_id: 't-james', to_tutor_id: 't-sarah', note: 'Quiz first.', note_updated_at: '2026-10-03T11:00:00+00:00', viewed_at: null,
  };
  const fixture = {
    handover: handoverRow,
    student: { id: 's-1', family_id: 'f-1', full_name: 'Charlotte Hughes', student_notes: { notes: 'Prefers worked examples.' } },
    enrolment: { id: 'enr-1', student_id: 's-1', subject: 'Maths', active: true },
    lessons: [{ id: 'les-1', tutor_id: 't-james', student_ids: ['s-1'], service_id: 'svc', start_at: '2026-09-01T12:00:00Z', end_at: '2026-09-01T13:00:00Z', location: 'online', status: 'completed' }],
    notes: [
      { lesson_id: 'les-1', summary: 'Summary', topic_ids: ['alg-1'], attendance: { 's-1': 'present' }, created_at: '2026-09-01T13:00:00Z', lesson_private_notes: { private_note: 'Private.' } },
      { lesson_id: 'les-2', summary: 'Other', topic_ids: [], attendance: {}, created_at: '2026-09-02T13:00:00Z', lesson_private_notes: null },
    ],
    homework: [{ id: 'hw-1', student_id: 's-1', title: 'Exercise', due_date: '2026-10-09', done: false }],
    plans: [
      {
        lesson_id: 'les-p1', tutor_id: 't-james', objectives: 'Revise', topic_ids: ['cal-1'], resource_ids: ['res-1'],
        homework: [{ title: 'Task', studentId: 's-1' }, { title: 'Read', details: 'Chapter 2' }], shared_with_family: true,
        created_at: '2026-09-30T08:00:00+00:00', updated_at: '2026-10-01T08:00:00+00:00', lesson_start_at: '2026-10-05T12:00:00+00:00',
      },
    ],
    ratings: [{ id: 'r-1', student_id: 's-1', topic_id: 'alg-1', rating: 4, rated_at: '2026-09-01T12:00:00Z' }],
    resources: [{ id: 'res-1', title: 'Booklet', kind: 'link', tags: null, visibility: 'students', created_at: '2026-09-01T00:00:00Z' }],
    latest_report: null,
  };

  it('maps every part of the pack', () => {
    const out = handoverSourcesFromRpc(fixture, mappers);
    expect(out.handover).toEqual({
      id: 'ho-1', createdAt: '2026-10-03T10:00:00+00:00', reason: 'cover', studentId: 's-1', subject: 'Maths', enrolmentId: 'enr-1', lessonId: 'les-next',
      opportunityId: undefined, fromTutorId: 't-james', toTutorId: 't-sarah', note: 'Quiz first.', noteUpdatedAt: '2026-10-03T11:00:00+00:00', viewedAt: undefined,
    });
    expect(out.student.notes).toBe('Prefers worked examples.');
    expect(out.enrolment?.id).toBe('enr-1');
    expect(out.lessons.map((l) => l.id)).toEqual(['les-1']);
    expect(out.notes.map((n) => n.privateNote)).toEqual(['Private.', undefined]);
    expect(out.homework[0]).toMatchObject({ id: 'hw-1', dueDate: '2026-10-09', done: false });
    expect(out.plans).toEqual([
      {
        lessonId: 'les-p1', tutorId: 't-james', objectives: 'Revise', topicIds: ['cal-1'], resourceIds: ['res-1'],
        homework: [{ title: 'Task', studentId: 's-1' }, { title: 'Read', details: 'Chapter 2' }], sharedWithFamily: true,
        createdAt: '2026-09-30T08:00:00+00:00', updatedAt: '2026-10-01T08:00:00+00:00', lessonStart: '2026-10-05T12:00:00.000Z',
      },
    ]);
    expect(out.ratings[0]).toMatchObject({ topicId: 'alg-1', rating: 4 });
    expect(out.resources).toEqual([{ id: 'res-1', title: 'Booklet', kind: 'link', tags: [], visibility: 'students', studentIds: [], createdAt: '2026-09-01T00:00:00Z' }]);
    expect(out).not.toHaveProperty('latestReport');
    // The mapped pack assembles.
    expect(assembleHandoverPack(out, topics, NOW).recentPlans[0].topicNames).toEqual(['Integration']);
  });

  it('maps a report and missing lists, and refuses an empty result', () => {
    const out = handoverSourcesFromRpc(
      { ...fixture, enrolment: null, lessons: null, latest_report: { id: 'rep', cycle_id: 'c', student_id: 's-1', tutor_id: 't', status: 'approved', ai_assisted: false, updated_at: 'x', next_steps: 'Next.' } },
      mappers,
    );
    expect(out.enrolment).toBeUndefined();
    expect(out.lessons).toEqual([]);
    expect(out.latestReport?.nextSteps).toBe('Next.');
    expect(() => handoverSourcesFromRpc(null, mappers)).toThrow('Handover pack not found.');
  });

  it('maps rows and builds the save arguments', () => {
    expect(toHandover({ ...handoverRow, viewed_at: '2026-10-04T08:00:00Z' }).viewedAt).toBe('2026-10-04T08:00:00Z');
    expect(toHandover({ ...handoverRow, student_name: 'Charlotte Hughes' }).studentName).toBe('Charlotte Hughes');
    expect(toHandover({ ...handoverRow, student_name: null }).studentName).toBeUndefined();
    expect(toLessonPlan({ lesson_id: 'l', objectives: null, topic_ids: null, resource_ids: null, homework: null, shared_with_family: false, updated_at: 'u' })).toEqual({
      lessonId: 'l', tutorId: undefined, objectives: '', topicIds: [], resourceIds: [], homework: [], sharedWithFamily: false, createdAt: undefined, updatedAt: 'u',
    });
    expect(
      saveLessonPlanArgs({ lessonId: 'l', objectives: 'O', topicIds: ['t'], resourceIds: [], homework: [{ title: 'A' }, { studentId: 's', title: 'B', details: 'D' }], sharedWithFamily: true }),
    ).toEqual({ p_lesson_id: 'l', p_objectives: 'O', p_topic_ids: ['t'], p_resource_ids: [], p_homework: [{ title: 'A' }, { title: 'B', studentId: 's', details: 'D' }], p_shared: true });
  });
});
