import {
  diffAuditRows,
  ERASED,
  type AuditActor,
  type AuditCursor,
  type AuditEvent,
  type AuditFilter,
  type AuditPage,
} from '@/domain/audit';
import { addDays } from '@/domain/dates';
import type { Profile } from '@/domain/types';

import { AccessError, newId, type DemoDB } from './db';

/** Database-shaped copies of the audited collections: table name → row key → snake_case row. */
export type AuditSnapshot = Map<string, Map<string, Record<string, unknown>>>;

type Row = Record<string, unknown>;

const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** camelCase demo record → snake_case database row, leaving out fields the table doesn't hold. */
function toRow(record: object, overrides: Record<string, string> = {}, drop: string[] = []): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined || drop.includes(k)) continue;
    out[overrides[k] ?? snake(k)] = v;
  }
  return out;
}

function keyed<T>(items: T[] | undefined, key: (t: T) => string, row: (t: T) => Row): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const t of items ?? []) m.set(key(t), row(t));
  return m;
}

const byId = (t: { id: string }) => t.id;

/** The audited collections, normalised to the shape `public.audit_events` records. */
export function snapshotAudited(db: DemoDB): AuditSnapshot {
  const snap: AuditSnapshot = new Map();
  snap.set('lessons', keyed(db.lessons, byId, (l) => toRow(l, { start: 'start_at', end: 'end_at' })));
  // Private notes are for tutors only and never enter the audit trail.
  snap.set('lesson_notes', keyed(db.notes, (n) => n.lessonId, (n) => toRow(n, {}, ['privateNote'])));
  snap.set('charges', keyed(db.charges, byId, (c) => toRow(c)));
  // Card and autopay live in family_billing, not on the invoice or family rows.
  snap.set('invoices', keyed(db.invoices, byId, (i) => toRow(i, {}, ['payments'])));
  snap.set('payments', keyed((db.invoices ?? []).flatMap((i) => i.payments.map((p) => ({ ...p, invoiceId: i.id }))), byId, (p) => toRow(p)));
  snap.set('packages', keyed(db.packages, byId, (p) => toRow(p)));
  snap.set('tutor_invoices', keyed(db.tutorInvoices, byId, (t) => toRow(t)));
  snap.set('enrolments', keyed(db.enrolments, byId, (e) => toRow(e)));
  // Student notes are tutor-private and are not audited.
  snap.set('students', keyed(db.students, byId, (s) => toRow(s, {}, ['notes'])));
  snap.set('families', keyed(db.families, byId, (f) => toRow(f, {}, ['autopay', 'savedCard'])));
  snap.set('tutors', keyed(db.tutors, byId, (t) => toRow(t)));
  snap.set('settings', db.settings ? new Map([['1', toRow(db.settings)]]) : new Map());
  snap.set('services', keyed(db.services, byId, (s) => toRow(s)));
  snap.set('student_reports', keyed(db.reports, byId, (r) => toRow(r)));
  snap.set('homework', keyed(db.homework, byId, (h) => toRow(h)));
  snap.set('opportunities', keyed(db.opportunities, byId, (o) => toRow(o)));
  // Round 5 tables recorded by the round 5 merge migration (contacts: by the audit migration).
  snap.set('family_contacts', keyed(db.familyContacts, byId, (c) => toRow(c, {}, ['hasLogin'])));
  snap.set('credit_notes', keyed(db.creditNotes, byId, (c) => toRow(c)));
  snap.set('refunds', keyed(db.refunds, byId, (r) => toRow(r, {}, ['requestKey'])));
  snap.set('accountant_invites', keyed(db.accountantInvites, (i) => i.email, (i) => toRow(i)));
  snap.set('tutor_documents', keyed(db.tutorDocuments, byId, (d) => toRow(d, { type: 'doc_type' })));
  snap.set('tutor_vetting_overrides', keyed(db.vettingOverrides, byId, (o) => toRow(o)));
  return structuredClone(snap);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

interface Links {
  rowId: string | null;
  familyIds: string[];
  studentIds: string[];
  tutorId: string | null;
  relatedIds: string[];
  context: Row | null;
}

/** Drop empty values; null when nothing is left (mirrors jsonb_strip_nulls + nullif in the trigger). */
function compact(ctx: Row): Row | null {
  const out: Row = {};
  for (const [k, v] of Object.entries(ctx)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** Which family, students, tutor and other records an event belongs to (mirrors the SQL trigger). */
function deriveLinks(table: string, key: string, row: Row, lookup: (table: string, key: string) => Row | undefined): Links {
  const familyOf = (studentId: string) => str(lookup('students', studentId)?.family_id);
  const forStudents = (studentIds: string[]) => ({ studentIds: uniq(studentIds), familyIds: uniq(studentIds.map(familyOf)) });
  const id = str(row.id) ?? key;
  const none: Links = { rowId: id, familyIds: [], studentIds: [], tutorId: null, relatedIds: [], context: null };
  // The labels the trigger saves with an event (public.audit_lesson_context and friends).
  const lessonLabels = (lesson: Row | undefined): Row => {
    if (!lesson) return {};
    const service = str(lesson.service_id) ? lookup('services', str(lesson.service_id)!) : undefined;
    return { lesson_start: lesson.start_at, subject: str(lesson.subject) ?? str(service?.subject) ?? str(service?.name) };
  };
  const invoiceNumber = (invoiceId: string | null) => (invoiceId ? str(lookup('invoices', invoiceId)?.number) : null);
  switch (table) {
    case 'lessons':
      return { ...none, ...forStudents(strs(row.student_ids)), tutorId: str(row.tutor_id), context: compact(lessonLabels(row)) };
    case 'lesson_notes': {
      const lessonId = str(row.lesson_id) ?? key;
      const lesson = lookup('lessons', lessonId);
      return {
        ...none,
        rowId: lessonId,
        ...forStudents(strs(lesson?.student_ids)),
        tutorId: str(lesson?.tutor_id),
        relatedIds: [lessonId],
        context: compact(lessonLabels(lesson)),
      };
    }
    case 'invoices':
    case 'packages':
      return { ...none, familyIds: uniq([str(row.family_id)]) };
    case 'payments': {
      const invoiceId = str(row.invoice_id);
      const invoice = invoiceId ? lookup('invoices', invoiceId) : undefined;
      return { ...none, familyIds: uniq([str(invoice?.family_id)]), relatedIds: uniq([invoiceId]), context: compact({ invoice_number: invoiceNumber(invoiceId) }) };
    }
    case 'charges': {
      const lessonId = str(row.lesson_id);
      return {
        ...none,
        familyIds: uniq([str(row.family_id)]),
        studentIds: uniq([str(row.student_id)]),
        tutorId: str(lessonId ? lookup('lessons', lessonId)?.tutor_id : null),
        relatedIds: uniq([lessonId, str(row.invoice_id), str(row.package_id)]),
        context: compact({ ...lessonLabels(lessonId ? lookup('lessons', lessonId) : undefined), invoice_number: invoiceNumber(str(row.invoice_id)) }),
      };
    }
    case 'tutor_invoices':
      return { ...none, tutorId: str(row.tutor_id) };
    case 'enrolments':
      return { ...none, ...forStudents(uniq([str(row.student_id)])), tutorId: str(row.tutor_id) };
    case 'students':
      return { ...none, studentIds: [id], familyIds: uniq([str(row.family_id)]) };
    case 'families':
      return { ...none, familyIds: [id] };
    case 'tutors':
      return { ...none, tutorId: id };
    case 'student_reports':
      return {
        ...none,
        ...forStudents(uniq([str(row.student_id)])),
        tutorId: str(row.tutor_id),
        relatedIds: uniq([str(row.cycle_id), str(row.enrolment_id)]),
        context: compact({ subject: (str(row.enrolment_id) ? str(lookup('enrolments', str(row.enrolment_id)!)?.subject) : null) ?? str(row.subject) }),
      };
    case 'homework':
      return {
        ...none,
        ...forStudents(uniq([str(row.student_id)])),
        tutorId: str(row.tutor_id),
        relatedIds: uniq([str(row.lesson_id)]),
        context: compact(lessonLabels(str(row.lesson_id) ? lookup('lessons', str(row.lesson_id)!) : undefined)),
      };
    case 'opportunities':
      return { ...none, ...forStudents(uniq([str(row.student_id)])), tutorId: str(row.awarded_tutor_id), relatedIds: uniq([str(row.enquiry_id)]) };
    default:
      // Tables attached by later migrations: filed under their family, student and tutor columns (as audit_row does).
      return {
        ...none,
        familyIds: uniq([str(row.family_id)]),
        studentIds: uniq([str(row.student_id)]),
        tutorId: str(row.tutor_id),
      };
  }
}

function makeEvent(
  table: string,
  key: string,
  before: Row | undefined,
  after: Row | undefined,
  actor: Profile | null,
  at: Date,
  lookup: (table: string, key: string) => Row | undefined,
): AuditEvent | null {
  const diff = diffAuditRows(table, before ?? null, after ?? null);
  if (!diff) return null;
  return {
    id: newId('aud'),
    at: at.toISOString(),
    actorId: actor?.id ?? null,
    actorName: actor?.fullName ?? null,
    actorRole: actor?.role ?? 'system',
    actingAsId: null,
    action: before && after ? 'update' : before ? 'delete' : 'insert',
    table,
    ...deriveLinks(table, key, (after ?? before)!, lookup),
    before: diff.before,
    after: diff.after,
  };
}

/**
 * Record everything a write changed since `before`, as `viewer`. Events from one write are a millisecond apart,
 * in the order the database writes them (a lesson's status before its notes), as clock_timestamp() keeps them.
 */
export function recordAuditChanges(db: DemoDB, before: AuditSnapshot, viewer: Profile, now = new Date()) {
  const current = snapshotAudited(db);
  const lookup = (table: string, key: string) => current.get(table)?.get(key) ?? before.get(table)?.get(key);
  const events: AuditEvent[] = [];
  const next = () => new Date(now.getTime() + events.length);
  for (const [table, rows] of current) {
    const old = before.get(table) ?? new Map<string, Row>();
    for (const [key, row] of rows) {
      const e = makeEvent(table, key, old.get(key), row, viewer, next(), lookup);
      if (e) events.push(e);
    }
    for (const [key, row] of old) {
      if (rows.has(key)) continue;
      const e = makeEvent(table, key, row, undefined, viewer, next(), lookup);
      if (e) events.push(e);
    }
  }
  if (events.length) (db.audit ??= []).push(...events);
}

// ---------------------------------------------------------------------------
// Erasure after an account is closed (mirrors public.audit_scrub and public.audit_erase)
// ---------------------------------------------------------------------------

const PERSONAL_KEY = /(name|email|phone|whatsapp|address|summary|notes?$|comment|details|reason|next_steps|title|pitch|description|school|birth|dob|meeting_url)/i;

/** Personal values blanked, including inside nested objects and arrays of objects (an invoice's customer, its lines). */
export function auditScrub(row: Row | null): Row | null {
  if (!row) return row;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && v !== undefined && v !== '[redacted]' && PERSONAL_KEY.test(k)) out[k] = ERASED;
    else if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? auditScrub(x as Row) : x));
    else if (v && typeof v === 'object') out[k] = auditScrub(v as Row);
    else out[k] = v;
  }
  return out;
}

