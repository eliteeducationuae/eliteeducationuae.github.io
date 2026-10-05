import {
  ADMISSIONS_ITEM_KEY,
  DOC_CATEGORY_LABELS,
  caseAccess,
  targetStatusEventTitle,
  validateAdvisoryUpdateInput,
  validateCaseInput,
  validateKeyDateInput,
  validateTargetInput,
  validateTaskInput,
  type AdmissionsAccess,
  type AdmissionsCase,
  type AdmissionsCaseInput,
  type AdmissionsDocument,
  type AdmissionsDocumentInput,
  type AdmissionsEvent,
  type AdmissionsEventKind,
  type AdmissionsFeeInput,
  type AdmissionsKeyDate,
  type AdmissionsKeyDateInput,
  type AdmissionsTarget,
  type AdmissionsTargetInput,
  type AdmissionsTask,
  type AdmissionsTaskInput,
  type AdvisoryUpdate,
  type AdvisoryUpdateInput,
  type AdvisoryUpdateStatus,
} from '@/domain/admissions';
import { newInvoiceDraft } from '@/domain/billing';
import { addDays, toDateKey } from '@/domain/dates';
import type { Invoice, InvoiceItem, Profile } from '@/domain/types';

import { AccessError, newId, requireAdmin, visibleStudentIds, type DemoDB } from './db';

// Admissions advisory in the demo. Mirrors the rules in the 20261106000000_admissions migration
// (admissions_access, save_admissions_case, set_admissions_task_done, add_admissions_document,
// set_advisory_update_status, bill_admissions_fee and the timeline triggers).

export interface AdmissionsStore {
  cases: AdmissionsCase[];
  targets: AdmissionsTarget[];
  dates: AdmissionsKeyDate[];
  tasks: AdmissionsTask[];
  documents: AdmissionsDocument[];
  updates: AdvisoryUpdate[];
  events: AdmissionsEvent[];
}

/** Seeded lazily, so demo databases saved before this feature (and resets) get the sample cases. */
function store(db: DemoDB): AdmissionsStore {
  return (db.admissions ??= seedAdmissions(db, new Date()));
}

const NOT_FOUND = 'Admissions case not found';

function accessOf(db: DemoDB, viewer: Profile, c: AdmissionsCase): AdmissionsAccess | null {
  return caseAccess(viewer, c, [...visibleStudentIds(db, viewer)]);
}

/** The case and the viewer's access to it; throws when the viewer cannot see it. */
function openCase(db: DemoDB, viewer: Profile, caseId: string): { c: AdmissionsCase; access: AdmissionsAccess } {
  const c = store(db).cases.find((x) => x.id === caseId);
  const access = c ? accessOf(db, viewer, c) : null;
  if (!c || !access) throw new Error(NOT_FOUND);
  return { c, access };
}

/** The case, when the viewer may manage it (admin or its adviser). */
function manageCase(db: DemoDB, viewer: Profile, caseId: string): AdmissionsCase {
  const { c, access } = openCase(db, viewer, caseId);
  if (access === 'family') throw new AccessError('Only the adviser or the office can change this.');
  return c;
}

function visibleCaseIds(db: DemoDB, viewer: Profile, caseId?: string): Map<string, AdmissionsAccess> {
  const out = new Map<string, AdmissionsAccess>();
  for (const c of store(db).cases) {
    if (caseId && c.id !== caseId) continue;
    const access = accessOf(db, viewer, c);
    if (access) out.set(c.id, access);
  }
  return out;
}

function touch(c: AdmissionsCase, now: Date) {
  c.updatedAt = now.toISOString();
}

function logEvent(
  db: DemoDB,
  caseId: string,
  kind: AdmissionsEventKind,
  title: string,
  now: Date,
  familyVisible = true,
  detail?: string,
) {
  const e: AdmissionsEvent = { id: newId('aev'), caseId, at: now.toISOString(), kind, title, familyVisible };
  if (detail) e.detail = detail;
  store(db).events.push(e);
}

const blank = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : undefined;
};

function fail(message: string | null) {
  if (message) throw new Error(message);
}

