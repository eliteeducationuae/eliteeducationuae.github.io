import { buildTopicLookup } from '@/domain/topics';
import type { Profile } from '@/domain/types';

import { SYLLABUSES } from '../curriculum';
import { AccessError, cmd, enr, q } from '../demo/db';
import { eq } from '../demo/engagement';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026, midday
const who = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;
const tutor = (tutorId: string): Profile => ({ id: `u-${tutorId}`, role: 'tutor', fullName: tutorId, email: `${tutorId}@x`, tutorId });

describe('seeded subjects', () => {
  const db = createSeed(NOW);

  it('gives every student their Maths enrolment and a mix of other subjects', () => {
    const subjects = (sid: string) => db.enrolments.filter((e) => e.studentId === sid).map((e) => e.subject).sort();
    expect(subjects('s-omar')).toEqual(['Arabic', 'Maths']);
    expect(subjects('s-layla')).toEqual(['Chemistry', 'Maths']);
    expect(subjects('s-yasmin')).toEqual(['English Literature', 'Maths']);
    expect(subjects('s-karim')).toEqual(['Maths']);
    // Cambridge 0606 is Maths at the Additional level, so Karim's Maths lessons match his enrolment.
    expect(db.enrolments.find((e) => e.id === 'enr-karim-maths')).toMatchObject({ subject: 'Maths', curriculum: 'IGCSE', level: 'Additional', syllabusId: 'igcse-0606' });
    expect(db.lessons.filter((l) => l.studentIds.includes('s-karim')).every((l) => l.subject === 'Maths')).toBe(true);
    expect(subjects('s-noor')).toEqual(['English', 'Maths']);
    expect(db.enrolments.find((e) => e.id === 'enr-omar-maths')).toMatchObject({
      subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB', syllabusId: 'ib-aa-hl', tutorId: 't-craig',
    });
    expect(db.enrolments.find((e) => e.id === 'enr-noor-maths')?.topicListId).toBeUndefined();
    expect(db.tutors.find((t) => t.id === 't-nour')).toMatchObject({ fullName: 'Nour Al Hashimi', phases: ['Primary', 'Lower Secondary'] });
  });

  it('gives every lesson a subject its students study, and every taught subject a heatmap', () => {
    expect(db.lessons.every((l) => !!l.subject)).toBe(true);
    const lookup = buildTopicLookup(SYLLABUSES, db.topicLists, db.topics);
    for (const id of ['enr-layla-chemistry', 'enr-omar-arabic', 'enr-yasmin-english-literature', 'enr-noor-english', 'enr-omar-maths']) {
      const e = db.enrolments.find((x) => x.id === id)!;
      const topicIds = new Set(lookup.treeFor(e).units.flatMap((u) => u.topics.map((t) => t.id)));
      expect(db.ratings.filter((r) => r.studentId === e.studentId && topicIds.has(r.topicId)).length).toBeGreaterThan(2);
    }
    expect(lookup.treeFor(db.enrolments.find((e) => e.id === 'enr-noor-maths')!).units).toEqual([]);
  });

  it('has Layla’s Chemistry lesson waiting to be recorded, and another to come', () => {
    const now = db.lessons.find((l) => l.id === 'les-layla-chem-now')!;
    const startedAgo = NOW.getTime() - new Date(now.start).getTime();
    expect(now).toMatchObject({ status: 'scheduled', tutorId: 't-sarah', subject: 'Chemistry', studentIds: ['s-layla'] });
    expect(startedAgo).toBeGreaterThanOrEqual(3_600_000);
    expect(startedAgo).toBeLessThanOrEqual(3 * 3_600_000);
    expect(db.lessons.some((l) => l.subject === 'Chemistry' && l.status === 'scheduled' && new Date(l.start) > NOW)).toBe(true);
  });

  it('opens the seeded report round per enrolment', () => {
    const layla = db.reports.filter((r) => r.studentId === 's-layla').map((r) => [r.subject, r.tutorId]).sort();
    expect(layla).toEqual([['Chemistry', 't-sarah'], ['Maths', 't-sarah']]);
  });
});

