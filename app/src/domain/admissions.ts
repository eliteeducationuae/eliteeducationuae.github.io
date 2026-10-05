/**
 * Admissions advisory: school, boarding and university admissions cases run by an adviser for a family.
 * Pure helpers shared by the demo data source, the UI and (in spirit) the SQL rules in
 * supabase/migrations/20261018000000_admissions.sql.
 */
import { letterSalutation, letterSignOff, typographic } from '../../supabase/functions/_shared/admissions-letter';
import { daysUntil, toDateKey } from './dates';
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

/**
 * A day's calendar entries (lessons, busy times: anything with an ISO `start`) and its key dates as one list.
 * Timed key dates sit where they fall in the day (UAE time, read as the device's local time); untimed ones close the day.
 */
export function withKeyDatesInTimeOrder<E extends { start: string }>(
  entries: E[],
  dates: AdmissionsKeyDate[],
): ({ kind: 'entry'; entry: E } | { kind: 'date'; date: AdmissionsKeyDate })[] {
  const minutes = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  };
  const timed = dates.filter((d) => d.time).sort((a, b) => a.time!.localeCompare(b.time!));
  const out: ({ kind: 'entry'; entry: E } | { kind: 'date'; date: AdmissionsKeyDate })[] = [];
  let i = 0;
  for (const entry of entries) {
    while (i < timed.length && timeMinutes(timed[i].time!) <= minutes(entry.start)) out.push({ kind: 'date', date: timed[i++] });
    out.push({ kind: 'entry', entry });
  }
  while (i < timed.length) out.push({ kind: 'date', date: timed[i++] });
  for (const date of dates.filter((d) => !d.time)) out.push({ kind: 'date', date });
  return out;
}

function timeMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** A key date's heading: '<Kind>: <title>', unless the title already says what it is ('Common App deadline'). */
export function keyDateHeading(d: Pick<AdmissionsKeyDate, 'kind' | 'title'>): string {
  const words: Record<KeyDateKind, RegExp | null> = {
    deadline: /\bdeadline\b/i,
    test: /\b(test|exam|examination|assessment)\b/i,
    interview: /\binterview\b/i,
    'open-day': /\bopen (day|morning|evening)\b/i,
    decision: /\bdecisions?\b/i,
    other: null,
  };
  return words[d.kind]?.test(d.title) ? d.title : `${KEY_DATE_KIND_LABELS[d.kind]}: ${d.title}`;
}

/**
 * Reminders already sent once a key date or task is saved (mirrors admissions_keep_reminders): a date that moves
 * starts afresh, so a rescheduled interview or deadline is reminded again from the next threshold.
 */
export function remindersAfterSave(sent: readonly number[], previousDueOn: string | null | undefined, dueOn: string | null | undefined): number[] {
  return (previousDueOn ?? null) === (dueOn ?? null) ? [...sent] : [];
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

/** Generic words in an institution's name that do not, on their own, name it ('School', 'University', 'of'…). */
const GENERIC_INSTITUTION_WORDS = new Set([
  'the', 'of', 'and', 'for', 'at', 'in', 'university', 'college', 'school', 'academy', 'institute', 'institution', 'international',
  'british', 'american', 'english', 'high', 'senior', 'junior', 'prep', 'preparatory', 'grammar', 'boarding', 'sixth', 'form',
  'centre', 'center', 'royal', 'london', 'state', 'city', 'national', 'technology', 'arts', 'science', 'sciences',
]);

/** True when a key date's title already names its institution ('Oxford open day' for the University of Oxford). */
export function titleNamesInstitution(title: string, institution: string): boolean {
  const said = new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const own = institution.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !GENERIC_INSTITUTION_WORDS.has(w));
  if (own.length === 0) return title.toLowerCase().includes(institution.trim().toLowerCase());
  return own.some((w) => said.has(w));
}

/** The key date's heading plus ' · <institution>' when it belongs to a shortlisted target the title does not already name. */
export function keyDateTitle(d: AdmissionsKeyDate, targets: AdmissionsTarget[]): string {
  const base = keyDateHeading(d);
  const target = d.targetId ? targets.find((t) => t.id === d.targetId) : undefined;
  return target && !titleNamesInstitution(d.title, target.institution) ? `${base} · ${target.institution}` : base;
}

/** A key date's time for families who may be abroad: '10:30 (UAE time)'. */
export function keyDateTimeLabel(time: string): string {
  return `${time} (UAE time)`;
}

