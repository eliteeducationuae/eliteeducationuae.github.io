/**
 * The audit trail: who changed what, and when. Shared by the Supabase audit triggers (which store the rows),
 * the demo (which records the same rows in memory) and the History screens (which describe them in words).
 *
 * Rows are stored with snake_case database column keys, exactly as `public.audit_events` holds them.
 */

import { formatAED } from './billing';
import { formatDate, formatDay, formatTime } from './dates';

export type AuditAction = 'insert' | 'update' | 'delete' | 'rpc';

export interface AuditEvent {
  id: string;
  /** ISO date-time. */
  at: string;
  actorId: string | null;
  actorName: string | null;
  /** 'admin' | 'tutor' | 'parent' | 'student' | 'system' */
  actorRole: string | null;
  /** Set when an admin acted while viewing as someone else. */
  actingAsId: string | null;
  action: AuditAction;
  table: string;
  rowId: string | null;
  familyIds: string[];
  studentIds: string[];
  tutorId: string | null;
  /** Other records this change belongs to, e.g. the lesson for its notes or the invoice for a payment. */
  relatedIds: string[];
  /** snake_case database column keys. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /**
   * Labels saved with the event so it can say which record it is about: `lesson_start`, `subject`,
   * `invoice_number`. Null for events without any (and for events recorded before context was added).
   */
  context?: Record<string, unknown> | null;
}

export interface AuditFilter {
  /** A record: matches its own events and those of records related to it. */
  entityId?: string;
  familyId?: string;
  studentId?: string;
  tutorId?: string;
  actorId?: string;
  /** 'admin' | 'tutor' | 'parent' | 'student' | 'system' */
  actorRole?: string;
  tables?: string[];
  /** ISO, inclusive. */
  from?: string;
  /** ISO, exclusive. */
  to?: string;
}

export interface AuditCursor {
  at: string;
  id: string;
}

export interface AuditPage {
  events: AuditEvent[];
  next: AuditCursor | null;
}

export interface AuditActor {
  id: string;
  name: string;
  role: string;
}

export interface AuditNames {
  tutor(id: string): string | undefined;
  student(id: string): string | undefined;
  family(id: string): string | undefined;
  service(id: string): string | undefined;
  /** How to name whoever made the change; defaults to their first name (see actorLabeller). */
  actorLabel?(e: AuditEvent): string;
}

export interface AuditDescription {
  summary: string;
  /** Which record the event is about, e.g. 'Omar · Chemistry · Thu 8 Oct', when the summary doesn't say. */
  context?: string;
  changes: string[];
}

export const REDACTED = '[redacted]';
/** Personal values blanked by public.audit_erase() after an account is deleted. */
export const ERASED = '[erased]';

/** The record types the History filter offers, each covering one or more tables. */
export const AUDIT_TYPE_GROUPS: readonly { key: string; label: string; tables: string[] }[] = [
  { key: 'lessons', label: 'Lessons', tables: ['lessons', 'lesson_notes'] },
  { key: 'billing', label: 'Invoices and payments', tables: ['invoices', 'payments', 'charges', 'packages'] },
  { key: 'pay', label: 'Tutor pay', tables: ['tutor_invoices'] },
  { key: 'people', label: 'Families and students', tables: ['families', 'students', 'enrolments'] },
  { key: 'tutors', label: 'Tutors and roles', tables: ['tutors', 'opportunities'] },
  { key: 'homework', label: 'Homework', tables: ['homework'] },
  { key: 'reports', label: 'Reports', tables: ['student_reports'] },
  { key: 'settings', label: 'Settings and services', tables: ['settings', 'services'] },
];

/**
 * Per-table recording rules, mirroring the SQL in 20261104000000_audit.sql:
 * - `ignore`: housekeeping columns that never make or appear in an event.
 * - `only`: the only columns stored.
 * - `when`: only updates that change one of these columns are events (and no inserts or deletes are recorded).
 * - `keep`: stored on both sides of every recorded update, changed or not, so the event can be described.
 * - `afterOnly`: stored only on the "after" side, when changed.
 */
export const AUDIT_RULES: Record<
  string,
  { ignore?: string[]; only?: string[]; when?: string[]; keep?: string[]; afterOnly?: string[]; deleteKeeps?: string[] }
