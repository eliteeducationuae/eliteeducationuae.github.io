import { toDateKey } from '@/domain/dates';
import { assembleHandoverPack } from '@/domain/handover';
import { lessonsNeedingPlan } from '@/domain/plans';
import { buildTopicLookup } from '@/domain/topics';
import type { Profile } from '@/domain/types';

import { SYLLABUSES } from '../curriculum';
import { enr, type DemoDB } from '../demo/db';
import { eq } from '../demo/engagement';
import { ho } from '../demo/handover';
import { ops } from '../demo/operations';
import { createSeed, SEED_CHARLOTTE_NOTES, SEED_HANDOVER_NOTE, SEED_PLAN_OBJECTIVES, SEED_PRIVATE_NOTE } from '../demo/seed';

const NOW = new Date(2026, 9, 4, 12, 0);
const who = (db: DemoDB, role: string) => db.profiles.find((p) => p.role === role)!;
const tutor = (tutorId: string): Profile => ({ id: `u-${tutorId}`, role: 'tutor', fullName: tutorId, email: `${tutorId}@example.com`, tutorId });
const james = tutor('t-james');
const nour = tutor('t-nour');
const otherParent: Profile = { id: 'u-haddad', role: 'parent', fullName: 'Rami Haddad', email: 'rami@example.com', familyId: 'f-haddad' };
const hughesParent: Profile = { id: 'u-hughes', role: 'parent', fullName: 'Emma Hughes', email: 'emma@example.com', familyId: 'f-hughes' };

/** What the demo source does when an admin reassigns a lesson. */
function reassign(db: DemoDB, lessonId: string, tutorId: string, now = NOW) {
  const old = db.lessons.find((l) => l.id === lessonId)!.tutorId;
  eq.reassignLesson(db, who(db, 'admin'), lessonId, tutorId);
  return ho.afterLessonReassigned(db, db.lessons.find((l) => l.id === lessonId)!, old, now);
}

const omarPlanLesson = (db: DemoDB) => db.lessonPlans!.find((p) => p.objectives === SEED_PLAN_OBJECTIVES)!.lessonId;