describe('enrolment visibility (mirrors the enrolments policies)', () => {
  it('shows parents their own children and tutors the students they teach', () => {
    const db = createSeed(NOW);
    expect(new Set(enr.enrolments(db, who(db, 'parent')).map((e) => e.studentId))).toEqual(new Set(['s-omar', 's-layla']));
    // Includes Charlotte, whose lesson Sarah covers in the seed.
    expect(new Set(enr.enrolments(db, who(db, 'tutor')).map((e) => e.studentId))).toEqual(new Set(['s-layla', 's-yasmin', 's-karim', 's-charlotte']));
    expect(enr.enrolments(db, who(db, 'student')).every((e) => e.studentId === 's-omar')).toBe(true);
    expect(enr.enrolments(db, who(db, 'admin'), 's-noor').map((e) => e.subject)).toEqual(['English', 'Maths']);
  });

  it('lets a tutor see a student assigned to them before the first lesson', () => {
    const db = createSeed(NOW);
    const sarah = who(db, 'tutor');
    expect(q.students(db, sarah).some((s) => s.id === 's-arjun')).toBe(false);
    enr.saveEnrolment(db, who(db, 'admin'), { studentId: 's-arjun', subject: 'Chemistry', curriculum: 'A-Level', tutorId: 't-sarah', active: true });
    expect(q.students(db, sarah).some((s) => s.id === 's-arjun')).toBe(true);
    expect(enr.enrolments(db, sarah, 's-arjun').map((e) => e.subject)).toEqual(['Chemistry', 'Maths']);
    expect(enr.enrolments(db, tutor('t-james'), 's-arjun')).toEqual([]);
  });

  it('only admins change enrolments, with the same rules as the form', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    expect(() => enr.saveEnrolment(db, who(db, 'parent'), { studentId: 's-omar', subject: 'French', active: true })).toThrow(AccessError);
    expect(() => enr.saveEnrolment(db, who(db, 'tutor'), { studentId: 's-layla', subject: 'French', active: true })).toThrow(AccessError);
    expect(() => enr.saveEnrolment(db, admin, { studentId: 's-omar', subject: '  ', active: true })).toThrow('Please choose a subject for every row.');
    expect(() => enr.saveEnrolment(db, admin, { studentId: 's-layla', subject: ' chemistry ', curriculum: 'igcse', active: true })).toThrow(
      'chemistry is listed twice. Please remove one.',
    );
    // Retiring a subject keeps its history and frees the slot.
    const chem = db.enrolments.find((e) => e.id === 'enr-layla-chemistry')!;
    enr.saveEnrolment(db, admin, { ...chem, active: false });
    expect(chem.active).toBe(false);
    expect(chem.topicListId).toBe('tl-igcse-chemistry');
    const again = enr.saveEnrolment(db, admin, { studentId: 's-layla', subject: 'Chemistry', curriculum: 'IGCSE', active: true });
    expect(again.topicListId).toBe('tl-igcse-chemistry');
  });

  it('gives students created the old way their Maths enrolment', () => {
    const db = createSeed(NOW);
    const s = cmd.saveStudent(db, who(db, 'admin'), { familyId: 'f-hughes', fullName: 'Old App', curriculum: 'IB', syllabusId: 'ib-ai-hl' });
    expect(db.enrolments.filter((e) => e.studentId === s.id)).toEqual([
      expect.objectContaining({ subject: 'Maths', curriculum: 'IB DP', level: 'AI HL', syllabusId: 'ib-ai-hl', active: true }),
    ]);
  });
});