> = {
  lessons: { ignore: ['reminded_at', 'whatsapp_reminded_at'] },
  invoices: { ignore: ['overdue_whatsapp_at', 'autopay_claimed_at', 'autopay_attempts', 'autopay_status', 'autopay_error'] },
  homework: { ignore: ['due_whatsapp_at'] },
  settings: { ignore: ['next_invoice_number'] },
  student_reports: { ignore: ['updated_at'], only: ['status', 'submitted_at', 'published_at'], when: ['status'], afterOnly: ['submitted_at', 'published_at'] },
  opportunities: { only: ['title', 'status', 'awarded_tutor_id', 'awarded_at'], when: ['awarded_tutor_id', 'status'], keep: ['title'] },
  // `deleteKeeps`: a removed person's contact details are not copied into the permanent log.
  families: { deleteKeeps: ['id', 'name'] },
  students: { deleteKeeps: ['id', 'full_name', 'family_id'] },
  tutors: { deleteKeeps: ['id', 'full_name'] },
  family_contacts: { ignore: ['updated_at'], deleteKeeps: ['id', 'name', 'family_id', 'relationship'] },
  enrolment_tutor_pay: { ignore: ['updated_at'] },
  enrolment_family_price: { ignore: ['updated_at'] },
};

const SENSITIVE = /(bank|iban|swift|account_number|token|secret|password|stripe_)/i;
/** Payment-provider ids (Stripe payment intents, charges, sessions, customers…), wherever they are stored. */
const PROVIDER_ID = /^(pi|ch|cs|py|pm|cus|seti|sub|in|acct|re|src|tok|card)_[A-Za-z0-9][A-Za-z0-9_]*$/;

/** Hide sensitive values: by column (bank details, tokens, Stripe columns) or by value (provider ids). Empty values stay empty. */
export function redactAuditRow(_table: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const hidden = v !== null && v !== undefined && (SENSITIVE.test(k) || (typeof v === 'string' && PROVIDER_ID.test(v)));
    out[k] = hidden ? REDACTED : v;
  }
  return out;
}

/** JSON with sorted object keys, so equal values compare equal whatever their key order. */
function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

function project(row: Record<string, unknown>, keys: (k: string) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (keys(k) && v !== undefined) out[k] = v;
  return out;
}

/**
 * What an insert, update or delete stores in the audit trail, or null when it isn't an event.
 * Updates keep only the columns that changed; sensitive values are redacted but the change is still recorded.
 */
