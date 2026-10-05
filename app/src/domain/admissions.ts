/**
 * Admissions advisory: school, boarding and university admissions cases run by an adviser for a family.
 * Pure helpers shared by the demo data source, the UI and (in spirit) the SQL rules in
 * supabase/migrations/20261018000000_admissions.sql.
 */
import { daysUntil, formatDate, toDateKey } from './dates';
import type { Invoice, Profile } from './types';

export type AdmissionsCaseKind = 'school-entry' | 'boarding' | 'uk-university' | 'us-university' | 'other';
export type AdmissionsCaseStatus = 'active' | 'on-hold' | 'completed' | 'closed';
export type TargetStatus =
  | 'researching'
  | 'applying'
  | 'submitted'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'accepted'
  | 'declined';
export type KeyDateKind = 'deadline' | 'test' | 'interview' | 'open-day' | 'decision' | 'other';
export type TaskOwner = 'family' | 'adviser';
export type AdmissionsDocCategory =
  | 'transcript'
  | 'reference'
  | 'personal-statement'
  | 'test-score'
  | 'portfolio'
  | 'identity'
  | 'other';
export type AdvisoryUpdateKind = 'monthly' | 'ad-hoc';
export type AdvisoryUpdateStatus = 'draft' | 'submitted' | 'approved' | 'published';
export type AdmissionsEventKind = 'case' | 'target' | 'date' | 'task' | 'document' | 'update' | 'milestone';
export type AdmissionsAccess = 'admin' | 'adviser' | 'family';