export { typographic };

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

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A `YYYY-MM-DD` key written out in full, e.g. 'Saturday 17 October 2026'. */
export function longDateLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_NAMES[date.getDay()]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Small numbers in words, as in formal correspondence ('five'); larger ones as numerals. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** 'University of Oxford' reads as 'the University of Oxford' mid-sentence. */
function institutionName(name: string): string {
  const n = name.trim();
  return /^(university|institute|london school|royal college|college|school) of /i.test(n) ? `the ${n}` : n;
}

/** Names of tests and qualifications written in title case wherever they appear. */
const PROPER_NAMES: readonly string[] = [
  'Mathematics Admissions Test',
  'Physics Aptitude Test',
  'Thinking Skills Assessment',
  'Test of Mathematics for University Admission',
  'Engineering and Science Admissions Test',
  'University Clinical Aptitude Test',
  'Law National Aptitude Test',
  'History Aptitude Test',
  'Modern Languages Admissions Test',
  'Classics Admissions Test',
  'English Literature Admissions Test',
  'Common App',
  'Early Decision',
  'Early Action',
  'Regular Decision',
  'Sixth Form',
];

/** Words that are proper nouns wherever they appear in British English (languages and nationalities). */
const PROPER_WORDS = new Set([
  'English', 'Arabic', 'French', 'Spanish', 'German', 'Italian', 'Latin', 'Greek', 'Mandarin', 'Chinese', 'Japanese', 'Russian',
  'Hindi', 'Urdu', 'British', 'American', 'Emirati', 'European', 'Islamic', 'Christmas', 'Easter', 'Ramadan', 'Eid',
]);

/** Restores the capitals of known test names: 'Mathematics admissions test' → 'Mathematics Admissions Test'. */
function properNames(text: string): string {
  return PROPER_NAMES.reduce((t, name) => t.replace(new RegExp(`\\b${name.replace(/ /g, '\\s+')}\\b`, 'gi'), name), text);
}

/** A title placed mid-sentence: 'Send the latest school report' becomes 'send the latest school report'. */
function midSentence(title: string, keep: readonly string[] = []): string {
  const t = properNames(title.trim().replace(/[.;:]+$/, ''));
  if (PROPER_NAMES.some((name) => t.startsWith(name))) return t;
  const [first = '', second = ''] = t.split(/\s+/);
  if (PROPER_WORDS.has(first)) return t;
  // Proper names stay as written: the student, institutions and capitalised phrases such as 'Sixth Form'.
  if (!/^[A-Z][a-z]+$/.test(first) || keep.includes(first) || /^[A-Z]/.test(second)) return t;
  return first.toLowerCase() + t.slice(first.length);
}

function stripStop(text: string): string {
  return text.trim().replace(/[.;:]+$/, '');
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
  /** The kind of case, so the shortlist reads as 'universities' or 'schools'. */
  caseKind?: AdmissionsCaseKind;
  /** Who the letter is addressed to, e.g. the parent's name. */
  addressee?: string;
  /** The adviser who signs the update; the office signs when there is none. */
  adviser?: string;
}

/** One sentence per stage of the shortlist, in the order an application progresses. */
function shortlistSentences(student: string, targets: AdmissionsTarget[]): string[] {
  const names = (status: TargetStatus) => targets.filter((t) => t.status === status).map((t) => institutionName(t.institution));
  const count = (status: TargetStatus) => targets.filter((t) => t.status === status).length;
  const out: string[] = [];
  const researching = names('researching');
  const applying = names('applying');
  if (applying.length) {
    const apps = count('applying') === 1 ? 'application' : 'applications';
    out.push(
      `We are preparing ${student}'s ${apps} to ${listJoin(applying)}` +
        (researching.length ? `, and continue to research ${listJoin(researching)}.` : '.'),
    );
  } else if (researching.length) {
    out.push(`We continue to research ${listJoin(researching)} on ${student}'s behalf.`);
  }
  if (names('submitted').length) {
    const apps = count('submitted') === 1 ? 'application' : 'applications';
    out.push(`${student}'s ${apps} to ${listJoin(names('submitted'))} ${count('submitted') === 1 ? 'has' : 'have'} been submitted.`);
  }
  if (names('interview').length) out.push(`${student} has been invited to interview at ${listJoin(names('interview'))}.`);
  if (names('offer').length) {
    out.push(`We are delighted to report that ${student} has received ${count('offer') === 1 ? 'an offer' : 'offers'} from ${listJoin(names('offer'))}.`);
  }
  if (names('accepted').length) out.push(`${student} has accepted a place at ${listJoin(names('accepted'))}.`);
  if (names('declined').length) out.push(`${student} has declined the offer from ${listJoin(names('declined'))}.`);
  if (names('rejected').length) {
    out.push(`We were sorry to learn that ${listJoin(names('rejected'))} did not offer ${student} a place.`);
  }
  return out;
}

