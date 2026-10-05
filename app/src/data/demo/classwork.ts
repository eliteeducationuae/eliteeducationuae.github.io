import { addDays, toDateKey } from '@/domain/dates';
import { normaliseLink } from '@/domain/homework';
import type { Attachment, Homework, HomeworkSubmission, Profile, Resource } from '@/domain/types';

import type { CompleteLessonInput, HomeworkInput, ResourceInput } from '../source';
import { AccessError, newId, visibleStudentIds, type DemoDB } from './db';

// Homework hand-ins, feedback and the resource library. Mirrors the rules in the
// 20261008000000_homework migration (save_homework, submit_homework, give_homework_feedback,
// share_resource and the resources policies).

/** Older persisted demo databases predate these collections. */
const submissionsOf = (db: DemoDB) => (db.submissions ??= []);
const resourcesOf = (db: DemoDB) => (db.resources ??= []);

/** Admins, or a tutor who teaches the student. */
function canTeach(db: DemoDB, viewer: Profile, studentId: string): boolean {
  if (viewer.role === 'admin') return true;
  return viewer.role === 'tutor' && visibleStudentIds(db, viewer).has(studentId);
}

const isStaff = (viewer: Profile) => viewer.role === 'admin' || viewer.role === 'tutor';

/** Check and tidy attachments: files must sit in the given folders; links must be http or https. */
function cleanAttachments(list: Attachment[] | undefined, allowedPrefixes: string[]): Attachment[] {
  return (list ?? []).map((a) => {
    const name = a.name?.trim();
    if (!name) throw new Error('Each attachment needs a name.');
    if (a.kind === 'link') {
      const url = a.url ? normaliseLink(a.url) : null;
      if (!url) throw new Error('Please enter a valid web address (http or https).');
      const out: Attachment = { kind: 'link', name, url };
      if (a.resourceId) out.resourceId = a.resourceId;
      return out;
    }
    if (a.kind !== 'file' || !a.path || !allowedPrefixes.some((p) => a.path!.startsWith(p)) || a.path.includes('..')) {
      throw new Error('That file is not stored in the right place.');
    }
    const out: Attachment = { kind: 'file', name, path: a.path };
    if (a.mimeType) out.mimeType = a.mimeType;
    if (a.resourceId) out.resourceId = a.resourceId;
    return out;
  });
}

const studentPrefixes = (studentId: string) => [`students/${studentId}/`, 'resources/'];
/** Hand-ins may only be the student's own uploads (valid_handin_files in 20261013000000_review_fixes). */
const handInPrefixes = (studentId: string) => [`students/${studentId}/`];

