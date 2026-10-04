import type { Profile } from '@/domain/types';

import { cw } from '../demo/classwork';
import { AccessError, cmd, type DemoDB } from '../demo/db';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 4, 12, 0);
const TODAY = '2026-10-04';
const who = (db: DemoDB, role: string) => db.profiles.find((p) => p.role === role)!;
const otherParent: Profile = { id: 'u-haddad', role: 'parent', fullName: 'Rami Haddad', email: 'rami@example.com', familyId: 'f-haddad' };
const hwFor = (db: DemoDB, studentId: string) => db.homework.find((h) => h.studentId === studentId)!;

describe('seeded classwork', () => {
  const db = createSeed(NOW);
  it('has resources, hand-ins and rich homework', () => {
    expect(db.resources).toHaveLength(6);
    expect(new Set(db.resources.map((r) => r.subject))).toEqual(new Set(['English', 'Chemistry', 'Mathematics', 'Arabic']));
    expect(db.resources.filter((r) => r.visibility === 'students').map((r) => r.studentIds)).toEqual([['s-omar']]);
    const rich = db.homework.filter((h) => h.details && (h.attachments ?? []).length > 0);
    expect(rich.length).toBeGreaterThanOrEqual(3);
    expect(rich.some((h) => h.attachments!.some((a) => a.kind === 'link')) && rich.some((h) => h.attachments!.some((a) => a.kind === 'file'))).toBe(true);
    expect(rich.some((h) => h.studentId === 's-omar' && !h.done && h.dueDate > TODAY)).toBe(true);
    expect(rich.some((h) => h.studentId === 's-layla')).toBe(true);
    expect(db.homework.every((h) => Array.isArray(h.attachments))).toBe(true);
  });
  it('has a marked hand-in for Omar and one awaiting Sarah', () => {
    const omar = db.submissions.find((s) => s.studentId === 's-omar')!;
    expect(omar).toMatchObject({ mark: '7/10', feedbackByName: "Craig O'Brien" });
    expect(db.homework.find((h) => h.id === omar.homeworkId)!.done).toBe(true);
    const layla = db.submissions.find((s) => s.studentId === 's-layla')!;
    expect(layla.feedback).toBeUndefined();
    expect(cw.submissions(db, who(db, 'tutor')).map((s) => s.id)).toEqual(['sub-layla-1']);
  });
  it('is deterministic', () => {
    const again = createSeed(NOW);
    expect(again.resources).toEqual(db.resources);
    expect(again.submissions).toEqual(db.submissions);
  });
});

describe('setting homework (mirrors save_homework)', () => {
  it('lets Sarah set homework for Layla but not for Omar', () => {
    const db = createSeed(NOW);
    const sarah = who(db, 'tutor');
    const hw = cw.saveHomework(db, sarah, { studentId: 's-layla', title: '  Simultaneous equations  ', dueDate: '2026-10-10', attachments: [] }, NOW);
    expect(hw).toMatchObject({ title: 'Simultaneous equations', tutorId: 't-sarah', done: false, attachments: [], createdAt: NOW.toISOString() });
    expect(() => cw.saveHomework(db, sarah, { studentId: 's-omar', title: 'X', dueDate: '2026-10-10', attachments: [] })).toThrow(AccessError);
    expect(() => cw.saveHomework(db, who(db, 'parent'), { studentId: 's-omar', title: 'X', dueDate: '2026-10-10', attachments: [] })).toThrow(AccessError);
    // Edits keep the student and update the content.
    const edited = cw.saveHomework(db, sarah, { id: hw.id, studentId: 's-layla', title: 'Revised', details: 'Questions 1–4', dueDate: '2026-10-12', attachments: [] });
    expect(edited).toMatchObject({ id: hw.id, title: 'Revised', details: 'Questions 1–4', dueDate: '2026-10-12' });
    expect(() => cw.saveHomework(db, sarah, { id: hwFor(db, 's-omar').id, studentId: 's-omar', title: 'X', dueDate: '2026-10-10', attachments: [] })).toThrow();
  });
  it('rejects a blank title, bad links and files from another student’s folder', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const base = { studentId: 's-omar', title: 'Practice', dueDate: '2026-10-10' };
    expect(() => cw.saveHomework(db, admin, { ...base, title: '  ', attachments: [] })).toThrow('title');
    expect(() => cw.saveHomework(db, admin, { ...base, attachments: [{ kind: 'link', name: 'x', url: 'javascript:alert(1)' }] })).toThrow('web address');
    expect(() => cw.saveHomework(db, admin, { ...base, attachments: [{ kind: 'file', name: 'x.pdf', path: 'students/s-layla/x.pdf' }] })).toThrow('right place');
    const ok = cw.saveHomework(db, admin, {
      ...base,
      attachments: [
        { kind: 'link', name: 'Bitesize', url: 'bbc.co.uk/bitesize' },
        { kind: 'file', name: 'sheet.pdf', path: 'students/s-omar/sheet.pdf' },
        { kind: 'file', name: 'Booklet', path: 'resources/booklet.pdf', resourceId: 'res-1' },
      ],
    });
    expect(ok.attachments![0].url).toBe('https://bbc.co.uk/bitesize');
    expect(ok.attachments![2].resourceId).toBe('res-1');
  });
});