/** A key date as a sentence, e.g. 'The Oxford open day takes place on Saturday 17 October 2026.' */
function keyDateSentence(d: AdmissionsKeyDate, target: AdmissionsTarget | undefined, keep: readonly string[]): string {
  const raw = stripStop(d.title);
  const title = /^(the|a|an|your|our)\s/i.test(raw) ? raw : `the ${midSentence(raw, keep)}`;
  const subject = title.charAt(0).toUpperCase() + title.slice(1);
  const when = `${longDateLabel(d.dueOn)}${d.time ? ` at ${keyDateTimeLabel(d.time)}` : ''}`;
  const at = target && !titleNamesInstitution(raw, target.institution) ? ` with ${institutionName(target.institution)}` : '';
  switch (d.kind) {
    case 'deadline':
      return /deadline/i.test(raw) ? `${subject}${at} falls on ${when}.` : `${subject}${at} is due on ${when}.`;
    case 'interview':
      return `${subject}${at} is scheduled for ${when}.`;
    case 'decision':
      return `${subject}${at} is expected on ${when}.`;
    default:
      return `${subject}${at} takes place on ${when}.`;
  }
}

/**
 * A formal letter to the family, built only from the case's own records. Used when AI drafting is unavailable.
 * Written as prose: a salutation, the shortlist, the dates ahead, what the family might attend to, and a sign-off.
 */
export function templateAdvisoryUpdate(input: AdvisoryTemplateInput): { title: string; body: string } {
  const { studentName: student, kind, targets, dates, tasks, now } = input;
  const period = input.period?.trim() || advisoryPeriodLabel(now);
  const title = kind === 'monthly' ? `${period} advisory update` : 'Advisory update';
  const paragraphs: string[] = [];

  paragraphs.push(letterSalutation(input.addressee));
  paragraphs.push(
    kind === 'monthly'
      ? `We are pleased to share our advisory update on ${student}'s admissions for ${period}.`
      : `We are writing with an update on ${student}'s admissions plan.`,
  );

  // Shortlist and status.
  if (targets.length === 0) {
    paragraphs.push(`We are continuing to refine ${student}'s shortlist and will share our recommendations as soon as it is settled.`);
  } else {
    const n = targets.length;
    paragraphs.push(
      [`${student}'s shortlist currently comprises ${numberWord(n)} ${institutionNoun(input.caseKind ?? 'other')[n === 1 ? 0 : 1]}.`, ...shortlistSentences(student, targets)].join(' '),
    );
  }

  // Words that stay capitalised mid-sentence: the student and the institutions.
  const keep = [student, ...targets.flatMap((t) => t.institution.trim().split(/\s+/))];

  // The dates ahead (next three).
  const upcoming = upcomingKeyDates(dates, now, 90).slice(0, 3);
  if (upcoming.length === 0) {
    paragraphs.push('There are no key dates in the coming weeks.');
  } else {
    const lines = upcoming.map((d) => keyDateSentence(d, d.targetId ? targets.find((t) => t.id === d.targetId) : undefined, keep));
    paragraphs.push(
      lines.length === 1
        ? `Looking ahead, ${lines[0].charAt(0).toLowerCase()}${lines[0].slice(1)}`
        : `Looking ahead, there are ${numberWord(lines.length)} key dates to note. ${lines.join(' ')}`,
    );
  }

  // What the family might attend to.
  const familyTasks = openTasks(tasks, 'family');
  if (familyTasks.length === 0) {
    paragraphs.push('There is nothing outstanding for the family at present.');
  } else {
    const items = familyTasks.map((t) => `${midSentence(t.title, keep)}${t.dueOn ? ` by ${longDateLabel(t.dueOn)}` : ''}`);
    paragraphs.push(`In the meantime, we should be grateful if you could ${listJoin(items)}.`);
  }

  paragraphs.push('Please do not hesitate to contact us should you have any questions.');
  paragraphs.push(letterSignOff(input.adviser));
  return { title: typographic(title), body: typographic(paragraphs.join('\n\n')) };
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
