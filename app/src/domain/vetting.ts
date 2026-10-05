/**
 * Tutor vetting and onboarding: police clearance status, expiry alerts, overrides and the onboarding checklist.
 * Pure functions: every rule that depends on the date takes `today` or `now` explicitly.
 * The status rules mirror public.tutor_compliance() in the database.
 */
import { daysUntil as daysFromToday, toDateKey } from './dates';
import type { TutorCompliance, TutorDocument, TutorDocumentType, VettingOverride, VettingStatus } from './types';

export const DOCUMENT_TYPES: readonly { type: TutorDocumentType; label: string; required: boolean; needsExpiry: boolean }[] = [
  { type: 'police_clearance', label: 'Police clearance certificate', required: true, needsExpiry: true },
  { type: 'passport_id', label: 'Passport or Emirates ID', required: false, needsExpiry: false },
  { type: 'qualification', label: 'Qualification certificate', required: false, needsExpiry: false },
  { type: 'other', label: 'Other document', required: false, needsExpiry: false },
];

export function documentTypeLabel(type: TutorDocumentType): string {
  return DOCUMENT_TYPES.find((d) => d.type === type)?.label ?? 'Document';
}

/** A verified clearance this close to expiry (in days) counts as expiring soon. */
export const EXPIRING_SOON_DAYS = 60;
/** Days before expiry at which tutor and office are reminded; 0 is the day of expiry (or after). */
export const ALERT_THRESHOLDS = [60, 30, 7, 0] as const;