describe('adding topics (mirrors add_topic)', () => {
  it('lets the subject’s tutor add to the shared list, reused by every matching enrolment', () => {
    const db = createSeed(NOW);
    const sarah = who(db, 'tutor');
    const topic = enr.addTopic(db, sarah, { enrolmentId: 'enr-layla-chemistry', name: '  Rates of   reaction ', unit: 'Chemical reactions' }, NOW);
    expect(topic).toMatchObject({ listId: 'tl-igcse-chemistry', name: 'Rates of reaction', unit: 'Chemical reactions' });
    expect(topic.sort).toBe(Math.max(...db.topics.filter((t) => t.listId === 'tl-igcse-chemistry' && t.id !== topic.id).map((t) => t.sort)) + 1);
    // The same name in the same unit returns the existing topic.
    expect(enr.addTopic(db, sarah, { enrolmentId: 'enr-layla-chemistry', name: 'rates of reaction', unit: 'chemical reactions' }, NOW).id).toBe(topic.id);

    // Another student's IGCSE Chemistry enrolment shares the list and sees the new topic.
    const karim = enr.saveEnrolment(db, who(db, 'admin'), { studentId: 's-karim', subject: 'Chemistry', curriculum: 'IGCSE', active: true });
    expect(karim.topicListId).toBe('tl-igcse-chemistry');
    const lookup = buildTopicLookup(SYLLABUSES, db.topicLists, db.topics);
    expect(lookup.treeFor(karim).units.find((u) => u.name === 'Chemical reactions')?.topics.map((t) => t.id)).toEqual([topic.id]);
  });

  it('creates the list on first use and links matching enrolments', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const other = enr.saveEnrolment(db, admin, { studentId: 's-karim', subject: 'Maths', curriculum: 'British', active: true });
    expect(other.topicListId).toBeUndefined();
    const t = enr.addTopic(db, tutor('t-nour'), { enrolmentId: 'enr-noor-maths', name: 'Fractions' }, NOW);
    const list = db.topicLists.find((l) => l.id === t.listId)!;
    expect(list).toMatchObject({ subject: 'Maths', curriculum: 'British', name: 'British Maths' });
    expect(t).toMatchObject({ unit: undefined, sort: 1 });
    expect(db.enrolments.find((e) => e.id === 'enr-noor-maths')?.topicListId).toBe(list.id);
    expect(db.enrolments.find((e) => e.id === other.id)?.topicListId).toBe(list.id);
  });

  it('refuses tutors who do not teach the student, parents, and blank names', () => {
    const db = createSeed(NOW);
    expect(() => enr.addTopic(db, tutor('t-james'), { enrolmentId: 'enr-layla-chemistry', name: 'Polymers 2' })).toThrow(AccessError);
    expect(() => enr.addTopic(db, tutor('t-james'), { enrolmentId: 'enr-layla-chemistry', name: 'Polymers 2' })).toThrow(
      'You can add topics only for students you teach',
    );
    expect(() => enr.addTopic(db, who(db, 'parent'), { enrolmentId: 'enr-layla-chemistry', name: 'Polymers 2' })).toThrow(AccessError);
    expect(() => enr.addTopic(db, who(db, 'student'), { enrolmentId: 'enr-omar-arabic', name: 'Poetry' })).toThrow(AccessError);
    expect(() => enr.addTopic(db, who(db, 'tutor'), { enrolmentId: 'enr-layla-chemistry', name: '   ' })).toThrow('topic name');
    expect(() => enr.addTopic(db, who(db, 'admin'), { enrolmentId: 'missing', name: 'X' })).toThrow(AccessError);
    // Craig teaches Omar Maths only, so he may not write into the shared Arabic list.
    expect(() => enr.addTopic(db, tutor('t-craig'), { enrolmentId: 'enr-omar-arabic', name: 'Poetry', unit: 'Identities' })).toThrow(AccessError);
    // A cancelled lesson does not count either.
    db.lessons.push({ ...db.lessons.find((l) => l.studentIds.includes('s-omar') && l.tutorId === 't-craig')!, id: 'les-cancelled-arabic', subject: 'Arabic', status: 'cancelled' });
    expect(() => enr.addTopic(db, tutor('t-craig'), { enrolmentId: 'enr-omar-arabic', name: 'Poetry' })).toThrow(AccessError);
    // Once he teaches Omar an Arabic lesson, he may.
    db.lessons.push({ ...db.lessons.find((l) => l.id === 'les-cancelled-arabic')!, id: 'les-arabic', status: 'completed' });
    expect(enr.addTopic(db, tutor('t-craig'), { enrolmentId: 'enr-omar-arabic', name: 'Poetry', unit: 'Identities' }).listId).toBe('tl-ibdp-arabic-hl');
  });
});