export interface AdmissionsCase {
  id: string;
  studentId: string;
  familyId: string;
  kind: AdmissionsCaseKind;
  title: string;
  entryYear?: string;
  status: AdmissionsCaseStatus;
  adviserTutorId?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionsTarget {
  id: string;
  caseId: string;
  institution: string;
  country?: string;
  programme?: string;
  entryYear?: string;
  requirements?: string;
  status: TargetStatus;
  /** YYYY-MM-DD */
  decisionDate?: string;
  notes?: string;
  sort: number;
  updatedAt: string;
}

export interface AdmissionsKeyDate {
  id: string;
  caseId: string;
  targetId?: string;
  kind: KeyDateKind;
  title: string;
  /** YYYY-MM-DD */
  dueOn: string;
  /** HH:MM, UAE time */
  time?: string;
  done: boolean;
  enrolmentId?: string;
  lessonId?: string;
  notes?: string;
}

export interface AdmissionsTask {
  id: string;
  caseId: string;
  targetId?: string;
  title: string;
  details?: string;
  dueOn?: string;
  owner: TaskOwner;
  doneAt?: string;
  doneByName?: string;
  createdAt: string;
}

export interface AdmissionsDocument {
  id: string;
  caseId: string;
  targetId?: string;
  category: AdmissionsDocCategory;
  name: string;
  path: string;
  mimeType?: string;
  familyVisible: boolean;
  uploadedBy?: string;
  uploadedByName?: string;
  createdAt: string;
}

export interface AdvisoryUpdate {
  id: string;
  caseId: string;
  kind: AdvisoryUpdateKind;
  title: string;
  period?: string;
  body: string;
  status: AdvisoryUpdateStatus;
  aiAssisted: boolean;
  authorName?: string;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  publishedAt?: string;
}

export interface AdmissionsEvent {
  id: string;
  caseId: string;
  at: string;
  kind: AdmissionsEventKind;
  title: string;
  detail?: string;
  familyVisible: boolean;
}

export interface AdmissionsCaseInput {
  id?: string;
  studentId: string;
  kind: AdmissionsCaseKind;
  title: string;
  entryYear?: string;
  status: AdmissionsCaseStatus;
  adviserTutorId?: string | null;
  summary?: string;
}

export interface AdmissionsTargetInput {
  id?: string;
  caseId: string;
  institution: string;
  country?: string;
  programme?: string;
  entryYear?: string;
  requirements?: string;
  status: TargetStatus;
  decisionDate?: string | null;
  notes?: string;
  sort?: number;
}

export interface AdmissionsKeyDateInput {
  id?: string;
  caseId: string;
  targetId?: string | null;
  kind: KeyDateKind;
  title: string;
  dueOn: string;
  time?: string | null;
  done?: boolean;
  enrolmentId?: string | null;
  lessonId?: string | null;
  notes?: string;
}

export interface AdmissionsTaskInput {
  id?: string;
  caseId: string;
  targetId?: string | null;
  title: string;
  details?: string;
  dueOn?: string | null;
  owner: TaskOwner;
}

export interface AdmissionsDocumentInput {
  caseId: string;
  targetId?: string | null;
  category: AdmissionsDocCategory;
  name: string;
  path: string;
  mimeType?: string;
  familyVisible?: boolean;
}

export interface AdvisoryUpdateInput {
  id?: string;
  caseId: string;
  kind: AdvisoryUpdateKind;
  title: string;
  period?: string;
  body: string;
  aiAssisted?: boolean;
}

export interface AdmissionsFeeInput {
  caseId: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

export const CASE_KIND_LABELS: Record<AdmissionsCaseKind, string> = {
  'school-entry': 'School entry',
  boarding: 'UK boarding school',
  'uk-university': 'UK universities (UCAS)',
  'us-university': 'US universities (Common App)',
  other: 'Other admissions',
};

export const CASE_STATUS_LABELS: Record<AdmissionsCaseStatus, string> = {
  active: 'Active',
  'on-hold': 'On hold',
  completed: 'Completed',
  closed: 'Closed',
};

export const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  researching: 'Researching',
  applying: 'Preparing application',
  submitted: 'Application submitted',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Unsuccessful',
  accepted: 'Place accepted',
  declined: 'Offer declined',
};

export const TARGET_STATUS_ORDER: readonly TargetStatus[] = [
  'researching',
  'applying',
  'submitted',
  'interview',
  'offer',
  'rejected',
  'accepted',
  'declined',
];

export const KEY_DATE_KIND_LABELS: Record<KeyDateKind, string> = {
  deadline: 'Deadline',
  test: 'Entrance test',
  interview: 'Interview',
  'open-day': 'Open day',
  decision: 'Decision',
  other: 'Key date',
};

export const DOC_CATEGORY_LABELS: Record<AdmissionsDocCategory, string> = {
  transcript: 'Transcripts and school reports',
  reference: 'References',
  'personal-statement': 'Personal statements and essays',
  'test-score': 'Test scores',
  portfolio: 'Portfolio',
  identity: 'Passport and identity',
  other: 'Other documents',
};

export const UPDATE_STATUS_LABELS: Record<AdvisoryUpdateStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  published: 'Sent to family',
};

export const UPDATE_KIND_LABELS: Record<AdvisoryUpdateKind, string> = {
  monthly: 'Monthly update',
  'ad-hoc': 'Update',
};

// ---------------------------------------------------------------------------------------------
// Reminders (must match the SQL rule in the admissions migration)
// ---------------------------------------------------------------------------------------------

export const REMINDER_DAYS = [14, 7, 1, 0] as const;
export const TASK_REMINDER_DAYS = [3, 0] as const;

/**
 * The reminder threshold due now: the smallest threshold at or above `daysLeft`.
 * Null when the date has passed, is further off than every threshold, or that reminder was already sent.
 */
export function reminderDue(
  daysLeft: number,
  sent: readonly number[],
  thresholds: readonly number[] = REMINDER_DAYS,
): number | null {
  if (daysLeft < 0) return null;
  const eligible = thresholds.filter((t) => t >= daysLeft);
  if (eligible.length === 0) return null;
  const due = Math.min(...eligible);
  return sent.includes(due) ? null : due;
}