describe('seeded plans and handovers', () => {
  const db = createSeed(NOW);

  it('has Charlotte’s cover handover for Sarah', () => {
    const h = db.handovers!.find((x) => x.id === 'ho-charlotte')!;
    expect(h).toMatchObject({ reason: 'cover', studentId: 's-charlotte', subject: 'Maths', fromTutorId: 't-james', toTutorId: 't-sarah', note: SEED_HANDOVER_NOTE });
    expect(h.viewedAt).toBeUndefined();
    const covered = db.lessons.find((l) => l.id === h.lessonId)!;
    expect(covered).toMatchObject({ tutorId: 't-sarah', status: 'scheduled', studentIds: ['s-charlotte'] });
    const absence = db.absences.find((a) => a.id === 'abs-1')!;
    const day = toDateKey(new Date(covered.start));
    expect(day >= absence.startDate && day <= absence.endDate).toBe(true);
    // Sarah has nothing else at that time.
    const clash = db.lessons.filter((l) => l.id !== covered.id && l.tutorId === 't-sarah' && l.status === 'scheduled' && l.start < covered.end && l.end > covered.start);
    expect(clash).toEqual([]);
    expect(ho.handovers(db, who(db, 'tutor')).map((x) => x.id)).toEqual(['ho-charlotte']);
  });

  it('has James’s private note, open homework and ratings for Charlotte', () => {
    const recorded = db.lessons.filter((l) => l.tutorId === 't-james' && l.studentIds.includes('s-charlotte') && l.status === 'completed');
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    expect(db.notes.filter((n) => recorded.some((l) => l.id === n.lessonId)).length).toBeGreaterThanOrEqual(2);
    const latest = recorded.sort((a, b) => b.start.localeCompare(a.start))[0];
    expect(db.notes.find((n) => n.lessonId === latest.id)!.privateNote).toBe(SEED_PRIVATE_NOTE);
    expect(db.homework.some((h) => h.studentId === 's-charlotte' && !h.done)).toBe(true);
    expect(db.ratings.some((r) => r.studentId === 's-charlotte')).toBe(true);
  });

  it('has a plan for Omar’s next lesson that the family can read', () => {
    const lessonId = omarPlanLesson(db);
    const plan = ho.plan(db, who(db, 'parent'), lessonId)!;
    expect(plan).toMatchObject({ objectives: SEED_PLAN_OBJECTIVES, sharedWithFamily: true });
    expect(plan.topicIds.length).toBeGreaterThanOrEqual(1);
    expect(plan.topicIds.length).toBeLessThanOrEqual(2);
    expect(ho.plan(db, who(db, 'student'), lessonId)).not.toBeNull();
    const lesson = db.lessons.find((l) => l.id === lessonId)!;
    expect(lesson.studentIds).toEqual(['s-omar']);
    expect(new Date(lesson.start) > NOW).toBe(true);
  });

  it('gives Sarah a lesson to plan in the next 48 hours, on any day of the week', () => {
    for (let d = 0; d < 7; d++) {
      for (const hour of [7, 12, 20]) {
        const now = new Date(2026, 9, 4 + d, hour, 0);
        const seeded = createSeed(now);
        const sarah = seeded.lessons.filter((l) => l.tutorId === 't-sarah');
        expect(lessonsNeedingPlan(sarah, seeded.lessonPlans ?? [], 't-sarah', now).length).toBeGreaterThan(0);
        expect(seeded.handovers!.some((h) => h.id === 'ho-charlotte')).toBe(true);
      }
    }
  });

  it('assembles Sarah’s pack without James’s private note', () => {
    const sources = ho.sources(db, who(db, 'tutor'), 'ho-charlotte');
    expect(sources.notes.some((n) => n.privateNote === SEED_PRIVATE_NOTE)).toBe(false);
    expect(sources.lessons.length).toBeLessThanOrEqual(10);
    expect(sources.lessons.every((l) => l.status === 'completed' || l.status === 'no-show')).toBe(true);
    expect(sources.homework.every((h) => !h.done && h.studentId === 's-charlotte')).toBe(true);
    const pack = assembleHandoverPack(sources, buildTopicLookup(SYLLABUSES, db.topicLists, db.topics), NOW);
    expect(pack.handoverNote).toBe(SEED_HANDOVER_NOTE);
    expect(pack.recentLessons).toHaveLength(5);
    expect(pack.mastery).not.toBeNull();
    expect(pack.openHomework.length).toBeGreaterThan(0);

    const admin = ho.sources(db, who(db, 'admin'), 'ho-charlotte');
    expect(admin.notes.some((n) => n.privateNote === SEED_PRIVATE_NOTE)).toBe(true);
  });

  it('fills every part of Sarah’s pack with coherent content', () => {
    const sources = ho.sources(db, who(db, 'tutor'), 'ho-charlotte');
    const pack = assembleHandoverPack(sources, buildTopicLookup(SYLLABUSES, db.topicLists, db.topics), NOW);
    expect(pack.examDate).toBeDefined();
    expect(pack.daysToExam).toBeGreaterThan(0);
    expect(pack.tutorNotes).toBe(SEED_CHARLOTTE_NOTES);
    expect(pack.recentPlans.length).toBeGreaterThan(0);
    expect(pack.recentPlans[0].homeworkTitles).toContain('Probability: tree diagrams exercise');
    expect(pack.resources.map((r) => r.id)).toContain('res-1');
    // The note mentions tree diagrams, and that homework is in the pack.
    expect(SEED_HANDOVER_NOTE).toContain('tree diagrams');
    expect(pack.openHomework.some((h) => h.title === 'Probability: tree diagrams exercise')).toBe(true);
    expect(pack.goals.some((g) => /Target grade|Exam on/.test(g))).toBe(false);
  });
});