/** Whose events lose their personal values (by family, student or tutor) and whose name leaves the actor column. */
export interface AuditErasure {
  familyIds?: string[];
  studentIds?: string[];
  tutorIds?: string[];
  profileIds?: string[];
}

function applyErasure(db: DemoDB, t: AuditErasure) {
  const families = new Set(t.familyIds ?? []);
  const students = new Set(t.studentIds ?? []);
  const tutors = new Set(t.tutorIds ?? []);
  const profiles = new Set(t.profileIds ?? []);
  for (const e of db.audit ?? []) {
    if (e.familyIds.some((id) => families.has(id)) || e.studentIds.some((id) => students.has(id)) || (e.tutorId && tutors.has(e.tutorId))) {
      e.before = auditScrub(e.before);
      e.after = auditScrub(e.after);
    }
    if (e.actorId && profiles.has(e.actorId)) e.actorName = null;
  }
}

/** Erasures asked for during a write wait until that write's own changes are recorded, as in one transaction. */
const pendingErasures = new WeakMap<DemoDB, AuditErasure[]>();

/** Mirrors audit_erase: run when an account is closed. Inside a write, it also covers the events that write records. */
export function eraseAudit(db: DemoDB, t: AuditErasure) {
  const pending = pendingErasures.get(db);
  if (pending) pending.push(t);
  else applyErasure(db, t);
}