/** Every threshold at or above `daysLeft`: what is recorded as sent once a reminder goes out. */
export function remindersCovered(daysLeft: number, thresholds: readonly number[] = REMINDER_DAYS): number[] {
  return thresholds.filter((t) => t >= daysLeft);
}

// ---------------------------------------------------------------------------------------------
// Key dates and tasks
// ---------------------------------------------------------------------------------------------

export type KeyDateUrgency = 'done' | 'overdue' | 'today' | 'this-week' | 'this-month' | 'later';
export type UrgencyTone = 'neutral' | 'success' | 'warning' | 'danger' | 'gold';

export function keyDateUrgency(d: Pick<AdmissionsKeyDate, 'dueOn' | 'done'>, now: Date): KeyDateUrgency {
  if (d.done) return 'done';
  const days = daysUntil(d.dueOn, now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'this-week';
  if (days <= 31) return 'this-month';
  return 'later';
}

export function urgencyTone(u: KeyDateUrgency): UrgencyTone {
  switch (u) {
    case 'done':
      return 'success';
    case 'overdue':
      return 'danger';
    case 'today':
    case 'this-week':
      return 'warning';
    case 'this-month':
      return 'gold';
    default:
      return 'neutral';
  }
}

/** 'Today', 'Tomorrow', 'In 5 days', 'Yesterday', '3 days ago'. */
export function daysLeftLabel(dueOn: string, now: Date): string {
  const days = daysUntil(dueOn, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

function byDueThenTime(a: AdmissionsKeyDate, b: AdmissionsKeyDate): number {
  if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
  const at = a.time ?? '';
  const bt = b.time ?? '';
  if (at === bt) return a.title.localeCompare(b.title);
  return at < bt ? -1 : 1;
}

/** Open key dates from today to `withinDays` ahead, soonest first (untimed before timed on the same day). */
export function upcomingKeyDates(dates: AdmissionsKeyDate[], now: Date, withinDays = 60): AdmissionsKeyDate[] {
  return dates
    .filter((d) => {
      if (d.done) return false;
      const days = daysUntil(d.dueOn, now);
      return days >= 0 && days <= withinDays;
    })
    .sort(byDueThenTime);
}

/** Open key dates that have passed, oldest first. */
export function overdueKeyDates(dates: AdmissionsKeyDate[], now: Date): AdmissionsKeyDate[] {
  const today = toDateKey(now);
  return dates.filter((d) => !d.done && d.dueOn < today).sort(byDueThenTime);
}

/** Key dates (done or not) between two `YYYY-MM-DD` keys inclusive, for calendar overlays. */
export function keyDatesInRange(dates: AdmissionsKeyDate[], fromKey: string, toKey: string): AdmissionsKeyDate[] {
  return dates.filter((d) => d.dueOn >= fromKey && d.dueOn <= toKey).sort(byDueThenTime);
}

/** Open tasks, optionally for one owner: dated first (soonest), undated last, then oldest created. */
export function openTasks(tasks: AdmissionsTask[], owner?: TaskOwner): AdmissionsTask[] {
  return tasks
    .filter((t) => !t.doneAt && (!owner || t.owner === owner))
    .sort((a, b) => {
      if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
      if (a.dueOn && !b.dueOn) return -1;
      if (!a.dueOn && b.dueOn) return 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

const APPLIED: readonly TargetStatus[] = ['submitted', 'interview', 'offer', 'rejected', 'accepted', 'declined'];

export interface TargetSummary {
  total: number;
  applied: number;
  offers: number;
  accepted: number;
  awaiting: number;
}

export function targetSummary(targets: Pick<AdmissionsTarget, 'status'>[]): TargetSummary {
  return {
    total: targets.length,
    applied: targets.filter((t) => APPLIED.includes(t.status)).length,
    offers: targets.filter((t) => t.status === 'offer' || t.status === 'accepted').length,
    accepted: targets.filter((t) => t.status === 'accepted').length,
    awaiting: targets.filter((t) => t.status === 'submitted' || t.status === 'interview').length,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function institutionNoun(kind: AdmissionsCaseKind): [string, string] {
  if (kind === 'uk-university' || kind === 'us-university') return ['university', 'universities'];
  if (kind === 'school-entry' || kind === 'boarding') return ['school', 'schools'];
  return ['institution', 'institutions'];
}

/** e.g. '5 universities shortlisted · 2 applications submitted · 1 offer'. */
export function targetSummaryLine(targets: Pick<AdmissionsTarget, 'status'>[], kind: AdmissionsCaseKind): string {
  const s = targetSummary(targets);
  const [one, many] = institutionNoun(kind);
  if (s.total === 0) return `No ${many} shortlisted yet`;
  const parts = [`${plural(s.total, one, many)} shortlisted`];
  if (s.applied > 0) parts.push(`${plural(s.applied, 'application', 'applications')} submitted`);
  if (s.offers > 0) parts.push(plural(s.offers, 'offer', 'offers'));
  if (s.accepted > 0) parts.push(`${s.accepted === 1 ? 'place' : `${s.accepted} places`} accepted`);
  return parts.join(' · ');
}

/**
 * Timeline title for a shortlist status change, or null when the change is not worth a timeline entry.
 * Must match the SQL trigger in the admissions migration.
 */
export function targetStatusEventTitle(status: TargetStatus, institution: string): string | null {
  switch (status) {
    case 'applying':
      return `Application under way for ${institution}`;
    case 'submitted':
      return `Application submitted to ${institution}`;
    case 'interview':
      return `Interview invitation from ${institution}`;
    case 'offer':
      return `Offer received from ${institution}`;
    case 'rejected':
      return `${institution} did not offer a place`;
    case 'accepted':
      return `Place accepted at ${institution}`;
    case 'declined':
      return `Offer from ${institution} declined`;
    default:
      return null;
  }
}

/** '<Kind label>: <title>' plus ' · <institution>' when the date belongs to a shortlisted target. */
export function keyDateTitle(d: AdmissionsKeyDate, targets: AdmissionsTarget[]): string {
  const base = `${KEY_DATE_KIND_LABELS[d.kind]}: ${d.title}`;
  const target = d.targetId ? targets.find((t) => t.id === d.targetId) : undefined;
  return target ? `${base} · ${target.institution}` : base;
}

// ---------------------------------------------------------------------------------------------
// Access (same rule as SQL admissions_access)
// ---------------------------------------------------------------------------------------------

/** Admin, or the tutor who is this case's adviser. */
export function canManageCase(viewer: Profile, c: Pick<AdmissionsCase, 'adviserTutorId'>): boolean {
  if (viewer.role === 'admin') return true;
  return viewer.role === 'tutor' && !!viewer.tutorId && viewer.tutorId === c.adviserTutorId;
}

/**
 * What a viewer may do with a case. A tutor who teaches the student but is not the adviser has no access.
 * `visibleStudentIds` is the set of students the viewer may see (their family's children, or themselves).
 */
export function caseAccess(
  viewer: Profile,
  c: Pick<AdmissionsCase, 'adviserTutorId' | 'studentId' | 'familyId'>,
  visibleStudentIds: string[],
): AdmissionsAccess | null {
  if (viewer.role === 'admin') return 'admin';
  if (viewer.role === 'tutor') return canManageCase(viewer, c) ? 'adviser' : null;
  if (viewer.role === 'parent' || viewer.role === 'student') {
    return visibleStudentIds.includes(c.studentId) ? 'family' : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Advisory updates
// ---------------------------------------------------------------------------------------------

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** e.g. 'October 2026'. */
export function advisoryPeriodLabel(now: Date): string {
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function dateKeyLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d));
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface AdvisoryTemplateInput {
  studentName: string;
  kind: AdvisoryUpdateKind;
  period?: string;
  targets: AdmissionsTarget[];
  dates: AdmissionsKeyDate[];
  tasks: AdmissionsTask[];
  events: AdmissionsEvent[];
  now: Date;
}

/**
 * A formal, factual update built only from the case's own records. Used when AI drafting is unavailable.
 */
export function templateAdvisoryUpdate(input: AdvisoryTemplateInput): { title: string; body: string } {
  const { studentName, kind, targets, dates, tasks, now } = input;
  const period = input.period?.trim() || advisoryPeriodLabel(now);
  const title = kind === 'monthly' ? `${period} advisory update` : 'Advisory update';
  const paragraphs: string[] = [];

  // Shortlist and status.
  if (targets.length === 0) {
    paragraphs.push(
      `We are continuing to refine ${studentName}'s shortlist and will share our recommendations as soon as it is settled.`,
    );
  } else {
    const groups = TARGET_STATUS_ORDER.map((status) => {
      const names = targets.filter((t) => t.status === status).map((t) => t.institution);
      return names.length ? `${listJoin(names)} (${TARGET_STATUS_LABELS[status].toLowerCase()})` : null;
    }).filter((g): g is string => !!g);
    paragraphs.push(
      `${studentName}'s shortlist currently includes ${plural(targets.length, 'institution', 'institutions')}: ${groups.join('; ')}.`,
    );
  }

  // Upcoming deadlines (next three).
  const upcoming = upcomingKeyDates(dates, now, 90).slice(0, 3);
  if (upcoming.length === 0) {
    paragraphs.push('There are no key dates in the coming weeks.');
  } else {
    const lines = upcoming.map((d) => {
      const target = d.targetId ? targets.find((t) => t.id === d.targetId) : undefined;
      const where = target ? ` (${target.institution})` : '';
      const time = d.time ? ` at ${d.time}` : '';
      return `${KEY_DATE_KIND_LABELS[d.kind]}: ${d.title}${where} on ${dateKeyLabel(d.dueOn)}${time}`;
    });
    paragraphs.push(`The next key dates are as follows. ${lines.join('. ')}.`);
  }

  // What the family should do.
  const familyTasks = openTasks(tasks, 'family');
  if (familyTasks.length === 0) {
    paragraphs.push('There is nothing outstanding for the family at present.');
  } else {
    const lines = familyTasks.map((t) => (t.dueOn ? `${t.title} (by ${dateKeyLabel(t.dueOn)})` : t.title));
    paragraphs.push(`We would be grateful if you could attend to the following: ${lines.join('; ')}.`);
  }

  paragraphs.push('Please do not hesitate to contact us should you have any questions.');
  return { title, body: paragraphs.join('\n\n') };
}

// ---------------------------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------------------------

/** Invoice item field that links an item to an admissions case. */
export const ADMISSIONS_ITEM_KEY = 'admissionsCaseId';

export function invoicesForCase(invoices: Invoice[], caseId: string): Invoice[] {
  return invoices.filter((inv) =>
    inv.items.some((item) => (item as unknown as Record<string, unknown>)[ADMISSIONS_ITEM_KEY] === caseId),
  );
}

export type FeePresetKey = 'package' | 'fixed' | 'hourly';

export const FEE_PRESETS: readonly { key: FeePresetKey; label: string; hint: string; quantityLabel?: string }[] = [
  {
    key: 'package',
    label: 'Advisory package',
    hint: 'A fixed price for a defined programme of support.',
  },
  {
    key: 'fixed',
    label: 'Fixed fee',
    hint: 'A one-off service, for example a personal statement review.',
  },
  {
    key: 'hourly',
    label: 'Consultation hours',
    hint: 'The number of hours multiplied by the hourly rate.',
    quantityLabel: 'Hours',
  },
];

const FEE_DESCRIPTION_STEMS: Record<FeePresetKey, string> = {
  package: 'Admissions advisory package',
  fixed: 'Admissions advisory service',
  hourly: 'Admissions consultation',
};

/** e.g. 'Admissions advisory package — UCAS 2028 entry'. */
export function feeDescription(preset: FeePresetKey, caseTitle: string, detail?: string): string {
  const stem = detail?.trim() ? `${FEE_DESCRIPTION_STEMS[preset]}: ${detail.trim()}` : FEE_DESCRIPTION_STEMS[preset];
  return caseTitle.trim() ? `${stem} — ${caseTitle.trim()}` : stem;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

// Limits match the column checks in the admissions migration.
const MAX_TITLE = 200;
const MAX_TEXT = 4000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateKey(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

function required(value: string | undefined, label: string): string | null {
  const v = value?.trim() ?? '';
  if (!v) return `Please enter ${label}.`;
  if (v.length > MAX_TITLE) return `Please keep ${label} to ${MAX_TITLE} characters or fewer.`;
  return null;
}

function longText(value: string | undefined, label: string, max = MAX_TEXT): string | null {
  if (value && value.trim().length > max) return `Please keep ${label} to ${max.toLocaleString('en-GB')} characters or fewer.`;
  return null;
}

export function validateCaseInput(input: AdmissionsCaseInput): string | null {
  if (!input.studentId) return 'Please choose a student.';
  if (!(input.kind in CASE_KIND_LABELS)) return 'Please choose the type of admissions support.';
  if (!(input.status in CASE_STATUS_LABELS)) return 'Please choose a status.';
  return (
    required(input.title, 'a title') ??
    longText(input.entryYear, 'the year of entry', 40) ??
    longText(input.summary, 'the summary')
  );
}

export function validateTargetInput(input: AdmissionsTargetInput): string | null {
  if (!input.caseId) return 'This shortlist entry is not linked to an admissions case.';
  const err = required(input.institution, 'the name of the school or university');
  if (err) return err;
  if (!(input.status in TARGET_STATUS_LABELS)) return 'Please choose a status.';
  if (input.decisionDate && !isDateKey(input.decisionDate)) return 'Please enter the decision date as YYYY-MM-DD.';
  return (
    longText(input.country, 'the country', 100) ??
    longText(input.programme, 'the course or programme', MAX_TITLE) ??
    longText(input.entryYear, 'the year of entry', 40) ??
    longText(input.requirements, 'the entry requirements') ??
    longText(input.notes, 'the notes')
  );
}

export function validateKeyDateInput(input: AdmissionsKeyDateInput): string | null {
  if (!input.caseId) return 'This key date is not linked to an admissions case.';
  const err = required(input.title, 'a title');
  if (err) return err;
  if (!(input.kind in KEY_DATE_KIND_LABELS)) return 'Please choose the type of date.';
  if (!input.dueOn || !isDateKey(input.dueOn)) return 'Please enter the date as YYYY-MM-DD.';
  if (input.time && !TIME_RE.test(input.time)) return 'Please enter the time as HH:MM, for example 09:30.';
  return longText(input.notes, 'the notes', 2000);
}

export function validateTaskInput(input: AdmissionsTaskInput): string | null {
  if (!input.caseId) return 'This task is not linked to an admissions case.';
  const err = required(input.title, 'a title');
  if (err) return err;
  if (input.owner !== 'family' && input.owner !== 'adviser') return 'Please choose who the task is for.';
  if (input.dueOn && !isDateKey(input.dueOn)) return 'Please enter the due date as YYYY-MM-DD.';
  return longText(input.details, 'the details');
}

export function validateAdvisoryUpdateInput(input: AdvisoryUpdateInput): string | null {
  if (!input.caseId) return 'This update is not linked to an admissions case.';
  const err = required(input.title, 'a title');
  if (err) return err;
  return longText(input.period, 'the period', 60) ?? longText(input.body, 'the update', 12000);
}