export function diffAuditRows(
  table: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } | null {
  const rule = AUDIT_RULES[table] ?? {};
  const ignored = new Set(rule.ignore ?? []);
  const only = rule.only ? new Set(rule.only) : null;
  const stored = (k: string) => !ignored.has(k) && (!only || only.has(k));
  if (!before && !after) return null;
  if (!before || !after) {
    if (rule.when) return null;
    const row = before ?? after!;
    const keeps = before && rule.deleteKeeps ? new Set(rule.deleteKeeps) : null;
    const kept = redactAuditRow(table, project(row, (k) => stored(k) && (!keeps || keeps.has(k))));
    return before ? { before: kept, after: null } : { before: null, after: kept };
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((k) => !ignored.has(k) && stable(before[k]) !== stable(after[k]));
  if (rule.when && !changed.some((k) => rule.when!.includes(k))) return null;
  const kept = changed.filter((k) => !only || only.has(k));
  if (kept.length === 0) return null;
  const keep = new Set([...kept, ...(rule.keep ?? [])]);
  const afterOnly = new Set(rule.afterOnly ?? []);
  return {
    before: redactAuditRow(table, project(before, (k) => keep.has(k) && !afterOnly.has(k))),
    after: redactAuditRow(table, project(after, (k) => keep.has(k))),
  };
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Map a `list_audit_events` row (snake_case) to an AuditEvent. */
export function auditEventFromRow(r: Record<string, any>): AuditEvent {
  return {
    id: String(r.id),
    at: String(r.at),
    actorId: strOrNull(r.actor_id),
    actorName: strOrNull(r.actor_name),
    actorRole: strOrNull(r.actor_role),
    actingAsId: strOrNull(r.acting_as ?? r.acting_as_id),
    action: r.action as AuditAction,
    table: String(r.table_name ?? r.table),
    rowId: strOrNull(r.row_id),
    familyIds: arr(r.family_ids),
    studentIds: arr(r.student_ids),
    tutorId: strOrNull(r.tutor_id),
    relatedIds: arr(r.related_ids),
    before: obj(r.before),
    after: obj(r.after),
    context: obj(r.context),
  };
}

// ---------------------------------------------------------------------------
// Describing events in plain English
// ---------------------------------------------------------------------------

/** First name of whoever made the change, 'The system' for automatic changes, or 'A former user' once erased. */
export function auditActorLabel(e: AuditEvent): string {
  const first = e.actorName?.trim().split(/\s+/)[0];
  if (first) return first;
  return e.actorId ? 'A former user' : 'The system';
}

/**
 * Names actors by first name, adding the surname initial when two people in `actors` share a first name
 * (two tutors called Sarah become 'Sarah K.' and 'Sarah M.').
 */
export function actorLabeller(actors: readonly { id: string; name: string }[]): (e: AuditEvent) => string {
  const parts = (name: string) => name.trim().split(/\s+/).filter(Boolean);
  const ids = new Map<string, Set<string>>();
  for (const a of actors) {
    const first = parts(a.name)[0]?.toLowerCase();
    if (first) ids.set(first, (ids.get(first) ?? new Set()).add(a.id));
  }
  return (e) => {
    const p = parts(e.actorName ?? '');
    if (p.length === 0) return auditActorLabel(e);
    const others = ids.get(p[0].toLowerCase());
    const shared = !!others && [...others].some((id) => id !== e.actorId);
    return shared && p.length > 1 ? `${p[0]} ${p[p.length - 1].charAt(0).toUpperCase()}.` : p[0];
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** `YYYY-MM-DD` as a local date, so it never shifts a day in other time zones. */
function localDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const when = (iso: string) => `${formatDay(iso)} ${formatTime(iso)}`;
const dayOf = (v: string) => formatDay(DATE_ONLY.test(v) ? localDate(v) : v);
const firstName = (full: string | undefined) => full?.trim().split(/\s+/)[0];

function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const LABELS: Record<string, string> = {
  start_at: 'Start',
  end_at: 'End',
  target_grade: 'Target grade',
  current_grade: 'Current grade',
  hourly_pay: 'Hourly pay',
  due_date: 'Due date',
  full_name: 'Name',
  parent_name: 'Parent name',
  tutor_id: 'Tutor',
  student_ids: 'Students',
  student_id: 'Student',
  family_id: 'Family',
  service_id: 'Service',
  lesson_id: 'Lesson',
  invoice_id: 'Invoice',
  package_id: 'Package',
  series_id: 'Lesson series',
  cycle_id: 'Report round',
  enrolment_id: 'Subject',
  topic_list_id: 'Topic list',
  opportunity_id: 'Role',
  enquiry_id: 'Enquiry',
  syllabus_id: 'Syllabus',
  cancel_reason: 'Cancellation reason',
  cancelled_at: 'Cancelled',
  meeting_url: 'Meeting link',
  exam_date: 'Exam date',
  exam_board: 'Exam board',
  year_group: 'Year group',
  duration_min: 'Length (minutes)',
  vat_rate: 'VAT rate',
  cancellation_hours: 'Cancellation notice (hours)',
  late_cancel_fee: 'Late cancellation fee',
  no_show_fee: 'No-show fee',
  pay_tutor_for_late_cancel: 'Pay tutors for late cancellations',
  invoice_due_days: 'Invoice due after (days)',
  bank_details: 'Bank details',
  notify_email: 'Alerts email',
  email_lesson_notes: 'Email lesson notes',
  email_invoices: 'Email invoices',
  email_messages: 'Email messages',
  booking_notice_hours: 'Booking notice (hours)',
  business_name: 'Business name',
  lessons_total: 'Lessons in package',
  lessons_used: 'Lessons used',
  expires_at: 'Expires',
  purchased_at: 'Purchased',
  details: 'Instructions',
  awarded_tutor_id: 'Awarded to',
  invited_tutor_ids: 'Invited tutors',
  pay_rate: 'Pay rate',
  closes_on: 'Closes',
  admin_comment: 'Office comment',
  payment_reference: 'Payment reference',
  paid_at: 'Paid',
  submitted_at: 'Submitted',
  approved_at: 'Approved',
  published_at: 'Published',
  awarded_at: 'Awarded',
  issue_date: 'Issue date',
  period_start: 'Period start',
  period_end: 'Period end',
  topic_ids: 'Topics',
  autopay_status: 'Automatic payment',
  autopay_error: 'Automatic payment problem',
  color: 'Calendar colour',
  next_steps: 'Next steps',
  ai_assisted: 'Drafted with assistance',
  unit_price: 'Unit price',
};

const MONEY = new Set(['hourly_pay', 'rate', 'amount', 'price', 'pay_rate', 'unit_price']);
const PERCENT = new Set(['vat_rate', 'late_cancel_fee', 'no_show_fee']);
const PEOPLE: Record<string, 'tutor' | 'student' | 'family' | 'service'> = {
  tutor_id: 'tutor',
  awarded_tutor_id: 'tutor',
  invited_tutor_ids: 'tutor',
  student_id: 'student',
  student_ids: 'student',
  family_id: 'family',
  service_id: 'service',
};
const WORDS = new Set(['status', 'method', 'location', 'visibility', 'autopay_status']);
const LONG_TEXT = 80;

const labelOf = (key: string) => LABELS[key] ?? humanise(key);

function wordValue(v: string): string {
  if (v === 'no-show') return 'No-show';
  if (v === 'late-cancel') return 'Late cancellation';
  return humanise(v.replace(/-/g, ' '));
}

/** A value in words, or undefined when it can only be described as "changed". */
function formatValue(key: string, v: unknown, names: AuditNames): string | undefined {
  if (v === null || v === undefined || v === '') return 'not set';
  const person = PEOPLE[key];
  if (person) {
    const ids = Array.isArray(v) ? arr(v) : [String(v)];
    if (ids.length === 0) return 'none';
    return joinNames(ids.map((id) => names[person](id) ?? 'someone'));
  }
  if (key.endsWith('_id') || key.endsWith('_ids')) return undefined;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    if (MONEY.has(key)) return formatAED(v);
    if (PERCENT.has(key)) return `${Math.round(v * 1000) / 10}%`;
    return String(v);
  }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string' && !UUID.test(x))) return v.length ? (v as string[]).join(', ') : 'none';
    return undefined;
  }
  if (typeof v === 'object') return undefined;
  const s = String(v);
  if (UUID.test(s)) return 'someone';
  if (MONEY.has(key) && !Number.isNaN(Number(s))) return formatAED(Number(s));
  if (DATE_ONLY.test(s)) return formatDate(localDate(s));
  if (DATE_TIME.test(s) && !Number.isNaN(new Date(s).getTime())) return when(s);
  if (WORDS.has(key)) return wordValue(s);
  return s;
}

function changeLine(key: string, before: unknown, after: unknown, names: AuditNames): string {
  const label = labelOf(key);
  const plural = /s$/.test(label) && !/ss$/.test(label);
  if (before === REDACTED || after === REDACTED) return `${label} ${plural ? 'were' : 'was'} changed (hidden for security).`;
  if (before === ERASED || after === ERASED) return `${label} ${plural ? 'were' : 'was'} changed (erased on request).`;
  const a = formatValue(key, before, names);
  const b = formatValue(key, after, names);
  if (a === undefined || b === undefined || a.length > LONG_TEXT || b.length > LONG_TEXT) {
    return `${label} ${plural ? 'were' : 'was'} changed.`;
  }
  return `${label}: ${a} → ${b}`;
}

const TABLE_NAMES: Record<string, string> = {
  lesson_notes: 'lesson notes',
  tutor_invoices: 'tutor invoices',
  student_reports: 'student reports',
};

function describeSummary(e: AuditEvent, names: AuditNames): { summary: string; omit: string[] } {
  const who = names.actorLabel ? names.actorLabel(e) : auditActorLabel(e);
  const b = e.before ?? {};
  const a = e.after ?? {};
  const row = { ...b, ...a };
  const str = (k: string): string | undefined => {
    const v = a[k] ?? b[k];
    return typeof v === 'string' && v ? v : undefined;
  };
  const changed = (k: string) => e.action === 'update' && k in a && stable(a[k]) !== stable(b[k]);
  const to = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
  const tutorName = (id: unknown) => (typeof id === 'string' ? names.tutor(id) : undefined) ?? 'someone';
  const studentFull = (id: string | undefined) => (id ? names.student(id) : undefined);
  const studentFirst = (id: string | undefined) => firstName(studentFull(id)) ?? 'a student';
  const quoted = (s: string | undefined) => (s ? ` '${s}'` : '');
  const done = (summary: string, omit: string[] = []) => ({ summary, omit });

  switch (e.table) {
    case 'lessons': {
      const start = str('start_at');
      if (e.action === 'insert') {
        const kids = arr(row.student_ids).map((id) => firstName(names.student(id)) ?? 'a student');
        const forWhom = kids.length ? ` for ${joinNames(kids)}` : '';
        return done(start ? `${who} scheduled a lesson${forWhom} on ${formatDay(start)} at ${formatTime(start)}.` : `${who} scheduled a lesson${forWhom}.`);
      }
      if (e.action === 'delete') return done(start ? `${who} deleted the lesson on ${formatDay(start)} at ${formatTime(start)}.` : `${who} deleted a lesson.`);
      if (changed('status')) {
        const s = to('status');
        const text: Record<string, string> = {
          cancelled: 'cancelled the lesson',
          'late-cancel': 'cancelled the lesson at short notice',
          completed: 'recorded the lesson as completed',
          'no-show': 'recorded the lesson as a no-show',
          scheduled: 'restored the lesson',
        };
        return done(`${who} ${text[s ?? ''] ?? 'changed the status of the lesson'}.`, ['status', 'cancelled_at']);
      }
      if (changed('start_at') && typeof b.start_at === 'string' && typeof a.start_at === 'string') {
        return done(`${who} moved the lesson from ${when(b.start_at)} to ${when(a.start_at)}.`, ['start_at', 'end_at']);
      }
      if (changed('tutor_id')) return done(`${who} reassigned the lesson from ${tutorName(b.tutor_id)} to ${tutorName(a.tutor_id)}.`, ['tutor_id']);
      return done(`${who} updated the lesson.`);
    }
    case 'lesson_notes':
      return done(`${who} ${e.action === 'insert' ? 'wrote' : e.action === 'delete' ? 'deleted' : 'updated'} the lesson notes.`);
    case 'invoices': {
      const num = str('number');
      const ref = num ? `invoice ${num}` : 'the invoice';
      if (e.action === 'insert') return done(num ? `${who} created invoice ${num}.` : `${who} created an invoice.`);
      if (e.action === 'delete') return done(`${who} deleted ${ref}.`);
      if (changed('status')) {
        const s = to('status');
        if (s === 'sent') return done(`${who} sent ${ref}.`, ['status']);
        if (s === 'paid') return done(`${who} marked ${ref} as paid.`, ['status']);
        if (s === 'void') return done(`${who} voided ${ref}.`, ['status']);
        if (s === 'draft') return done(`${who} returned ${ref} to draft.`, ['status']);
      }
      return done(`${who} updated ${ref}.`);
    }
    case 'payments': {
      const amount = typeof row.amount === 'number' ? formatAED(row.amount) : undefined;
      const method = str('method');
      const kind = method === 'card' ? 'a card payment' : method === 'bank-transfer' ? 'a bank transfer' : method === 'cash' ? 'a cash payment' : 'a payment';
      if (e.action === 'insert') return done(`${who} recorded ${kind}${amount ? ` of ${amount}` : ''}.`);
      if (e.action === 'delete') return done(`${who} removed ${kind}${amount ? ` of ${amount}` : ''}.`);
      return done(`${who} updated a payment.`);
    }
    case 'charges': {
      const amount = typeof row.amount === 'number' ? ` of ${formatAED(row.amount)}` : '';
      if (e.action === 'insert') return done(`${who} added a charge${amount}.`);
      if (e.action === 'delete') return done(`${who} removed a charge${amount}.`);
      if (changed('amount')) return done(`${who} changed the amount of a charge.`);
      return done(`${who} updated a charge.`);
    }
    case 'packages': {
      const name = quoted(str('name'));
      if (e.action === 'insert') {
        const price = typeof row.price === 'number' ? ` for ${formatAED(row.price)}` : '';
        return done(`${who} sold the package${name}${price}.`);
      }
      if (e.action === 'delete') return done(`${who} removed the package${name}.`);
      return done(name ? `${who} updated the package${name}.` : `${who} updated a package.`);
    }
    case 'tutor_invoices': {
      const tutor = e.tutorId ? names.tutor(e.tutorId) : undefined;
      const ref = tutor ? `the tutor invoice for ${tutor}` : 'a tutor invoice';
      if (e.action === 'insert') return done(`${who} created ${ref}.`);
      if (e.action === 'delete') return done(`${who} deleted ${ref}.`);
      if (changed('status')) {
        const s = to('status');
        const text: Record<string, string> = {
          submitted: `submitted ${ref}`,
          approved: `approved ${ref}`,
          rejected: `returned ${ref} for changes`,
          paid: `marked ${ref} as paid`,
          draft: `returned ${ref} to draft`,
        };
        return done(`${who} ${text[s ?? ''] ?? `updated ${ref}`}.`, ['status']);
      }
      return done(`${who} updated ${ref}.`);
    }
    case 'enrolments': {
      const student = studentFirst(str('student_id') ?? e.studentIds[0]);
      const subject = str('subject');
      const theirs = subject ? `${student}'s ${subject}` : `one of ${student}'s subjects`;
      if (e.action === 'insert') return done(subject ? `${who} enrolled ${student} in ${subject}.` : `${who} added a subject for ${student}.`);
      if (e.action === 'delete') return done(`${who} removed ${theirs}.`);
      if (changed('active')) return done(a.active ? `${who} restarted ${theirs}.` : `${who} removed ${theirs}.`, ['active']);
      if (changed('tutor_id')) return done(`${who} changed the tutor for ${theirs} from ${tutorName(b.tutor_id)} to ${tutorName(a.tutor_id)}.`, ['tutor_id']);
      return done(`${who} updated ${theirs}.`);
    }
    case 'students': {
      const name = str('full_name') ?? (e.rowId ? names.student(e.rowId) : undefined);
      if (e.action === 'insert') return done(`${who} added ${name ?? 'a student'}.`);
      if (e.action === 'delete') return done(`${who} removed ${name ?? 'a student'}.`);
      return done(`${who} updated ${name ? `${name}'s` : "a student's"} details.`);
    }
    case 'families': {
      const name = str('name') ?? (e.rowId ? names.family(e.rowId) : undefined);
      const fam = name ? `the ${name} family` : 'a family';
      if (e.action === 'insert') return done(`${who} added ${fam}.`);
      if (e.action === 'delete') return done(`${who} removed ${fam}.`);
      return done(`${who} updated ${name ? `the ${name} family's` : "a family's"} details.`);
    }
    case 'tutors': {
      const name = str('full_name') ?? (e.rowId ? names.tutor(e.rowId) : undefined);
      if (e.action === 'insert') return done(`${who} added ${name ?? 'a tutor'} as a tutor.`);
      if (e.action === 'delete') return done(`${who} removed ${name ?? 'a tutor'} as a tutor.`);
      return done(`${who} updated ${name ? `${name}'s` : "a tutor's"} details.`);
    }
    case 'services': {
      const name = str('name') ?? (e.rowId ? names.service(e.rowId) : undefined);
      const svc = name ? `the service '${name}'` : 'a service';
      if (e.action === 'insert') return done(`${who} added ${svc}.`);
      if (e.action === 'delete') return done(`${who} removed ${svc}.`);
      return done(`${who} updated ${svc}.`);
    }
    case 'settings':
      return done(`${who} changed the business settings.`);
    case 'student_reports': {
      const s = to('status');
      const text: Record<string, string> = {
        submitted: 'submitted the report',
        approved: 'approved the report',
        published: 'published the report',
        draft: 'returned the report to draft',
      };
      return done(`${who} ${text[s ?? ''] ?? 'updated the report'}.`, ['status', 'submitted_at', 'published_at']);
    }
    case 'homework': {
      const title = quoted(str('title'));
      if (e.action === 'insert') {
        const due = str('due_date');
        return done(`${who} set homework${title}${due ? ` due ${dayOf(due)}` : ''}.`);
      }
      if (e.action === 'delete') return done(`${who} removed the homework${title}.`);
      if (changed('done')) return done(`${who} marked the homework${title} as ${a.done ? 'done' : 'not done'}.`, ['done']);
      return done(`${who} updated the homework${title}.`);
    }
    case 'opportunities': {
      const title = quoted(str('title'));
      if (changed('awarded_tutor_id') && a.awarded_tutor_id) {
        return done(`${who} awarded the role${title} to ${tutorName(a.awarded_tutor_id)}.`, ['awarded_tutor_id', 'awarded_at', 'status']);
      }
      if (changed('status')) {
        const s = to('status');
        if (s === 'closed') return done(`${who} closed the role${title}.`, ['status']);
        if (s === 'open') return done(`${who} reopened the role${title}.`, ['status']);
      }
      return done(`${who} updated the role${title}.`);
    }
    default: {
      const place = TABLE_NAMES[e.table] ?? humanise(e.table).toLowerCase();
      if (e.action === 'insert') return done(`${who} added a record to ${place}.`);
      if (e.action === 'delete') return done(`${who} deleted a record from ${place}.`);
      return done(`${who} changed a record in ${place}.`);
    }
  }
}

/** Tables whose events are about one or more students' lessons or subjects. */
const STUDENT_CONTEXT = new Set(['lessons', 'lesson_notes', 'homework', 'student_reports', 'charges', 'enrolment_tutor_pay', 'enrolment_family_price']);
/** Tables whose events are about a family's account. */
const FAMILY_CONTEXT = new Set(['invoices', 'payments', 'packages', 'family_contacts']);

/**
 * Which record an event is about, for when its summary doesn't say: the students, subject and lesson day for
 * lessons, notes, homework, reports and charges ('Omar · Chemistry · Thu 8 Oct'); the family (and invoice
 * number) for invoices, payments and packages ('Al Mansoori family · INV-1001'). `omitDay` leaves the lesson day
 * out when the summary already says it.
 */
export function describeAuditContext(e: AuditEvent, names: AuditNames, omitDay = false): string | undefined {
  const c = e.context ?? {};
  const row = { ...(e.before ?? {}), ...(e.after ?? {}) };
  const text = (v: unknown) => (typeof v === 'string' && v && v !== ERASED && v !== REDACTED ? v : undefined);
  const parts: string[] = [];
  if (STUDENT_CONTEXT.has(e.table)) {
    const kids = e.studentIds.map((id) => firstName(names.student(id))).filter((n): n is string => !!n);
    if (kids.length > 3) parts.push(`${kids.slice(0, 3).join(', ')} and ${kids.length - 3} more`);
    else if (kids.length) parts.push(joinNames(kids));
  } else if (FAMILY_CONTEXT.has(e.table)) {
    const fams = e.familyIds.map((id) => names.family(id)).filter((n): n is string => !!n);
    if (fams.length) parts.push(`${joinNames(fams)} ${fams.length === 1 ? 'family' : 'families'}`);
  } else {
    return undefined;
  }
  const serviceId = e.table === 'lessons' ? text(row.service_id) : undefined;
  const subject = text(c.subject) ?? (e.table === 'lessons' ? text(row.subject) ?? (serviceId ? names.service(serviceId) : undefined) : undefined);
  if (subject) parts.push(subject);
  const start = text(c.lesson_start) ?? (e.table === 'lessons' ? text(row.start_at) : undefined);
  if (start && !omitDay && !Number.isNaN(new Date(start).getTime())) parts.push(formatDay(start));
  const invoice = e.table === 'invoices' ? undefined : text(c.invoice_number);
  if (invoice) parts.push(invoice);
  return parts.length ? parts.join(' · ') : undefined;
}

/** One event as a sentence, plus which record it is about and a line per changed field for updates. Never shows raw ids. */
export function describeAuditEvent(e: AuditEvent, names: AuditNames): AuditDescription {
  const { summary, omit } = describeSummary(e, names);
  // When the summary already names the lesson's new time ('moved the lesson from … to …'), don't repeat the day.
  const context = describeAuditContext(e, names, omit.includes('start_at'));
  if (e.action !== 'update' || !e.before || !e.after) return context ? { summary, context, changes: [] } : { summary, changes: [] };
  const b = e.before;
  const a = e.after;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changes = keys
    // Redacted values look the same on both sides, but they are only stored when they changed.
    .filter((k) => !omit.includes(k) && (stable(b[k]) !== stable(a[k]) || b[k] === REDACTED || a[k] === REDACTED))
    .map((k) => changeLine(k, b[k], a[k], names));
  return context ? { summary, context, changes } : { summary, changes };
}