describe('handover packs (mirror the handovers policies and handover_pack)', () => {
  it('lets only the incoming tutor and admins open the pack', () => {
    const db = createSeed(NOW);
    for (const viewer of [james, nour, who(db, 'parent'), hughesParent, who(db, 'student')]) {
      expect(() => ho.sources(db, viewer, 'ho-charlotte')).toThrow('Handover pack not found.');
    }
    expect(() => ho.sources(db, who(db, 'admin'), 'ho-missing')).toThrow('Handover pack not found.');
  });

  it('lists handovers for admins and the tutors involved only', () => {
    const db = createSeed(NOW);
    expect(ho.handovers(db, james).map((h) => h.id)).toEqual(['ho-charlotte']);
    expect(ho.handovers(db, nour)).toEqual([]);
    expect(ho.handovers(db, who(db, 'parent'))).toEqual([]);
    expect(ho.handovers(db, who(db, 'admin'), { studentId: 's-omar' })).toEqual([]);
    expect(ho.handovers(db, who(db, 'admin'), { studentId: 's-charlotte' })).toHaveLength(1);
  });

  it('lets the outgoing tutor or an admin write the note', () => {
    const db = createSeed(NOW);
    ho.saveNote(db, james, 'ho-charlotte', '  Please start with tree diagrams.  ', NOW);
    expect(db.handovers!.find((h) => h.id === 'ho-charlotte')).toMatchObject({ note: 'Please start with tree diagrams.', noteUpdatedAt: NOW.toISOString() });
    expect(() => ho.saveNote(db, who(db, 'tutor'), 'ho-charlotte', 'x')).toThrow('Only the previous tutor or an admin');
    expect(() => ho.saveNote(db, nour, 'ho-charlotte', 'x')).toThrow();
    expect(() => ho.saveNote(db, james, 'ho-charlotte', 'x'.repeat(4001))).toThrow('4,000');
    ho.saveNote(db, who(db, 'admin'), 'ho-charlotte', '');
    expect(db.handovers!.find((h) => h.id === 'ho-charlotte')!.note).toBeUndefined();
  });

  it('marks the pack viewed only for the incoming tutor', () => {
    const db = createSeed(NOW);
    const h = db.handovers!.find((x) => x.id === 'ho-charlotte')!;
    ho.markViewed(db, who(db, 'admin'), h.id, NOW);
    ho.markViewed(db, james, h.id, NOW);
    expect(h.viewedAt).toBeUndefined();
    ho.markViewed(db, who(db, 'tutor'), h.id, NOW);
    expect(h.viewedAt).toBe(NOW.toISOString());
    ho.markViewed(db, who(db, 'tutor'), h.id, new Date(NOW.getTime() + 60_000));
    expect(h.viewedAt).toBe(NOW.toISOString());
  });

  it('creates one cover handover when an admin reassigns a lesson, and does not repeat it', () => {
    const db = createSeed(NOW);
    const lesson = db.lessons.find((l) => l.seriesId === 'series-arjun' && l.status === 'scheduled' && new Date(l.start) > NOW)!;
    const created = reassign(db, lesson.id, 't-james');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ reason: 'cover', studentId: 's-arjun', lessonId: lesson.id, fromTutorId: 't-craig', toTutorId: 't-james', subject: 'Maths' });
    expect(created[0].enrolmentId).toBe('enr-arjun-maths');
    expect(created[0].studentName).toBe(db.students.find((s) => s.id === 's-arjun')!.fullName);
    // James reads the pack, so it stays when the lesson briefly goes back to Craig.
    ho.markViewed(db, james, created[0].id, NOW);
    reassign(db, lesson.id, 't-craig');
    reassign(db, lesson.id, 't-james');
    const toJames = db.handovers!.filter((h) => h.lessonId === lesson.id && h.toTutorId === 't-james');
    expect(toJames).toHaveLength(1);
    expect(db.handovers!.filter((h) => h.lessonId === lesson.id)).toHaveLength(1);
    // After the dedupe window a fresh handover is made.
    const later = new Date(NOW.getTime() + 15 * 86_400_000);
    reassign(db, lesson.id, 't-craig', later);
    reassign(db, lesson.id, 't-james', later);
    expect(db.handovers!.filter((h) => h.lessonId === lesson.id && h.toTutorId === 't-james')).toHaveLength(2);
  });

  it('sends nothing when a cover is undone, and withdraws the unread cover pack (as on_lesson_tutor_changed does)', () => {
    const db = createSeed(NOW);
    const covered = db.handovers!.find((h) => h.id === 'ho-charlotte')!.lessonId!;
    expect(reassign(db, covered, 't-james')).toEqual([]);
    expect(db.handovers!.some((h) => h.toTutorId === 't-james' && h.studentId === 's-charlotte')).toBe(false);
    expect(db.handovers!.some((h) => h.id === 'ho-charlotte')).toBe(false);
  });

  it('names the student on every handover, even for a tutor who cannot see them yet', () => {
    const db = createSeed(NOW);
    for (const h of ho.handovers(db, who(db, 'admin'))) expect(h.studentName).toBe(db.students.find((s) => s.id === h.studentId)!.fullName);
  });

  it('reuses the handover for a second covered lesson with the same student, subject and tutor (as create_handover does)', () => {
    const db = createSeed(NOW);
    const next = db.lessons
      .filter((l) => l.studentIds.includes('s-charlotte') && l.subject === 'Maths' && l.tutorId === 't-james' && l.status === 'scheduled' && new Date(l.start) > NOW)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const created = reassign(db, next.id, 't-sarah');
    expect(created.map((h) => h.id)).toEqual(['ho-charlotte']);
    expect(db.handovers!.filter((h) => h.studentId === 's-charlotte' && h.toTutorId === 't-sarah')).toHaveLength(1);
  });

  it('reuses a recent cover handover when the enrolment then moves to the covering tutor, filling in the enrolment', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const lesson = db.lessons.find((l) => l.seriesId === 'series-arjun' && l.status === 'scheduled' && new Date(l.start) > NOW)!;
    const [cover] = reassign(db, lesson.id, 't-james');
    delete cover.enrolmentId;
    const before = { ...db.enrolments.find((e) => e.id === 'enr-arjun-maths')! };
    const saved = enr.saveEnrolment(db, admin, { ...before, tutorId: 't-james' });
    const h = ho.afterEnrolmentSaved(db, before, saved, NOW)!;
    expect(h.id).toBe(cover.id);
    expect(h).toMatchObject({ reason: 'cover', lessonId: lesson.id, enrolmentId: 'enr-arjun-maths' });
    expect(db.handovers!.filter((x) => x.studentId === 's-arjun' && x.toTutorId === 't-james')).toHaveLength(1);
    // Charlotte's seeded cover is reused the same way.
    const charlotte = { ...db.enrolments.find((e) => e.studentId === 's-charlotte' && e.subject === 'Maths')! };
    const moved = enr.saveEnrolment(db, admin, { ...charlotte, tutorId: 't-sarah' });
    expect(ho.afterEnrolmentSaved(db, charlotte, moved, NOW)!.id).toBe('ho-charlotte');
  });

  it('creates a handover when a subject gets a new tutor, and not otherwise', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const before = { ...db.enrolments.find((e) => e.id === 'enr-layla-chemistry')! };
    const saved = enr.saveEnrolment(db, admin, { ...before, tutorId: 't-james' });
    const h = ho.afterEnrolmentSaved(db, before, saved, NOW)!;
    expect(h).toMatchObject({ reason: 'reassigned', studentId: 's-layla', subject: 'Chemistry', enrolmentId: 'enr-layla-chemistry', fromTutorId: 't-sarah', toTutorId: 't-james' });
    const same = { ...saved };
    expect(ho.afterEnrolmentSaved(db, same, enr.saveEnrolment(db, admin, { ...same }), NOW)).toBeNull();
    expect(ho.afterEnrolmentSaved(db, undefined, saved, NOW)).toBeNull();
    // A first assignment is not a handover (the enrolments trigger needs a previous tutor).
    expect(ho.afterEnrolmentSaved(db, { ...saved, tutorId: undefined }, { ...saved, tutorId: 't-nour' }, NOW)).toBeNull();
  });

  it('creates a handover when a role for a known student is awarded', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const role = ops.saveOpportunity(db, admin, { title: 'Arabic for Omar', subject: 'Arabic', studentId: 's-omar', payRate: 220, visibility: 'all', invitedTutorIds: [] }, NOW);
    ops.placeBid(db, james, role.id, 'I would be pleased to teach Omar.', undefined, NOW);
    ops.awardOpportunity(db, admin, db.bids[db.bids.length - 1].id, NOW);
    const h = ho.afterAward(db, role.id, NOW)!;
    expect(h).toMatchObject({ reason: 'awarded', studentId: 's-omar', subject: 'Arabic', opportunityId: role.id, fromTutorId: 't-nour', toTutorId: 't-james', enrolmentId: 'enr-omar-arabic' });
    // A role with no student makes no handover.
    const open = ops.saveOpportunity(db, admin, { title: 'New family', payRate: 200, visibility: 'all', invitedTutorIds: [] }, NOW);
    ops.placeBid(db, james, open.id, 'Happy to help.', undefined, NOW);
    ops.awardOpportunity(db, admin, db.bids[db.bids.length - 1].id, NOW);
    expect(ho.afterAward(db, open.id, NOW)).toBeNull();
  });
});