describe('reports per enrolment (mirrors open_report_cycle)', () => {
  it('opens one report per active subject, for that subject’s tutor', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    db.enrolments.push({ id: 'enr-layla-french', studentId: 's-layla', subject: 'French', tutorId: 't-james', active: false });
    db.lessons.push({ ...db.lessons.find((l) => l.id === 'les-layla-chem-now')!, id: 'les-french', subject: 'French', tutorId: 't-james' });
    ops.openReportCycle(db, admin, 'Spring', '2026-09-01', '2026-10-30', NOW);
    const cycle = db.reportCycles[db.reportCycles.length - 1];
    const mine = (sid: string) => db.reports.filter((r) => r.cycleId === cycle.id && r.studentId === sid).map((r) => [r.subject, r.tutorId, r.enrolmentId]).sort();
    expect(mine('s-layla')).toEqual([
      ['Chemistry', 't-sarah', 'enr-layla-chemistry'],
      ['Maths', 't-sarah', 'enr-layla-maths'],
    ]);
    expect(mine('s-omar')).toEqual([
      ['Arabic', 't-nour', 'enr-omar-arabic'],
      ['Maths', 't-craig', 'enr-omar-maths'],
    ]);
    expect(mine('s-noor').map((r) => r[0])).toEqual(['English', 'Maths']);
    // Karim studies Additional Maths (Maths at the Additional level), so his Maths group lessons count for his enrolment.
    expect(mine('s-karim')).toEqual([['Maths', 't-sarah', 'enr-karim-maths']]);
  });

  it('gives the same subject in two curricula a report each', () => {
    const db = createSeed(NOW);
    db.enrolments.push({ id: 'enr-layla-maths-al', studentId: 's-layla', subject: 'Maths', curriculum: 'A-Level', tutorId: 't-james', active: true });
    ops.openReportCycle(db, who(db, 'admin'), 'Spring', '2026-09-01', '2026-10-30', NOW);
    const cycle = db.reportCycles[db.reportCycles.length - 1];
    expect(db.reports.filter((r) => r.cycleId === cycle.id && r.studentId === 's-layla').map((r) => [r.subject, r.tutorId, r.enrolmentId]).sort()).toEqual([
      ['Chemistry', 't-sarah', 'enr-layla-chemistry'],
      ['Maths', 't-james', 'enr-layla-maths-al'],
      ['Maths', 't-sarah', 'enr-layla-maths'],
    ]);
  });
});