/** Whole calendar days from today until a `YYYY-MM-DD` date; negative when it has passed. */
export function daysUntil(dateKey: string, today: Date): number {
  return daysFromToday(dateKey, today);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-11-03` or an ISO time → `3 November 2026` (local time). */
export function formatLongDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Valid on the expiry day itself. Documents without an expiry date never count as valid clearance. */
const unexpired = (doc: TutorDocument, today: Date) => !!doc.expiryDate && daysUntil(doc.expiryDate, today) >= 0;

export type DocumentState = 'pending' | 'verified' | 'expiring' | 'expired' | 'rejected';

/** How one document stands today. A verified document without an expiry date stays 'verified'. */
export function documentState(doc: TutorDocument, today: Date): DocumentState {
  if (doc.status !== 'verified') return doc.status;
  if (!doc.expiryDate) return 'verified';
  const days = daysUntil(doc.expiryDate, today);
  if (days < 0) return 'expired';
  return days <= EXPIRING_SOON_DAYS ? 'expiring' : 'verified';
}

const byLatest = (key: (d: TutorDocument) => string | undefined) => (a: TutorDocument, b: TutorDocument) =>
  (key(b) ?? '').localeCompare(key(a) ?? '') || b.createdAt.localeCompare(a.createdAt);

/**
 * The police clearance that determines a tutor's status: the verified unexpired one with the latest expiry,
 * otherwise the latest pending one, otherwise the verified (expired) one with the latest expiry.
 */
export function clearanceDocument(docs: TutorDocument[], today: Date): TutorDocument | undefined {
  const clearances = docs.filter((d) => d.type === 'police_clearance');
  const verified = clearances.filter((d) => d.status === 'verified');
  const valid = verified.filter((d) => unexpired(d, today)).sort(byLatest((d) => d.expiryDate));
  if (valid.length) return valid[0];
  const pending = clearances.filter((d) => d.status === 'pending').sort(byLatest((d) => d.createdAt));
  if (pending.length) return pending[0];
  return verified.sort(byLatest((d) => d.expiryDate))[0];
}

/**
 * A tutor's police clearance status from their documents (other document types are ignored).
 * A verified, unexpired clearance wins, so a pending renewal never downgrades a cleared tutor.
 */
export function vettingStatus(docs: TutorDocument[], today: Date): VettingStatus {
  const doc = clearanceDocument(docs, today);
  if (!doc) return 'missing';
  if (doc.status === 'pending') return 'pending';
  if (doc.status === 'verified' && unexpired(doc, today)) {
    return daysUntil(doc.expiryDate!, today) <= EXPIRING_SOON_DAYS ? 'expiring' : 'cleared';
  }
  return doc.status === 'verified' ? 'expired' : 'missing';
}

/** Cleared to teach: 'cleared' or 'expiring' (still valid). */
export function isCleared(status: VettingStatus): boolean {
  return status === 'cleared' || status === 'expiring';
}

/**
 * The expiry alert due now: the smallest threshold at or above the days left (past expiry counts as 0),
 * or null when more than 60 days remain or that alert has already been sent.
 */
export function dueAlertThreshold(daysLeft: number, sent: readonly number[]): number | null {
  const days = Math.max(daysLeft, 0);
  const due = [...ALERT_THRESHOLDS].sort((a, b) => a - b).find((t) => days <= t);
  if (due === undefined || sent.includes(due)) return null;
  return due;
}

/** The tutor's override in force now (not revoked, not expired), with the latest expiry. */
export function activeOverride(overrides: VettingOverride[], tutorId: string, now: Date): VettingOverride | undefined {
  return overrides
    .filter((o) => o.tutorId === tutorId && !o.revokedAt && new Date(o.expiresAt).getTime() > now.getTime())
    .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
}

const BLOCK_REASONS: Record<VettingStatus, string> = {
  cleared: '',
  expiring: '',
  pending: 'Police clearance awaiting review',
  expired: 'Police clearance expired',
  missing: 'Police clearance not yet uploaded',
};

/**
 * Whether new lessons, students or roles may be given to the tutor. Allowed when there is no compliance row,
 * enforcement is off, the tutor is cleared, or an override is active (then `overridden` is true).
 * `reason` is name-free, e.g. 'Police clearance not yet uploaded', 'Police clearance awaiting review',
 * 'Police clearance expired'; with an override it is 'Override: <reason>'.
 */
export function canAssignTutor(c: TutorCompliance | undefined, now: Date): { allowed: boolean; overridden: boolean; reason?: string } {
  if (!c || !c.enforced || isCleared(c.vettingStatus)) return { allowed: true, overridden: false };
  if (c.override && new Date(c.override.until).getTime() > now.getTime()) {
    return { allowed: true, overridden: true, reason: `Override: ${c.override.reason}` };
  }
  return { allowed: false, overridden: false, reason: BLOCK_REASONS[c.vettingStatus] };
}

export type ChecklistKey = 'clearance' | 'bank' | 'availability' | 'calendar' | 'whatsapp' | 'handbook';
export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
  optional: boolean;
  detail?: string;
}

function clearanceDetail(c: TutorCompliance): string {
  switch (c.vettingStatus) {
    case 'cleared':
    case 'expiring':
      return c.clearanceExpiry ? `Expires ${formatLongDate(c.clearanceExpiry)}` : 'Verified';
    case 'pending':
      return 'Awaiting review';
    case 'expired':
      return 'Expired';
    case 'missing':
      return 'Not yet uploaded';
  }
}

/** The tutor's onboarding steps, in order. Calendar and WhatsApp are optional. */
export function onboardingChecklist(c: TutorCompliance, _today: Date): ChecklistItem[] {
  const handbookDone = c.handbookVersion === undefined || (c.handbookAcknowledgedVersion ?? 0) >= c.handbookVersion;
  return [
    { key: 'clearance', label: 'Police clearance uploaded and verified', done: isCleared(c.vettingStatus), optional: false, detail: clearanceDetail(c) },
    { key: 'bank', label: 'Bank details added', done: c.bankDetails, optional: false },
    { key: 'availability', label: 'Availability set', done: c.availabilitySet, optional: false },
    { key: 'calendar', label: 'Google Calendar connected', done: c.calendarConnected, optional: true },
    { key: 'whatsapp', label: 'WhatsApp updates switched on', done: c.whatsappOptIn, optional: true },
    {
      key: 'handbook',
      label: 'Tutor handbook acknowledged',
      done: handbookDone,
      optional: false,
      detail: handbookDone ? undefined : `Version ${c.handbookVersion} to acknowledge`,
    },
  ];
}

/** Progress over the required items only. */
export function onboardingProgress(items: ChecklistItem[]): { done: number; total: number; complete: boolean } {
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  return { done, total: required.length, complete: done === required.length };
}

/** Every blocked assignment's error message starts with this (server and demo alike). */
export const VETTING_BLOCK_PREFIX = 'Police clearance required';

const BLOCKED_ACTION: Record<'lesson' | 'enrolment' | 'role', string> = {
  lesson: 'assigned new lessons',
  enrolment: 'given new students',
  role: 'awarded roles',
};

export function vettingBlockMessage(tutorName: string, action: 'lesson' | 'enrolment' | 'role'): string {
  return `${VETTING_BLOCK_PREFIX}: ${tutorName} cannot be ${BLOCKED_ACTION[action]} until their police clearance has been verified. An administrator can record an override with a reason.`;
}

/** True when an error (or message) is a vetting block, so the UI can offer the override. */
export function isVettingBlock(err: unknown): boolean {
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : '';
  return message.startsWith(VETTING_BLOCK_PREFIX);
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDateKey(value: string): boolean {
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** Checks a document's dates before upload or review. Returns an error sentence, or null when fine. */
export function validateDocumentDates(
  input: { type: TutorDocumentType; issueDate?: string; expiryDate?: string },
  today: Date,
): string | null {
  const issue = input.issueDate?.trim() || undefined;
  const expiry = input.expiryDate?.trim() || undefined;
  if ((issue && !isDateKey(issue)) || (expiry && !isDateKey(expiry))) return 'Please enter dates as YYYY-MM-DD';
  if (input.type === 'police_clearance' && !expiry) return 'Please enter the expiry date of the police clearance certificate';
  const todayKey = toDateKey(today);
  if (issue && issue > todayKey) return 'The issue date cannot be in the future';
  if (issue && expiry && expiry < issue) return 'The expiry date cannot be before the issue date';
  // As on the server, only an expired police clearance is refused; other documents keep their history.
  if (input.type === 'police_clearance' && expiry && expiry < todayKey) return 'This certificate has already expired';
  return null;
}

/** Tutors the office should look at: anyone not fully cleared, or with a document awaiting review. */
export function needsAttention(list: TutorCompliance[]): TutorCompliance[] {
  return list.filter((c) => c.vettingStatus !== 'cleared' || c.documentsPending > 0);
}

/** One line for lists, e.g. 'Cleared until 3 November 2026' or 'Expires in 25 days · Override until 18 October 2026'. */
export function vettingSummary(c: TutorCompliance, today: Date): string {
  let text: string;
  switch (c.vettingStatus) {
    case 'cleared':
      text = c.clearanceExpiry ? `Cleared until ${formatLongDate(c.clearanceExpiry)}` : 'Cleared';
      break;
    case 'expiring': {
      const days = c.clearanceExpiry ? daysUntil(c.clearanceExpiry, today) : undefined;
      text = days === undefined ? 'Expires soon' : days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
      break;
    }
    case 'pending':
      text = 'Awaiting review';
      break;
    case 'expired':
      text = c.clearanceExpiry ? `Expired on ${formatLongDate(c.clearanceExpiry)}` : 'Expired';
      break;
    case 'missing':
      text = 'Police clearance missing';
      break;
  }
  if (c.override && new Date(c.override.until).getTime() > today.getTime()) {
    text += ` · Override until ${formatLongDate(c.override.until)}`;
  }
  return text;
}

/**
 * Why a tutor cannot take new work, phrased to sit inside a sentence, e.g. 'no certificate has been uploaded'
 * or 'their certificate expired on 1 September 2026'.
 */
export function blockedReasonPhrase(c: TutorCompliance): string {
  switch (c.vettingStatus) {
    case 'missing':
      return 'no certificate has been uploaded';
    case 'pending':
      return 'their certificate is awaiting review';
    case 'expired':
      return c.clearanceExpiry ? `their certificate expired on ${formatLongDate(c.clearanceExpiry)}` : 'their certificate has expired';
    case 'expiring':
    case 'cleared':
      return 'their certificate is valid';
  }
}

/** Shapes typed digits into `YYYY-MM-DD` as the user types, e.g. '2027100' → '2027-10-0'. */
export function maskDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** A complete, real `YYYY-MM-DD` date in words ('5 October 2027'), or null while incomplete or invalid. */
export function describeDateInput(text: string): string | null {
  const value = text.trim();
  return isDateKey(value) ? formatLongDate(value) : null;
}