describe('session plans (mirror lesson_plans policies and save_lesson_plan)', () => {
  it('shows a plan to the family only when it is shared', () => {
    const db = createSeed(NOW);
    const lessonId = omarPlanLesson(db);
    expect(ho.plan(db, otherParent, lessonId)).toBeNull();
    expect(ho.plan(db, who(db, 'tutor'), lessonId)).toBeNull();
    const admin = who(db, 'admin');
    const current = ho.plan(db, admin, lessonId)!;
    ho.savePlan(db, admin, { ...current, sharedWithFamily: false }, NOW);
    expect(ho.plan(db, who(db, 'parent'), lessonId)).toBeNull();
    expect(ho.plan(db, who(db, 'student'), lessonId)).toBeNull();
    expect(ho.plan(db, admin, lessonId)).toMatchObject({ sharedWithFamily: false, updatedAt: NOW.toISOString() });
  });

  it('shows each family only general homework and their own children’s in a shared group plan', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const start = new Date(NOW.getTime() + 5 * 86_400_000);
    db.lessons.push({
      id: 'les-group-two-families', tutorId: 't-craig', studentIds: ['s-omar', 's-charlotte'], serviceId: 'svc-group', subject: 'Maths',
      start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), location: 'online', status: 'scheduled',
    });
    ho.savePlan(db, admin, {
      lessonId: 'les-group-two-families', objectives: 'Vectors', topicIds: [], resourceIds: [], sharedWithFamily: true,
      homework: [{ title: 'Read the notes' }, { studentId: 's-omar', title: 'Omar: extension set' }, { studentId: 's-charlotte', title: 'Charlotte: catch-up sheet' }],
    }, NOW);
    const titles = (viewer: Profile) => ho.plan(db, viewer, 'les-group-two-families')?.homework.map((h) => h.title);
    expect(titles(admin)).toEqual(['Read the notes', 'Omar: extension set', 'Charlotte: catch-up sheet']);
    expect(titles(who(db, 'parent'))).toEqual(['Read the notes', 'Omar: extension set']);
    expect(titles(hughesParent)).toEqual(['Read the notes', 'Charlotte: catch-up sheet']);
    expect(ho.plan(db, otherParent, 'les-group-two-families')).toBeNull();
    const range = { from: start.toISOString(), to: new Date(start.getTime() + 1).toISOString() };
    expect(ho.plans(db, hughesParent, range).flatMap((p) => p.homework).some((h) => h.studentId === 's-omar')).toBe(false);
    // The stored plan is untouched.
    expect(db.lessonPlans!.find((p) => p.lessonId === 'les-group-two-families')!.homework).toHaveLength(3);
  });

  it('lets only the lesson’s tutor or an admin save a plan, on scheduled lessons', () => {
    const db = createSeed(NOW);
    const lessonId = omarPlanLesson(db);
    const input = { lessonId, objectives: 'Vectors', topicIds: [], resourceIds: [], homework: [], sharedWithFamily: false };
    expect(() => ho.savePlan(db, who(db, 'tutor'), input)).toThrow();
    expect(() => ho.savePlan(db, who(db, 'parent'), input)).toThrow();
    const done = db.lessons.find((l) => l.tutorId === 't-sarah' && l.status === 'completed')!;
    expect(() => ho.savePlan(db, who(db, 'tutor'), { ...input, lessonId: done.id })).toThrow('Only scheduled lessons can be planned.');
    const mine = db.lessons.find((l) => l.tutorId === 't-sarah' && l.status === 'scheduled' && new Date(l.start) > NOW)!;
    expect(() => ho.savePlan(db, who(db, 'tutor'), { ...input, lessonId: mine.id, objectives: ' ' })).toThrow('Please add an objective');
    expect(() =>
      ho.savePlan(db, who(db, 'tutor'), { ...input, lessonId: mine.id, homework: [{ studentId: 's-omar', title: 'X' }] }),
    ).toThrow('Planned homework must be for a student in this lesson.');
    const saved = ho.savePlan(db, who(db, 'tutor'), { ...input, lessonId: mine.id, objectives: '  Vectors  ', topicIds: ['a', 'a'] }, NOW);
    expect(saved).toMatchObject({ lessonId: mine.id, tutorId: 't-sarah', objectives: 'Vectors', topicIds: ['a'], createdAt: NOW.toISOString() });
    const range = { from: new Date(mine.start).toISOString(), to: new Date(new Date(mine.start).getTime() + 1).toISOString() };
    expect(ho.plans(db, who(db, 'tutor'), range).map((p) => p.lessonId)).toEqual([mine.id]);
    expect(() => ho.deletePlan(db, nour, mine.id)).toThrow();
    ho.deletePlan(db, who(db, 'tutor'), mine.id);
    expect(ho.plan(db, who(db, 'tutor'), mine.id)).toBeNull();
  });
});