/** Run a demo write, recording what it changed. Nothing is recorded if it throws. */
export function auditedWrite<T>(db: DemoDB, viewer: Profile, fn: () => T, now = new Date()): T {
  const snap = snapshotAudited(db);
  const outer = pendingErasures.get(db);
  const erasures: AuditErasure[] = [];
  if (!outer) pendingErasures.set(db, erasures);
  try {
    const result = fn();
    recordAuditChanges(db, snap, viewer, now);
    if (!outer) for (const t of erasures) applyErasure(db, t);
    return result;
  } finally {
    if (!outer) pendingErasures.delete(db);
  }
}

/** A plausible month of history for a fresh demo, built from the real seed rows. Does nothing if there is already a trail. */
export function ensureAuditSeed(db: DemoDB, now = new Date()) {
  if (db.audit) return;
  db.audit = [];
  const snap = snapshotAudited(db);
  const lookup = (table: string, key: string) => snap.get(table)?.get(key);
  const craig = db.profiles.find((p) => p.role === 'admin') ?? null;
  const sarah = db.profiles.find((p) => p.tutorId === 't-sarah') ?? db.profiles.find((p) => p.role === 'tutor') ?? null;
  const at = (daysAgo: number, hour: number, minute = 0) => {
    const d = addDays(now, -daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const add = (table: string, key: string | undefined, change: (row: Row) => { before?: Row; after?: Row }, actor: Profile | null, when: Date) => {
    const row = key ? snap.get(table)?.get(key) : undefined;
    if (!row) return;
    const { before, after } = change(structuredClone(row));
    const e = makeEvent(table, key!, before, after, actor, when, lookup);
    if (e) db.audit!.push(e);
  };
  const inserted = (row: Row) => ({ after: row });
  const updated = (patch: Row) => (row: Row) => ({ before: { ...row, ...patch }, after: row });
  const shift = (iso: unknown, days: number, hours = 0) => {
    const d = addDays(new Date(String(iso)), days);
    d.setHours(d.getHours() + hours);
    return d.toISOString();
  };

  // Lessons a few days off, so a move made three days ago still reads naturally.
  const soon = addDays(now, 3).toISOString();
  const upcoming = (studentId: string) =>
    db.lessons.filter((l) => l.status === 'scheduled' && l.start > soon && l.studentIds.includes(studentId)).sort((a, b) => a.start.localeCompare(b.start))[0];
  const omar = upcoming('s-omar');
  const layla = upcoming('s-layla');
  const arjun = upcoming('s-arjun');
  const notedBySarah = db.lessons
    .filter((l) => l.tutorId === 't-sarah' && l.status === 'completed' && db.notes.some((n) => n.lessonId === l.id))
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const mansooriInvoice = db.invoices.find((i) => i.familyId === 'f-mansoori');
  const cardPayment = db.invoices.flatMap((i) => i.payments).find((p) => p.method === 'card');
  const report = db.reports.find((r) => r.status === 'submitted');
  const homework = db.homework.filter((h) => h.tutorId === 't-sarah' || !h.tutorId).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];

  add('lessons', arjun?.id, inserted, craig, at(29, 9, 12));
  const earlier = (row: Row): Row => ({ ...row, start_at: shift(row.start_at, -1, -1), end_at: shift(row.end_at, -1, -1) });
  // Omar's lesson was booked a day earlier, then moved (below).
  add('lessons', omar?.id, (row) => ({ after: earlier(row) }), craig, at(28, 10, 5));
  add('lessons', layla?.id, inserted, craig, at(28, 10, 9));
  add('students', 's-layla', updated({ target_grade: '8' }), craig, at(24, 14, 30));
  add('families', 'f-hughes', updated({ phone: '+971 50 000 0099' }), craig, at(21, 11, 45));
  add('tutors', 't-sarah', updated({ hourly_pay: 180 }), craig, at(18, 16, 20));
  add('invoices', mansooriInvoice?.id, (row) => ({ before: { ...row, status: 'draft' }, after: { ...row, status: 'sent' } }), craig, at(14, 9, 30));
  add('payments', mansooriInvoice?.payments[0]?.id, inserted, craig, at(12, 12, 15));
  add('payments', cardPayment?.id, inserted, null, at(11, 19, 2));
  add('lesson_notes', notedBySarah?.id, inserted, sarah, at(9, 18, 40));
  add('settings', '1', updated({ bank_details: 'Previous account details' }), craig, at(7, 8, 55));
  add('homework', homework?.id, inserted, sarah, at(4, 17, 25));
  add('lessons', omar?.id, (row) => ({ before: earlier(row), after: row }), craig, at(3, 13, 10));
  // Reports are submitted by the tutor who wrote them.
  const reportTutor = db.profiles.find((p) => p.role === 'tutor' && p.tutorId === report?.tutorId) ?? sarah;
  add('student_reports', report?.id, updated({ status: 'draft', submitted_at: null }), reportTutor, at(1, 15, 0));

  // Lessons Craig and Sarah taught this month: each one recorded as completed, with its notes, shortly after it ended.
  const monthAgo = addDays(now, -27).toISOString();
  const recorders = new Map([craig, sarah].filter((p): p is Profile => !!p?.tutorId).map((p) => [p.tutorId!, p]));
  const taught = db.lessons.filter(
    (l) =>
      l.status === 'completed' &&
      l.start > monthAgo &&
      l.id !== notedBySarah?.id &&
      recorders.has(l.tutorId) &&
      db.notes.some((n) => n.lessonId === l.id),
  );
  for (const l of taught) {
    const when = new Date(new Date(l.end).getTime() + 35 * 60_000);
    if (when >= now) continue;
    const actor = recorders.get(l.tutorId)!;
    add('lessons', l.id, updated({ status: 'scheduled' }), actor, when);
    add('lesson_notes', l.id, inserted, actor, new Date(when.getTime() + 1));
  }
}

function matches(e: AuditEvent, f: AuditFilter, fromMs: number, toMs: number): boolean {
  if (f.entityId && e.rowId !== f.entityId && !e.relatedIds.includes(f.entityId)) return false;
  if (f.familyId && !e.familyIds.includes(f.familyId)) return false;
  if (f.studentId && !e.studentIds.includes(f.studentId)) return false;
  if (f.tutorId && e.tutorId !== f.tutorId) return false;
  if (f.actorId && e.actorId !== f.actorId) return false;
  if (f.actorRole && (e.actorRole ?? 'system') !== f.actorRole) return false;
  if (f.tables && f.tables.length > 0 && !f.tables.includes(e.table)) return false;
  const t = new Date(e.at).getTime();
  return t >= fromMs && t < toMs;
}

/** Newest first: by time, then id. */
const newestFirst = (a: AuditEvent, b: AuditEvent) => {
  const t = new Date(b.at).getTime() - new Date(a.at).getTime();
  return t !== 0 ? t : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/** Mirrors public.list_audit_events: admins only, filtered, newest first, a page at a time. */
export function listAuditEventsDemo(
  db: DemoDB,
  viewer: Profile,
  filter: AuditFilter = {},
  page: { before?: AuditCursor; limit?: number } = {},
): AuditPage {
  if (viewer.role !== 'admin') throw new AccessError('Admins only');
  const limit = Math.min(Math.max(Math.floor(page.limit ?? 30), 1), 200);
  const fromMs = filter.from ? new Date(filter.from).getTime() : -Infinity;
  const toMs = filter.to ? new Date(filter.to).getTime() : Infinity;
  const cursor = page.before;
  const cursorMs = cursor ? new Date(cursor.at).getTime() : 0;
  const rows = (db.audit ?? [])
    .filter((e) => matches(e, filter, fromMs, toMs))
    .filter((e) => {
      if (!cursor) return true;
      const t = new Date(e.at).getTime();
      return t < cursorMs || (t === cursorMs && e.id < cursor.id);
    })
    .sort(newestFirst);
  const events = rows.slice(0, limit);
  const last = events[events.length - 1];
  return { events, next: rows.length > limit && last ? { at: last.at, id: last.id } : null };
}

/** Mirrors public.audit_actors: everyone who appears in the trail, by name. */
export function listAuditActorsDemo(db: DemoDB, viewer: Profile): AuditActor[] {
  if (viewer.role !== 'admin') throw new AccessError('Admins only');
  const actors = new Map<string, AuditActor>();
  for (const e of db.audit ?? []) {
    if (!e.actorId) continue;
    actors.set(e.actorId, { id: e.actorId, name: e.actorName ?? 'Unknown', role: e.actorRole ?? 'unknown' });
  }
  return [...actors.values()].sort((a, b) => a.name.localeCompare(b.name));
}