describe('subjects through sign-up, enquiries and booking', () => {
  it('lets a parent add a child with their subjects', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    eq.addMyChild(db, parent, {
      fullName: ' Zain  Al Mansoori ', yearGroup: 'Year 5', phase: 'Primary',
      subjects: [{ subject: 'English', curriculum: 'British' }, { subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB' }],
    });
    const zain = db.students.find((s) => s.fullName === 'Zain Al Mansoori')!;
    expect(zain).toMatchObject({ familyId: 'f-mansoori', phase: 'Primary', yearGroup: 'Year 5' });
    expect(zain.curriculum ?? zain.syllabusId).toBeUndefined();
    expect(enr.enrolments(db, parent, zain.id).map((e) => [e.subject, e.curriculum, e.tutorId, e.topicListId])).toEqual([
      ['English', 'British', undefined, 'tl-british-english'],
      ['Maths', 'IB DP', undefined, undefined],
    ]);
    expect(() => eq.addMyChild(db, parent, { fullName: 'Nobody', subjects: [] })).toThrow('between one and ten subjects');
    expect(() => eq.addMyChild(db, parent, { fullName: 'Twice', subjects: [{ subject: 'Maths' }, { subject: 'maths' }] })).toThrow('listed twice');
    expect(db.students.some((s) => s.fullName === 'Nobody' || s.fullName === 'Twice')).toBe(false);
    // The office is told, since the family is promised a tutor within one working day.
    expect(db.outbox).toEqual([
      expect.objectContaining({
        audience: 'admins',
        subject: 'New child added: Zain Al Mansoori',
        body: expect.stringMatching(/added Zain Al Mansoori \(Year 5\)\.\n\nSubjects: British English, IB DP Maths \(AA HL\)\n\n.*within one working day\.$/),
        url: `/students/${zain.id}`,
      }),
    ]);
  });

  it('keeps the course a parent chooses, and finds the one that fits when they do not', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    const id = eq.addMyChild(db, parent, {
      fullName: 'Test Maths',
      subjects: [
        { subject: 'Maths', curriculum: 'IGCSE', syllabusId: 'igcse-4ma1' },
        { subject: 'Chemistry', curriculum: 'IGCSE', syllabusId: 'igcse-0580' },
        { subject: 'Maths', curriculum: 'IB DP', level: 'AA HL' },
        { subject: 'Additional Maths', curriculum: 'IGCSE' },
      ],
    });
    const rows = enr.enrolments(db, parent, id).map((e) => [e.subject, e.curriculum, e.level, e.examBoard, e.syllabusId]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ['Maths', 'IGCSE', undefined, 'Pearson Edexcel', 'igcse-4ma1'],
        ['Chemistry', 'IGCSE', undefined, undefined, undefined],
        ['Maths', 'IB DP', 'AA HL', 'IB', 'ib-aa-hl'],
        ['Additional Maths', 'IGCSE', undefined, 'Cambridge', 'igcse-0606'],
      ]),
    );
    expect(rows).toHaveLength(4);
    const unsure = eq.addMyChild(db, parent, { fullName: 'Unsure', subjects: [{ subject: 'Maths', curriculum: 'IGCSE' }] });
    expect(enr.enrolments(db, parent, unsure)[0].syllabusId).toBeUndefined();
  });

  it('stores the subject and phase of an enquiry', () => {
    const db = createSeed(NOW);
    eq.submitEnquiry(db, null, { parentName: 'Rita', email: 'r@x', subject: ' English ', phase: 'Primary', source: 'website' }, NOW);
    expect(db.enquiries[db.enquiries.length - 1]).toMatchObject({ subject: 'English', phase: 'Primary' });
  });

  it('carries the subject from a lesson request to the lesson', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    const from = new Date(2026, 9, 5).toISOString(); // Monday
    const slot = eq.openSlots(db, { tutorId: 't-sarah', from, days: 1, durationMin: 60 }, NOW)[0];
    eq.requestLesson(db, parent, { studentId: 's-layla', kind: 'new-lesson', tutorId: 't-sarah', serviceId: 'svc-igcse', subject: 'Chemistry', start: slot.start }, NOW);
    const req = db.requests[db.requests.length - 1];
    expect(req.subject).toBe('Chemistry');
    eq.decideRequest(db, who(db, 'admin'), req.id, true, undefined, NOW);
    expect(db.lessons.find((l) => l.start === slot.start && l.studentIds.includes('s-layla'))?.subject).toBe('Chemistry');
  });

  it('stores the subject of new lessons', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const [created] = cmd.createLessons(db, admin, [
      { tutorId: 't-nour', studentIds: ['s-noor'], serviceId: 'svc-primary', subject: 'English', start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T10:45:00.000Z', location: 'online' },
    ]);
    expect(created.subject).toBe('English');
  });
});