function checkTarget(db: DemoDB, caseId: string, targetId: string | null | undefined): string | undefined {
  if (!targetId) return undefined;
  if (!store(db).targets.some((t) => t.id === targetId && t.caseId === caseId)) {
    throw new Error('That school or university is not on this shortlist.');
  }
  return targetId;
}

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export const adm = {
  store,

  // Cases -------------------------------------------------------------------------------------

  cases(db: DemoDB, viewer: Profile, filter: { studentId?: string } = {}): AdmissionsCase[] {
    const ids = visibleCaseIds(db, viewer);
    return store(db)
      .cases.filter((c) => ids.has(c.id) && (!filter.studentId || c.studentId === filter.studentId))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  },

  getCase(db: DemoDB, viewer: Profile, id: string): AdmissionsCase | null {
    const c = store(db).cases.find((x) => x.id === id);
    return c && accessOf(db, viewer, c) ? c : null;
  },

  saveCase(db: DemoDB, viewer: Profile, input: AdmissionsCaseInput, now = new Date()): AdmissionsCase {
    fail(validateCaseInput(input));
    const s = store(db);
    const adviser = blank(input.adviserTutorId ?? undefined);
    if (adviser && !db.tutors.some((t) => t.id === adviser)) throw new Error('Please choose an adviser from the list.');

    if (!input.id) {
      requireAdmin(viewer);
      const student = db.students.find((x) => x.id === input.studentId);
      if (!student) throw new Error('Student not found');
      const c: AdmissionsCase = {
        id: newId('adm'),
        studentId: student.id,
        familyId: student.familyId,
        kind: input.kind,
        title: input.title.trim(),
        status: input.status,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (blank(input.entryYear)) c.entryYear = blank(input.entryYear);
      if (adviser) c.adviserTutorId = adviser;
      if (blank(input.summary)) c.summary = blank(input.summary);
      s.cases.push(c);
      logEvent(db, c.id, 'case', `Admissions advisory opened: ${c.title}`, now);
      return c;
    }

    const c = manageCase(db, viewer, input.id);
    // The adviser may change the summary and status only; anything else they send is ignored (as on the server).
    if (viewer.role === 'admin') {
      if (input.studentId !== c.studentId) {
        const student = db.students.find((x) => x.id === input.studentId);
        if (!student) throw new Error('Student not found');
        c.studentId = student.id;
        c.familyId = student.familyId;
      }
      c.kind = input.kind;
      c.title = input.title.trim();
      c.entryYear = blank(input.entryYear);
      c.adviserTutorId = adviser;
    }
    c.status = input.status;
    c.summary = blank(input.summary);
    touch(c, now);
    return c;
  },

  // Targets -----------------------------------------------------------------------------------

  targets(db: DemoDB, viewer: Profile, filter: { caseId?: string } = {}): AdmissionsTarget[] {
    const ids = visibleCaseIds(db, viewer, filter.caseId);
    return store(db)
      .targets.filter((t) => ids.has(t.caseId))
      .sort((a, b) => a.sort - b.sort || a.institution.localeCompare(b.institution));
  },

  saveTarget(db: DemoDB, viewer: Profile, input: AdmissionsTargetInput, now = new Date()): AdmissionsTarget {
    fail(validateTargetInput(input));
    const s = store(db);
    const existing = input.id ? s.targets.find((t) => t.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Shortlist entry not found');
    const c = manageCase(db, viewer, existing?.caseId ?? input.caseId);
    if (existing && input.caseId !== existing.caseId) throw new Error('A shortlist entry cannot move to another case.');

    const fields = {
      institution: input.institution.trim(),
      country: blank(input.country),
      programme: blank(input.programme),
      entryYear: blank(input.entryYear),
      requirements: blank(input.requirements),
      status: input.status,
      decisionDate: blank(input.decisionDate ?? undefined),
      notes: blank(input.notes),
    };
    let target: AdmissionsTarget;
    if (existing) {
      const previous = existing.status;
      Object.assign(existing, fields, { sort: input.sort ?? existing.sort, updatedAt: now.toISOString() });
      target = existing;
      if (previous !== target.status) {
        const title = targetStatusEventTitle(target.status, target.institution);
        if (title) logEvent(db, c.id, 'target', title, now);
      }
    } else {
      const siblings = s.targets.filter((t) => t.caseId === c.id);
      target = {
        id: newId('atg'),
        caseId: c.id,
        ...fields,
        sort: input.sort ?? (siblings.length ? Math.max(...siblings.map((t) => t.sort)) + 1 : 0),
        updatedAt: now.toISOString(),
      };
      s.targets.push(target);
      logEvent(db, c.id, 'target', `${target.institution} added to the shortlist`, now);
    }
    for (const key of Object.keys(target) as (keyof AdmissionsTarget)[]) {
      if (target[key] === undefined) delete target[key];
    }
    touch(c, now);
    return target;
  },

  deleteTarget(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const s = store(db);
    const target = s.targets.find((t) => t.id === id);
    if (!target) throw new Error('Shortlist entry not found');
    const c = manageCase(db, viewer, target.caseId);
    s.targets = s.targets.filter((t) => t.id !== id);
    // Dates, tasks and documents stay with the case (on delete set null).
    for (const list of [s.dates, s.tasks, s.documents]) {
      for (const item of list) if (item.targetId === id) delete item.targetId;
    }
    touch(c, now);
  },

  // Key dates ---------------------------------------------------------------------------------

  dates(db: DemoDB, viewer: Profile, filter: { caseId?: string; from?: string; to?: string } = {}): AdmissionsKeyDate[] {
    const ids = visibleCaseIds(db, viewer, filter.caseId);
    return store(db)
      .dates.filter(
        (d) => ids.has(d.caseId) && (!filter.from || d.dueOn >= filter.from) && (!filter.to || d.dueOn <= filter.to),
      )
      .sort((a, b) => (a.dueOn !== b.dueOn ? (a.dueOn < b.dueOn ? -1 : 1) : (a.time ?? '').localeCompare(b.time ?? '')));
  },

  saveKeyDate(db: DemoDB, viewer: Profile, input: AdmissionsKeyDateInput, now = new Date()): AdmissionsKeyDate {
    fail(validateKeyDateInput(input));
    const s = store(db);
    const existing = input.id ? s.dates.find((d) => d.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Key date not found');
    const c = manageCase(db, viewer, existing?.caseId ?? input.caseId);
    if (existing && input.caseId !== existing.caseId) throw new Error('A key date cannot move to another case.');
    if (input.enrolmentId && !db.enrolments.some((e) => e.id === input.enrolmentId && e.studentId === c.studentId)) {
      throw new Error('That course is not one of this student’s subjects.');
    }
    if (input.lessonId && !db.lessons.some((l) => l.id === input.lessonId && l.studentIds.includes(c.studentId))) {
      throw new Error('That lesson is not one of this student’s lessons.');
    }
    const lesson = input.lessonId ? db.lessons.find((l) => l.id === input.lessonId) : undefined;
    const course = input.enrolmentId ? db.enrolments.find((e) => e.id === input.enrolmentId) : undefined;
    if (lesson?.subject && course && lesson.subject.trim().toLowerCase() !== course.subject.trim().toLowerCase()) {
      throw new Error('Please choose a lesson in the selected subject.');
    }
    const next: AdmissionsKeyDate = {
      id: existing?.id ?? newId('adt'),
      caseId: c.id,
      kind: input.kind,
      title: input.title.trim(),
      dueOn: input.dueOn,
      done: input.done ?? existing?.done ?? false,
    };
    const targetId = checkTarget(db, c.id, input.targetId);
    if (targetId) next.targetId = targetId;
    if (blank(input.time ?? undefined)) next.time = blank(input.time ?? undefined);
    if (input.enrolmentId) next.enrolmentId = input.enrolmentId;
    if (input.lessonId) next.lessonId = input.lessonId;
    if (blank(input.notes)) next.notes = blank(input.notes);

    if (existing) {
      const wasDone = existing.done;
      for (const key of Object.keys(existing)) delete (existing as unknown as Record<string, unknown>)[key];
      Object.assign(existing, next);
      if (!wasDone && next.done) logEvent(db, c.id, 'date', `Completed: ${next.title}`, now);
      touch(c, now);
      return existing;
    }
    s.dates.push(next);
    touch(c, now);
    return next;
  },

  deleteKeyDate(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const s = store(db);
    const date = s.dates.find((d) => d.id === id);
    if (!date) throw new Error('Key date not found');
    const c = manageCase(db, viewer, date.caseId);
    s.dates = s.dates.filter((d) => d.id !== id);
    touch(c, now);
  },

  // Tasks -------------------------------------------------------------------------------------

  tasks(db: DemoDB, viewer: Profile, filter: { caseId?: string } = {}): AdmissionsTask[] {
    const ids = visibleCaseIds(db, viewer, filter.caseId);
    return store(db)
      .tasks.filter((t) => ids.has(t.caseId))
      .sort((a, b) => {
        if (a.dueOn !== b.dueOn) {
          if (!a.dueOn) return 1;
          if (!b.dueOn) return -1;
          return a.dueOn < b.dueOn ? -1 : 1;
        }
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      });
  },

  saveTask(db: DemoDB, viewer: Profile, input: AdmissionsTaskInput, now = new Date()): AdmissionsTask {
    fail(validateTaskInput(input));
    const s = store(db);
    const existing = input.id ? s.tasks.find((t) => t.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Task not found');
    const c = manageCase(db, viewer, existing?.caseId ?? input.caseId);
    if (existing && input.caseId !== existing.caseId) throw new Error('A task cannot move to another case.');
    const targetId = checkTarget(db, c.id, input.targetId);
    const task: AdmissionsTask = existing ?? {
      id: newId('atk'),
      caseId: c.id,
      title: '',
      owner: input.owner,
      createdAt: now.toISOString(),
    };
    task.title = input.title.trim();
    task.owner = input.owner;
    task.details = blank(input.details);
    task.dueOn = blank(input.dueOn ?? undefined);
    task.targetId = targetId;
    for (const key of ['details', 'dueOn', 'targetId'] as const) if (task[key] === undefined) delete task[key];
    if (!existing) s.tasks.push(task);
    touch(c, now);
    return task;
  },

  setTaskDone(db: DemoDB, viewer: Profile, id: string, done: boolean, now = new Date()) {
    const task = store(db).tasks.find((t) => t.id === id);
    if (!task) throw new Error('Task not found');
    const { c, access } = openCase(db, viewer, task.caseId);
    if (access === 'family' && task.owner !== 'family') {
      throw new AccessError('Only the adviser can complete this task.');
    }
    if (done && !task.doneAt) {
      task.doneAt = now.toISOString();
      task.doneByName = viewer.fullName;
      logEvent(db, c.id, 'task', `Completed: ${task.title}`, now);
    } else if (!done) {
      delete task.doneAt;
      delete task.doneByName;
    }
    touch(c, now);
  },

  deleteTask(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const s = store(db);
    const task = s.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Task not found');
    const c = manageCase(db, viewer, task.caseId);
    s.tasks = s.tasks.filter((t) => t.id !== id);
    touch(c, now);
  },

  // Documents ---------------------------------------------------------------------------------

  documents(db: DemoDB, viewer: Profile, filter: { caseId?: string } = {}): AdmissionsDocument[] {
    const ids = visibleCaseIds(db, viewer, filter.caseId);
    return store(db)
      .documents.filter((doc) => {
        const access = ids.get(doc.caseId);
        if (!access) return false;
        return access !== 'family' || doc.familyVisible || doc.uploadedBy === viewer.id;
      })
      .sort(byNewest);
  },

  addDocument(db: DemoDB, viewer: Profile, input: AdmissionsDocumentInput, now = new Date()): AdmissionsDocument {
    const { c, access } = openCase(db, viewer, input.caseId);
    const name = input.name?.trim();
    if (!name) throw new Error('Please give the document a name.');
    if (name.length > 200) throw new Error('Please keep the document name to 200 characters or fewer.');
    if (!(input.category in DOC_CATEGORY_LABELS)) throw new Error('Please choose a category.');
    const folder = `cases/${c.id}/`;
    if (!input.path || !input.path.startsWith(folder) || input.path.length <= folder.length || input.path.includes('..') || input.path.length > 500) {
      throw new Error('The file could not be accepted. Please try uploading it again.');
    }
    // One document per stored file, so a document's visibility can never be widened by listing its file again.
    if (store(db).documents.some((x) => x.path === input.path)) {
      throw new Error('The file could not be accepted. Please try uploading it again.');
    }
    const doc: AdmissionsDocument = {
      id: newId('adc'),
      caseId: c.id,
      category: input.category,
      name,
      path: input.path,
      familyVisible: access === 'family' ? true : input.familyVisible ?? true,
      uploadedBy: viewer.id,
      uploadedByName: viewer.fullName,
      createdAt: now.toISOString(),
    };
    const targetId = checkTarget(db, c.id, input.targetId);
    if (targetId) doc.targetId = targetId;
    if (input.mimeType) doc.mimeType = input.mimeType;
    store(db).documents.push(doc);
    logEvent(db, c.id, 'document', `Document added: ${name}`, now, doc.familyVisible);
    touch(c, now);
    return doc;
  },

  /** Returns the stored path so the caller can remove the file. */
  deleteDocument(db: DemoDB, viewer: Profile, id: string, now = new Date()): string | null {
    const s = store(db);
    const doc = s.documents.find((x) => x.id === id);
    if (!doc) throw new Error('Document not found');
    const { c, access } = openCase(db, viewer, doc.caseId);
    if (access === 'family') {
      if (!doc.familyVisible && doc.uploadedBy !== viewer.id) throw new Error('Document not found');
      if (doc.uploadedBy !== viewer.id) throw new AccessError('Only the person who added this document, or the adviser, can delete it.');
    }
    s.documents = s.documents.filter((x) => x.id !== id);
    touch(c, now);
    // Keep the file while another document still refers to it.
    return doc.path && !s.documents.some((x) => x.path === doc.path) ? doc.path : null;
  },

  // Advisory updates --------------------------------------------------------------------------

  updates(db: DemoDB, viewer: Profile, filter: { caseId?: string } = {}): AdvisoryUpdate[] {
    const ids = visibleCaseIds(db, viewer, filter.caseId);
    return store(db)
      .updates.filter((u) => {
        const access = ids.get(u.caseId);
        return !!access && (access !== 'family' || u.status === 'published');
      })
      .sort(byNewest);
  },

  saveUpdate(db: DemoDB, viewer: Profile, input: AdvisoryUpdateInput, now = new Date()): AdvisoryUpdate {
    fail(validateAdvisoryUpdateInput(input));
    const s = store(db);
    const existing = input.id ? s.updates.find((u) => u.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Update not found');
    const c = manageCase(db, viewer, existing?.caseId ?? input.caseId);
    if (existing && input.caseId !== existing.caseId) throw new Error('An update cannot move to another case.');
    if (existing?.status === 'published') throw new Error('A published update cannot be changed.');
    if (existing?.status === 'approved' && viewer.role !== 'admin') {
      throw new AccessError('This update has been approved. Please ask the office to make any further changes.');
    }
    const update: AdvisoryUpdate = existing ?? {
      id: newId('aup'),
      caseId: c.id,
      kind: input.kind,
      title: '',
      body: '',
      status: 'draft',
      aiAssisted: false,
      authorName: viewer.fullName,
      createdAt: now.toISOString(),
    };
    update.kind = input.kind;
    update.title = input.title.trim();
    update.period = blank(input.period);
    if (update.period === undefined) delete update.period;
    update.body = input.body.trim();
    update.aiAssisted = update.aiAssisted || !!input.aiAssisted;
    if (!existing) s.updates.push(update);
    touch(c, now);
    return update;
  },

  setUpdateStatus(db: DemoDB, viewer: Profile, id: string, status: AdvisoryUpdateStatus, now = new Date()) {
    const update = store(db).updates.find((u) => u.id === id);
    if (!update) throw new Error('Update not found');
    const c = manageCase(db, viewer, update.caseId);
    if (update.status === status) return;
    if (update.status === 'published') throw new Error('A published update cannot be withdrawn.');
    if (viewer.role !== 'admin') {
      const allowed = (update.status === 'draft' && status === 'submitted') || (update.status === 'submitted' && status === 'draft');
      if (!allowed) throw new AccessError('Only the office can approve or publish advisory updates.');
    }
    if (status === 'published' && !update.body.trim()) throw new Error('Please write the update before publishing it.');
    update.status = status;
    const at = now.toISOString();
    if (status === 'submitted') update.submittedAt = at;
    if (status === 'approved') update.approvedAt = at;
    if (status === 'published') {
      update.publishedAt = at;
      logEvent(db, c.id, 'update', `Advisory update: ${update.title}`, now);
    }
    touch(c, now);
  },

  deleteUpdate(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    const s = store(db);
    const update = s.updates.find((u) => u.id === id);
    if (!update) throw new Error('Update not found');
    const c = manageCase(db, viewer, update.caseId);
    if (update.status === 'published') throw new Error('A published update cannot be deleted.');
    s.updates = s.updates.filter((u) => u.id !== id);
    touch(c, now);
  },

  // Timeline ----------------------------------------------------------------------------------

  events(db: DemoDB, viewer: Profile, filter: { caseId?: string } = {}): AdmissionsEvent[] {
    const ids = visibleCaseIds(db, viewer, filter.caseId);
    return store(db)
      .events.filter((e) => {
        const access = ids.get(e.caseId);
        return !!access && (access !== 'family' || e.familyVisible);
      })
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  },

  addMilestone(db: DemoDB, viewer: Profile, caseId: string, title: string, detail?: string, now = new Date()) {
    const c = manageCase(db, viewer, caseId);
    const t = title?.trim();
    if (!t) throw new Error('Please enter the milestone.');
    if (t.length > 200) throw new Error('Please keep the milestone to 200 characters or fewer.');
    logEvent(db, c.id, 'milestone', t, now, true, blank(detail));
    touch(c, now);
  },

  // Fees --------------------------------------------------------------------------------------

  /** Admin: a sent invoice for advisory fees, numbered and taxed like every other invoice. */
  billFee(db: DemoDB, viewer: Profile, input: AdmissionsFeeInput, now = new Date()): Invoice {
    requireAdmin(viewer);
    const c = store(db).cases.find((x) => x.id === input.caseId);
    if (!c) throw new Error(NOT_FOUND);
    const description = input.description?.trim();
    if (!description) throw new Error('Please describe the fee.');
    if (description.length > 200) throw new Error('Please keep the description to 200 characters or fewer.');
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Please enter a quantity greater than zero.');
    if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) throw new Error('Please enter a price of zero or more.');
    const item = { description, quantity: input.quantity, unitPrice: input.unitPrice, [ADMISSIONS_ITEM_KEY]: c.id } as InvoiceItem;
    const invoice: Invoice = { ...newInvoiceDraft(c.familyId, [item], db.settings, now), id: newId('inv'), status: 'sent' };
    db.settings.nextInvoiceNumber += 1;
    db.invoices.push(invoice);
    return invoice;
  },
};

// ---------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------

/** Sample cases for the Al Mansoori family, dated relative to `now`. */
export function seedAdmissions(db: Pick<DemoDB, 'enrolments'>, now: Date): AdmissionsStore {
  const day = (n: number) => toDateKey(addDays(now, n));
  const at = (n: number, hour = 10) => {
    const d = addDays(now, n);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthName = (d: Date) => `${d.toLocaleString('en-GB', { month: 'long' })} ${d.getFullYear()}`;
  const omarMaths = db.enrolments.find((e) => e.studentId === 's-omar' && e.subject === 'Maths')?.id ?? 'enr-omar-maths';

  const ucas = 'adm-omar-ucas';
  const boarding = 'adm-layla-boarding';

  const cases: AdmissionsCase[] = [
    {
      id: ucas,
      studentId: 's-omar',
      familyId: 'f-mansoori',
      kind: 'uk-university',
      title: 'UK universities — 2028 entry (UCAS)',
      entryYear: '2028',
      status: 'active',
      adviserTutorId: 't-sarah',
      summary:
        'Omar is aiming for Economics and Philosophy, Politics and Economics courses at leading UK universities. ' +
        'Our focus this year is on building a strong personal statement and a well-rounded super-curricular profile.',
      createdAt: at(-60),
      updatedAt: at(-1),
    },
    {
      id: boarding,
      studentId: 's-layla',
      familyId: 'f-mansoori',
      kind: 'boarding',
      title: 'UK boarding schools — Sixth Form entry 2027',
      entryYear: 'September 2027',
      status: 'active',
      summary:
        'Layla is applying for Sixth Form places at a small number of leading UK boarding schools. ' +
        'The office is coordinating registrations, entrance assessments and interview preparation.',
      createdAt: at(-90),
      updatedAt: at(-2),
    },
  ];

  const target = (id: string, caseId: string, sort: number, institution: string, status: AdmissionsTarget['status'], extra: Partial<AdmissionsTarget> = {}): AdmissionsTarget => ({
    id,
    caseId,
    institution,
    country: 'United Kingdom',
    status,
    sort,
    updatedAt: at(-30),
    ...extra,
  });

  const targets: AdmissionsTarget[] = [
    target('atg-oxford', ucas, 0, 'University of Oxford', 'researching', {
      programme: 'Philosophy, Politics and Economics (PPE)',
      entryYear: '2028',
      requirements: 'IB 39 points with 7, 6, 6 at Higher Level; admissions test and interview.',
    }),
    target('atg-lse', ucas, 1, 'London School of Economics', 'researching', {
      programme: 'BSc Economics',
      entryYear: '2028',
      requirements: 'IB 38 points with 7, 6, 6 at Higher Level, including 7 in Mathematics.',
    }),
    target('atg-ucl', ucas, 2, 'University College London', 'applying', {
      programme: 'BSc Economics',
      entryYear: '2028',
      requirements: 'IB 39 points with 19 at Higher Level, including 7 in Mathematics.',
    }),
    target('atg-warwick', ucas, 3, 'University of Warwick', 'researching', { programme: 'BSc Economics', entryYear: '2028' }),
    target('atg-edinburgh', ucas, 4, 'University of Edinburgh', 'researching', { programme: 'MA Economics', entryYear: '2028' }),
    target('atg-wycombe', boarding, 0, 'Wycombe Abbey', 'submitted', { programme: 'Sixth Form (16+)', entryYear: 'September 2027' }),
    target('atg-cheltenham', boarding, 1, "Cheltenham Ladies' College", 'interview', { programme: 'Sixth Form (16+)', entryYear: 'September 2027' }),
    target('atg-benenden', boarding, 2, 'Benenden School', 'applying', { programme: 'Sixth Form (16+)', entryYear: 'September 2027' }),
    target('atg-brighton', boarding, 3, 'Brighton College', 'offer', {
      programme: 'Sixth Form (16+)',
      entryYear: 'September 2027',
      decisionDate: day(-5),
    }),
  ];

  const dates: AdmissionsKeyDate[] = [
    { id: 'adt-ps-draft', caseId: ucas, kind: 'deadline', title: 'Personal statement first draft', dueOn: day(12), done: false },
    { id: 'adt-oxford-open', caseId: ucas, targetId: 'atg-oxford', kind: 'open-day', title: 'Oxford open day', dueOn: day(25), done: false },
    { id: 'adt-tsa-reg', caseId: ucas, kind: 'deadline', title: 'Admissions test registration closes', dueOn: day(40), done: false },
    {
      id: 'adt-ucas-oxbridge',
      caseId: ucas,
      kind: 'deadline',
      title: 'UCAS application deadline (Oxford and Cambridge)',
      dueOn: `${now.getFullYear() + 1}-10-15`,
      time: '18:00',
      done: false,
    },
    {
      id: 'adt-maths-test',
      caseId: ucas,
      kind: 'test',
      title: 'Mathematics Admissions Test practice paper',
      dueOn: day(30),
      done: false,
      enrolmentId: omarMaths,
      notes: 'Prepared in Omar’s Maths lessons.',
    },
    { id: 'adt-layla-reg', caseId: boarding, targetId: 'atg-benenden', kind: 'deadline', title: 'Registration deadline', dueOn: day(3), done: false },
    { id: 'adt-layla-test', caseId: boarding, targetId: 'atg-wycombe', kind: 'test', title: 'Sixth Form entrance test', dueOn: day(9), done: false },
    {
      id: 'adt-layla-interview',
      caseId: boarding,
      targetId: 'atg-cheltenham',
      kind: 'interview',
      title: 'Sixth Form interview',
      dueOn: day(16),
      time: '10:00',
      done: false,
    },
    { id: 'adt-layla-decision', caseId: boarding, targetId: 'atg-wycombe', kind: 'decision', title: 'Offers announced', dueOn: day(70), done: false },
  ];

  const tasks: AdmissionsTask[] = [
    { id: 'atk-report', caseId: ucas, title: 'Send the latest school report to your adviser', dueOn: day(5), owner: 'family', createdAt: at(-20) },
    {
      id: 'atk-summer',
      caseId: ucas,
      title: 'Confirm summer school preferences',
      details: 'Please let us know which of the suggested summer programmes Omar would like to apply for.',
      owner: 'family',
      createdAt: at(-18),
    },
    { id: 'atk-reading', caseId: ucas, title: 'Draft the super-curricular reading list', dueOn: day(7), owner: 'adviser', createdAt: at(-15) },
    {
      id: 'atk-predicted',
      caseId: ucas,
      title: 'Share predicted grades from school',
      owner: 'family',
      createdAt: at(-30),
      doneAt: at(-10),
      doneByName: 'Fatima Al Mansoori',
    },
    { id: 'atk-flights', caseId: boarding, targetId: 'atg-cheltenham', title: 'Book flights for the interview visit', dueOn: day(6), owner: 'family', createdAt: at(-7) },
    { id: 'atk-mock', caseId: boarding, title: 'Arrange a mock interview', dueOn: day(4), owner: 'adviser', createdAt: at(-7) },
  ];

  const documents: AdmissionsDocument[] = [
    {
      id: 'adc-igcse',
      caseId: ucas,
      category: 'test-score',
      name: 'Year 11 IGCSE results.pdf',
      path: `cases/${ucas}/igcse-results.pdf`,
      mimeType: 'application/pdf',
      familyVisible: true,
      uploadedBy: 'u-parent',
      uploadedByName: 'Fatima Al Mansoori',
      createdAt: at(-40),
    },
    {
      id: 'adc-reference',
      caseId: ucas,
      category: 'reference',
      name: 'Draft reference notes.pdf',
      path: `cases/${ucas}/reference-notes.pdf`,
      mimeType: 'application/pdf',
      familyVisible: false,
      uploadedBy: 'u-tutor',
      uploadedByName: 'Sarah Khan',
      createdAt: at(-12),
    },
    {
      id: 'adc-layla-report',
      caseId: boarding,
      category: 'transcript',
      name: 'Year 10 school report.pdf',
      path: `cases/${boarding}/year-10-report.pdf`,
      mimeType: 'application/pdf',
      familyVisible: true,
      uploadedBy: 'u-admin',
      uploadedByName: "Craig O'Brien",
      createdAt: at(-45),
    },
  ];

  const thisMonth = monthName(now);
  const lastMonth = monthName(prevMonth);
  const updates: AdvisoryUpdate[] = [
    {
      id: 'aup-omar-current',
      caseId: ucas,
      kind: 'monthly',
      title: `${thisMonth} advisory update`,
      period: thisMonth,
      body:
        'Omar has made a positive start to the year. We have now confirmed a shortlist of five universities, led by Oxford for Philosophy, Politics and Economics, ' +
        'with London School of Economics, University College London, Warwick and Edinburgh for Economics. Work on the UCL application is already under way.\n\n' +
        'Over the coming weeks our priority is the first draft of the personal statement, which is due shortly. Omar has identified two strong themes from his reading, ' +
        'and we will refine these together in our next session. We will also register him for the relevant admissions test before registration closes.\n\n' +
        'We would be grateful if you could send us Omar’s latest school report and confirm his summer school preferences at your earliest convenience. ' +
        'Please do not hesitate to contact us should you have any questions.',
      status: 'submitted',
      aiAssisted: false,
      authorName: 'Sarah Khan',
      createdAt: at(-1),
      submittedAt: at(-1, 12),
    },
    {
      id: 'aup-omar-last',
      caseId: ucas,
      kind: 'monthly',
      title: `${lastMonth} advisory update`,
      period: lastMonth,
      body:
        'Thank you for meeting us to discuss Omar’s university plans. We have agreed that he will apply for Economics and related courses for 2028 entry.\n\n' +
        'Omar has begun a programme of wider reading and will keep a short journal of his reflections, which will form the basis of his personal statement.\n\n' +
        'We will write again next month with a confirmed shortlist and the key dates for the year ahead.',
      status: 'published',
      aiAssisted: false,
      authorName: 'Sarah Khan',
      createdAt: at(-32),
      submittedAt: at(-31),
      approvedAt: at(-30),
      publishedAt: at(-30),
    },
    {
      id: 'aup-layla-offer',
      caseId: boarding,
      kind: 'ad-hoc',
      title: 'Offer from Brighton College',
      body:
        'We are delighted to let you know that Brighton College has offered Layla a place in its Sixth Form for September 2027.\n\n' +
        'There is no need to respond to the offer yet; we recommend waiting until the outcomes from the other schools are known. ' +
        'We will advise you on the acceptance deadline and the deposit in good time.',
      status: 'published',
      aiAssisted: false,
      authorName: "Craig O'Brien",
      createdAt: at(-5),
      approvedAt: at(-5),
      publishedAt: at(-5),
    },
  ];

  const ev = (id: string, caseId: string, n: number, kind: AdmissionsEventKind, title: string, familyVisible = true): AdmissionsEvent => ({
    id,
    caseId,
    at: at(n),
    kind,
    title,
    familyVisible,
  });
  const events: AdmissionsEvent[] = [
    ev('aev-omar-1', ucas, -60, 'case', `Admissions advisory opened: ${cases[0].title}`),
    ev('aev-omar-2', ucas, -35, 'target', 'University of Oxford added to the shortlist'),
    ev('aev-omar-3', ucas, -35, 'target', 'London School of Economics added to the shortlist'),
    ev('aev-omar-4', ucas, -34, 'target', 'University College London added to the shortlist'),
    ev('aev-omar-5', ucas, -34, 'target', 'University of Warwick added to the shortlist'),
    ev('aev-omar-6', ucas, -34, 'target', 'University of Edinburgh added to the shortlist'),
    ev('aev-omar-7', ucas, -30, 'update', `Advisory update: ${lastMonth} advisory update`),
    ev('aev-omar-8', ucas, -20, 'target', 'Application under way for University College London'),
    ev('aev-omar-9', ucas, -12, 'document', 'Document added: Draft reference notes.pdf', false),
    ev('aev-omar-10', ucas, -10, 'task', 'Completed: Share predicted grades from school'),
    ev('aev-layla-1', boarding, -90, 'case', `Admissions advisory opened: ${cases[1].title}`),
    ev('aev-layla-2', boarding, -60, 'target', 'Wycombe Abbey added to the shortlist'),
    ev('aev-layla-3', boarding, -60, 'target', "Cheltenham Ladies' College added to the shortlist"),
    ev('aev-layla-4', boarding, -60, 'target', 'Benenden School added to the shortlist'),
    ev('aev-layla-5', boarding, -60, 'target', 'Brighton College added to the shortlist'),
    ev('aev-layla-6', boarding, -40, 'target', 'Application submitted to Wycombe Abbey'),
    ev('aev-layla-7', boarding, -20, 'target', "Interview invitation from Cheltenham Ladies' College"),
    ev('aev-layla-8', boarding, -5, 'target', 'Offer received from Brighton College'),
    ev('aev-layla-9', boarding, -5, 'update', 'Advisory update: Offer from Brighton College'),
  ];

  return { cases, targets, dates, tasks, documents, updates, events };
}