describe('handing in and feedback (mirrors submit_homework / give_homework_feedback)', () => {
  it('lets the student and the parent hand in, which marks the homework done', () => {
    const db = createSeed(NOW);
    const hw = db.homework.find((h) => h.studentId === 's-omar' && !h.done)!;
    const sub = cw.submitHomework(db, who(db, 'student'), { homeworkId: hw.id, note: ' Finished ', files: [] }, NOW);
    expect(sub).toMatchObject({ studentId: 's-omar', note: 'Finished', submittedByName: 'Omar Al Mansoori', submittedAt: NOW.toISOString() });
    expect(hw.done).toBe(true);
    const fromParent = cw.submitHomework(db, who(db, 'parent'), {
      homeworkId: hw.id,
      files: [{ kind: 'file', name: 'photo.jpg', path: 'students/s-omar/photo.jpg', mimeType: 'image/jpeg' }],
    });
    expect(fromParent.submittedByName).toBe('Fatima Al Mansoori');
    expect(cw.submissions(db, who(db, 'student'), { homeworkId: hw.id })[0].id).toBe(fromParent.id);
  });
  it('stops tutors handing in, empty hand-ins and other families', () => {
    const db = createSeed(NOW);
    const layla = hwFor(db, 's-layla');
    expect(() => cw.submitHomework(db, who(db, 'tutor'), { homeworkId: layla.id, note: 'x', files: [] })).toThrow(AccessError);
    expect(() => cw.submitHomework(db, who(db, 'parent'), { homeworkId: layla.id, note: '  ', files: [] })).toThrow('note');
    expect(() => cw.submitHomework(db, otherParent, { homeworkId: layla.id, note: 'x', files: [] })).toThrow('not found');
    expect(() => cw.submitHomework(db, who(db, 'student'), { homeworkId: layla.id, note: 'x', files: [] })).toThrow('not found');
  });
  it('lets only the student’s tutor or an admin give feedback', () => {
    const db = createSeed(NOW);
    const sarah = who(db, 'tutor');
    cw.giveFeedback(db, sarah, 'sub-layla-1', 'Excellent work.', ' 9/10 ', NOW);
    expect(db.submissions.find((s) => s.id === 'sub-layla-1')).toMatchObject({ feedback: 'Excellent work.', mark: '9/10', feedbackByName: 'Sarah Khan', feedbackBy: 'u-tutor' });
    expect(() => cw.giveFeedback(db, sarah, 'sub-omar-1', 'x')).toThrow();
    expect(() => cw.giveFeedback(db, who(db, 'parent'), 'sub-layla-1', 'x')).toThrow(AccessError);
    expect(() => cw.giveFeedback(db, who(db, 'admin'), 'sub-omar-1', '  ')).toThrow('feedback');
    cw.giveFeedback(db, who(db, 'admin'), 'sub-omar-1', 'Revised feedback.');
    expect(db.submissions.find((s) => s.id === 'sub-omar-1')!.mark).toBeUndefined();
  });
});