export const cw = {
  getHomework(db: DemoDB, viewer: Profile, id: string): Homework | null {
    const hw = db.homework.find((h) => h.id === id);
    if (!hw || !visibleStudentIds(db, viewer).has(hw.studentId)) return null;
    return { ...hw, attachments: hw.attachments ?? [] };
  },

  saveHomework(db: DemoDB, viewer: Profile, input: HomeworkInput, now = new Date()): Homework {
    const existing = input.id ? db.homework.find((h) => h.id === input.id) : undefined;
    if (input.id && (!existing || !visibleStudentIds(db, viewer).has(existing.studentId))) throw new Error('Homework not found');
    const studentId = existing?.studentId ?? input.studentId;
    if (!canTeach(db, viewer, studentId) || (existing && input.studentId && input.studentId !== studentId)) {
      throw new AccessError('Only the student’s tutor or an admin can set homework.');
    }
    if (!db.students.some((s) => s.id === studentId)) throw new Error('Student not found');
    // Homework set from a lesson must belong to that lesson: the student was in it, and it is the caller's lesson.
    if (!existing && input.lessonId) {
      const lesson = db.lessons.find((l) => l.id === input.lessonId);
      if (!lesson || !lesson.studentIds.includes(studentId) || !(viewer.role === 'admin' || lesson.tutorId === viewer.tutorId)) {
        throw new Error('Lesson not found');
      }
    }
    const title = input.title.trim();
    if (!title) throw new Error('Please give the homework a title.');
    if (!/^\d{4}-\d{2}-\d{2}/.test(input.dueDate ?? '')) throw new Error('Please choose a due date.');
    const attachments = cleanAttachments(input.attachments, studentPrefixes(studentId));
    const details = input.details?.trim() || undefined;
    const dueDate = input.dueDate.slice(0, 10);

    if (existing) {
      existing.title = title;
      existing.details = details;
      existing.dueDate = dueDate;
      existing.attachments = attachments;
      return existing;
    }
    const hw: Homework = {
      id: newId('hw'),
      studentId,
      lessonId: input.lessonId,
      title,
      details,
      dueDate,
      done: false,
      attachments,
      tutorId: viewer.tutorId,
      createdAt: now.toISOString(),
    };
    db.homework.push(hw);
    return hw;
  },

  submissions(db: DemoDB, viewer: Profile, filter: { homeworkId?: string; studentId?: string } = {}): HomeworkSubmission[] {
    const ids = visibleStudentIds(db, viewer);
    return submissionsOf(db)
      .filter(
        (s) =>
          ids.has(s.studentId) &&
          (!filter.homeworkId || s.homeworkId === filter.homeworkId) &&
          (!filter.studentId || s.studentId === filter.studentId),
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  },

  submitHomework(
    db: DemoDB,
    viewer: Profile,
    input: { homeworkId: string; note?: string; files: Attachment[] },
    now = new Date(),
  ): HomeworkSubmission {
    const hw = db.homework.find((h) => h.id === input.homeworkId);
    if (!hw || !visibleStudentIds(db, viewer).has(hw.studentId)) throw new Error('Homework not found');
    if (!(viewer.role === 'student' || viewer.role === 'parent' || viewer.role === 'admin')) {
      throw new AccessError('Only the student or their family can hand in homework.');
    }
    const note = input.note?.trim() || undefined;
    const files = cleanAttachments(input.files, handInPrefixes(hw.studentId));
    if (!note && files.length === 0) throw new Error('Please add a note or attach your work.');
    const sub: HomeworkSubmission = {
      id: newId('sub'),
      homeworkId: hw.id,
      studentId: hw.studentId,
      submittedBy: viewer.id,
      submittedByName: viewer.fullName,
      note,
      files,
      submittedAt: now.toISOString(),
    };
    submissionsOf(db).push(sub);
    hw.done = true;
    return sub;
  },

  giveFeedback(db: DemoDB, viewer: Profile, submissionId: string, feedback: string, mark?: string, now = new Date()) {
    const sub = submissionsOf(db).find((s) => s.id === submissionId);
    if (!sub || !visibleStudentIds(db, viewer).has(sub.studentId)) throw new Error('Hand-in not found');
    if (!canTeach(db, viewer, sub.studentId)) throw new AccessError('Only the student’s tutor or an admin can give feedback.');
    const text = feedback.trim();
    if (!text) throw new Error('Please write some feedback.');
    sub.feedback = text;
    sub.mark = mark?.trim() || undefined;
    sub.feedbackAt = now.toISOString();
    sub.feedbackBy = viewer.id;
    sub.feedbackByName = viewer.fullName;
  },

  /** Mirrors list_resources: only admins see every student a resource is shared with. */
  resources(db: DemoDB, viewer: Profile, filter: { studentId?: string } = {}): Resource[] {
    let list = resourcesOf(db);
    const ids = visibleStudentIds(db, viewer);
    if (!isStaff(viewer)) {
      list = list.filter((r) => r.visibility === 'students' && r.studentIds.some((id) => ids.has(id)));
    }
    let out = list.map((r) => (viewer.role === 'admin' ? { ...r } : { ...r, studentIds: r.studentIds.filter((id) => ids.has(id)) }));
    if (filter.studentId) out = out.filter((r) => r.studentIds.includes(filter.studentId!));
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  saveResource(db: DemoDB, viewer: Profile, input: ResourceInput, now = new Date()): Resource {
    if (!isStaff(viewer)) throw new AccessError('Only tutors can add to the resource library.');
    const existing = input.id ? resourcesOf(db).find((r) => r.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Resource not found');
    if (existing && viewer.role !== 'admin' && existing.uploadedBy !== viewer.id) {
      throw new AccessError('Only the person who added this resource, or an admin, can change it.');
    }
    const title = input.title.trim();
    if (!title) throw new Error('Please give the resource a title.');
    let path: string | undefined;
    let url: string | undefined;
    if (input.kind === 'file') {
      if (!input.path?.startsWith('resources/') || input.path.includes('..')) throw new Error('That file is not stored in the right place.');
      path = input.path;
    } else {
      url = input.url ? (normaliseLink(input.url) ?? undefined) : undefined;
      if (!url) throw new Error('Please enter a valid web address (http or https).');
    }
    const fields = {
      title,
      description: input.description?.trim() || undefined,
      subject: input.subject?.trim() || undefined,
      curriculum: input.curriculum?.trim() || undefined,
      level: input.level?.trim() || undefined,
      kind: input.kind,
      path,
      url,
      fileName: input.kind === 'file' ? input.fileName?.trim() || undefined : undefined,
      mimeType: input.kind === 'file' ? input.mimeType || undefined : undefined,
      tags: input.tags.map((t) => t.trim()).filter(Boolean),
    };
    if (existing) {
      Object.assign(existing, fields);
      return existing;
    }
    const resource: Resource = {
      id: newId('res'),
      ...fields,
      uploadedBy: viewer.id,
      uploadedByName: viewer.fullName,
      visibility: 'tutors',
      studentIds: [],
      createdAt: now.toISOString(),
    };
    resourcesOf(db).push(resource);
    return resource;
  },

  /**
   * Mirrors delete_resource: returns the stored path to remove, or null when there is no file or
   * homework, a hand-in or another library entry still refers to it, so work already set keeps its copy.
   */
  deleteResource(db: DemoDB, viewer: Profile, id: string): string | null {
    const list = resourcesOf(db);
    const resource = list.find((r) => r.id === id);
    if (!resource || !isStaff(viewer)) throw new Error('Resource not found');
    if (viewer.role !== 'admin' && resource.uploadedBy !== viewer.id) {
      throw new AccessError('Only the person who added this resource, or an admin, can delete it.');
    }
    db.resources = list.filter((r) => r.id !== id);
    const path = resource.kind === 'file' ? resource.path : undefined;
    if (!path) return null;
    const uses = (atts: Attachment[] | undefined) => (atts ?? []).some((a) => a.path === path);
    const inUse =
      db.homework.some((h) => uses(h.attachments)) || submissionsOf(db).some((s) => uses(s.files)) || db.resources.some((r) => r.path === path);
    return inUse ? null : path;
  },

  shareResource(db: DemoDB, viewer: Profile, resourceId: string, studentId: string) {
    const resource = resourcesOf(db).find((r) => r.id === resourceId);
    if (!resource || !isStaff(viewer)) throw new Error('Resource not found');
    if (!canTeach(db, viewer, studentId)) throw new AccessError('You can only share resources with students you teach.');
    if (!resource.studentIds.includes(studentId)) resource.studentIds.push(studentId);
    resource.visibility = 'students';
  },

  unshareResource(db: DemoDB, viewer: Profile, resourceId: string, studentId: string) {
    const resource = resourcesOf(db).find((r) => r.id === resourceId);
    if (!resource || !isStaff(viewer)) throw new Error('Resource not found');
    if (!canTeach(db, viewer, studentId)) throw new AccessError('You can only change sharing for students you teach.');
    resource.studentIds = resource.studentIds.filter((id) => id !== studentId);
    resource.visibility = resource.studentIds.length ? 'students' : 'tutors';
  },

  /** Check homework attachments set while recording a lesson, as save_homework would. Throws before anything changes. */
  checkLessonHomework(input: CompleteLessonInput): CompleteLessonInput {
    return {
      ...input,
      homework: input.homework.map((h) => ({ ...h, attachments: cleanAttachments(h.attachments, studentPrefixes(h.studentId)) })),
    };
  },
};

/** Rich homework, hand-ins with feedback and a resource library for the demo. Deterministic: depends only on `now`. */
export function seedClasswork(db: DemoDB, now: Date) {
  const iso = (d: Date) => d.toISOString();
  const byDue = (studentId: string) =>
    db.homework.filter((h) => h.studentId === studentId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const h of db.homework) h.attachments ??= [];

  const bitesize: Attachment = { kind: 'link', name: 'BBC Bitesize revision guide', url: 'https://www.bbc.co.uk/bitesize' };
  const worksheet = (studentId: string): Attachment => ({
    kind: 'file',
    name: 'worksheet.pdf',
    path: `students/${studentId}/worksheet.pdf`,
    mimeType: 'application/pdf',
  });

  const omar = byDue('s-omar');
  const layla = byDue('s-layla');

  // Omar: his most recent piece is still to do and due later this week.
  const omarCurrent = omar.at(-1);
  if (omarCurrent) {
    omarCurrent.done = false;
    omarCurrent.dueDate = toDateKey(addDays(now, 3));
    omarCurrent.details =
      'Please complete questions 1 to 8 on the attached worksheet, showing every step of your working. Before you begin, review the worked examples from our lesson and the revision guide linked below.';
    omarCurrent.attachments = [worksheet('s-omar'), bitesize];
  }

  // Omar handed in an earlier piece and Craig has marked it.
  const omarEarlier = omar.at(-2);
  if (omarEarlier) {
    omarEarlier.done = true;
    omarEarlier.details = 'Attempt each question under timed conditions, allowing no more than forty minutes in total.';
    omarEarlier.attachments = [worksheet('s-omar')];
    submissionsOf(db).push({
      id: 'sub-omar-1',
      homeworkId: omarEarlier.id,
      studentId: 's-omar',
      submittedBy: 'u-student',
      submittedByName: 'Omar Al Mansoori',
      note: 'I have completed all of the questions. I found question 6 difficult and was not certain of my final answer.',
      files: [{ kind: 'file', name: 'my-answers.jpg', path: 'students/s-omar/my-answers.jpg', mimeType: 'image/jpeg' }],
      submittedAt: iso(addDays(now, -9)),
      feedback:
        'A careful and well-presented piece of work, Omar. Your method for questions 1 to 5 is entirely secure. In question 6 you omitted the constant of integration; please review this before our next lesson.',
      mark: '7/10',
      feedbackAt: iso(addDays(now, -8)),
      feedbackBy: 'u-admin',
      feedbackByName: "Craig O'Brien",
    });
  }

  // Layla handed in her latest piece and it awaits Sarah's feedback.
  const laylaLatest = layla.at(-1);
  if (laylaLatest) {
    laylaLatest.done = true;
    laylaLatest.details =
      'Complete the attached exercise set and check your answers against the mark scheme. Note any questions you would like to discuss in our next lesson.';
    laylaLatest.attachments = [worksheet('s-layla'), { kind: 'link', name: 'Past papers', url: 'https://www.physicsandmathstutor.com' }];
    submissionsOf(db).push({
      id: 'sub-layla-1',
      homeworkId: laylaLatest.id,
      studentId: 's-layla',
      submittedBy: 'u-parent',
      submittedByName: 'Fatima Al Mansoori',
      note: 'Layla has finished the exercise set. She would welcome some guidance on the final two questions.',
      files: [{ kind: 'file', name: 'layla-exercise-set.pdf', path: 'students/s-layla/layla-exercise-set.pdf', mimeType: 'application/pdf' }],
      submittedAt: iso(addDays(now, -1)),
    });
  }
  const laylaEarlier = layla.at(-2);
  if (laylaEarlier) {
    laylaEarlier.details = 'Read through the revision guide and summarise the key methods on a single page.';
    laylaEarlier.attachments = [bitesize];
  }

  const craig = { uploadedBy: 'u-admin', uploadedByName: "Craig O'Brien" };
  const sarah = { uploadedBy: 'u-tutor', uploadedByName: 'Sarah Khan' };
  const resources: Resource[] = [
    {
      id: 'res-1', title: 'Calculus revision booklet', description: 'Differentiation and integration practice with fully worked solutions.',
      subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', kind: 'file', path: 'resources/calculus-revision-booklet.pdf',
      fileName: 'calculus-revision-booklet.pdf', mimeType: 'application/pdf', tags: ['calculus', 'revision', 'past papers'],
      ...craig, visibility: 'students', studentIds: ['s-omar'], createdAt: iso(addDays(now, -20)),
    },
    {
      id: 'res-2', title: 'IGCSE Maths past papers', description: 'Past examination papers and mark schemes, arranged by year.',
      subject: 'Maths', curriculum: 'IGCSE', kind: 'link', url: 'https://www.physicsandmathstutor.com',
      tags: ['past papers', 'exam practice'], ...sarah, visibility: 'tutors', studentIds: [], createdAt: iso(addDays(now, -18)),
    },
    {
      id: 'res-3', title: 'Essay structure guide', description: 'A clear framework for analytical essays, with annotated model paragraphs.',
      subject: 'English Literature', curriculum: 'A-Level', kind: 'file', path: 'resources/essay-structure-guide.pdf',
      fileName: 'essay-structure-guide.pdf', mimeType: 'application/pdf', tags: ['essays', 'writing'],
      ...craig, visibility: 'tutors', studentIds: [], createdAt: iso(addDays(now, -15)),
    },
    {
      id: 'res-4', title: 'Organic chemistry reaction map', description: 'A single-page summary of the principal organic reaction pathways.',
      subject: 'Chemistry', curriculum: 'IB DP', level: 'HL', kind: 'file', path: 'resources/organic-reaction-map.png',
      fileName: 'organic-reaction-map.png', mimeType: 'image/png', tags: ['organic', 'revision'],
      ...craig, visibility: 'tutors', studentIds: [], createdAt: iso(addDays(now, -12)),
    },
    {
      id: 'res-5', title: 'Chemistry revision notes', description: 'Concise revision notes covering the full specification.',
      subject: 'Chemistry', curriculum: 'IGCSE', kind: 'link', url: 'https://www.bbc.co.uk/bitesize/subjects/z8xtmnb',
      tags: ['revision', 'notes'], ...sarah, visibility: 'tutors', studentIds: [], createdAt: iso(addDays(now, -9)),
    },
    {
      id: 'res-6', title: 'Arabic reading comprehension pack', description: 'Graded reading passages with comprehension questions.',
      subject: 'Arabic', curriculum: 'IB DP', level: 'HL', kind: 'file', path: 'resources/arabic-reading-pack.pdf',
      fileName: 'arabic-reading-pack.pdf', mimeType: 'application/pdf', tags: ['reading', 'comprehension', 'vocabulary'],
      ...sarah, visibility: 'tutors', studentIds: [], createdAt: iso(addDays(now, -5)),
    },
  ];
  resourcesOf(db).push(...resources);
}