describe('resource library', () => {
  it('shows tutors everything and families only what is shared with them', () => {
    const db = createSeed(NOW);
    expect(cw.resources(db, who(db, 'tutor'))).toHaveLength(6);
    expect(cw.resources(db, who(db, 'parent')).map((r) => r.id)).toEqual(['res-1']);
    expect(cw.resources(db, who(db, 'student')).map((r) => r.id)).toEqual(['res-1']);
    expect(cw.resources(db, otherParent)).toEqual([]);

    cw.shareResource(db, who(db, 'tutor'), 'res-2', 's-layla');
    cw.shareResource(db, who(db, 'tutor'), 'res-2', 's-layla');
    const shared = db.resources.find((r) => r.id === 'res-2')!;
    expect(shared).toMatchObject({ visibility: 'students', studentIds: ['s-layla'] });
    expect(cw.resources(db, who(db, 'parent')).map((r) => r.id).sort()).toEqual(['res-1', 'res-2']);
    expect(cw.resources(db, who(db, 'parent'), { studentId: 's-layla' }).map((r) => r.id)).toEqual(['res-2']);
    expect(cw.resources(db, who(db, 'student')).map((r) => r.id)).toEqual(['res-1']);
    expect(cw.resources(db, otherParent)).toEqual([]);

    expect(() => cw.shareResource(db, who(db, 'tutor'), 'res-3', 's-omar')).toThrow(AccessError);
    expect(() => cw.shareResource(db, who(db, 'parent'), 'res-3', 's-omar')).toThrow();
    cw.shareResource(db, who(db, 'admin'), 'res-3', 's-yasmin');
    expect(cw.resources(db, otherParent).map((r) => r.id)).toEqual(['res-3']);
  });
  it('validates new resources and keeps them in the library only', () => {
    const db = createSeed(NOW);
    const sarah = who(db, 'tutor');
    const link = cw.saveResource(db, sarah, { title: 'Revision', kind: 'link', url: 'www.example.org/notes', tags: [' maths ', ''] }, NOW);
    expect(link).toMatchObject({ url: 'https://www.example.org/notes', visibility: 'tutors', studentIds: [], uploadedBy: 'u-tutor', uploadedByName: 'Sarah Khan', tags: ['maths'] });
    expect(() => cw.saveResource(db, sarah, { title: 'Bad', kind: 'link', url: 'mailto:a@b.com', tags: [] })).toThrow('web address');
    expect(() => cw.saveResource(db, sarah, { title: 'Bad', kind: 'file', path: 'students/s-layla/x.pdf', tags: [] })).toThrow('right place');
    expect(() => cw.saveResource(db, who(db, 'parent'), { title: 'Mine', kind: 'link', url: 'https://example.org', tags: [] })).toThrow(AccessError);
    // Only the uploader or an admin may edit.
    expect(() => cw.saveResource(db, sarah, { id: 'res-1', title: 'Renamed', kind: 'file', path: 'resources/calculus-revision-booklet.pdf', tags: [] })).toThrow(AccessError);
    const renamed = cw.saveResource(db, who(db, 'admin'), { id: 'res-2', title: 'Renamed', kind: 'link', url: 'https://www.physicsandmathstutor.com', tags: [] });
    expect(renamed).toMatchObject({ title: 'Renamed', uploadedBy: 'u-tutor' });
  });
  it('lets only the uploader or an admin delete', () => {
    const db = createSeed(NOW);
    const sarah = who(db, 'tutor');
    expect(() => cw.deleteResource(db, sarah, 'res-1')).toThrow(AccessError);
    expect(() => cw.deleteResource(db, who(db, 'parent'), 'res-1')).toThrow();
    cw.deleteResource(db, sarah, 'res-2');
    cw.deleteResource(db, who(db, 'admin'), 'res-1');
    expect(db.resources.map((r) => r.id)).toEqual(['res-3', 'res-4', 'res-5', 'res-6']);
  });
  it('copes with an older saved database without the new collections', () => {
    const db = createSeed(NOW) as Partial<DemoDB> as DemoDB;
    delete (db as Partial<DemoDB>).resources;
    delete (db as Partial<DemoDB>).submissions;
    expect(cw.resources(db, who(db, 'admin'))).toEqual([]);
    expect(cw.submissions(db, who(db, 'admin'))).toEqual([]);
  });
});

describe('completing a lesson', () => {
  it('stores homework details and attachments', () => {
    const db = createSeed(NOW);
    const lesson = db.lessons.find((l) => l.tutorId === 't-sarah' && l.status === 'scheduled' && l.studentIds.includes('s-layla'))!;
    cmd.completeLesson(
      db,
      who(db, 'tutor'),
      {
        lessonId: lesson.id,
        status: 'completed',
        attendance: { 's-layla': 'present' },
        summary: 'Good lesson.',
        topicIds: [],
        ratings: [],
        homework: [
          {
            studentId: 's-layla',
            title: ' Quadratics ',
            dueDate: '2026-10-11',
            details: ' Questions 1 to 10. ',
            attachments: [{ kind: 'link', name: 'Bitesize', url: 'https://www.bbc.co.uk/bitesize' }],
          },
          { studentId: 's-layla', title: 'Reading', dueDate: '2026-10-11' },
        ],
      },
      NOW,
    );
    const [rich, plain] = db.homework.filter((h) => h.lessonId === lesson.id);
    expect(rich).toMatchObject({ title: 'Quadratics', details: 'Questions 1 to 10.', tutorId: 't-sarah', createdAt: NOW.toISOString() });
    expect(rich.attachments).toHaveLength(1);
    expect(plain.attachments).toEqual([]);
  });
});
