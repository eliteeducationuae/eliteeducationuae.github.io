import type { Enquiry, SpamReason, SpamStatus, TutorApplication } from './types';

/** Submissions made faster than this after the form opened look automated. A missing time is never flagged. */
export const MIN_ELAPSED_MS = 3000;
/** This many links or more in the free-text answers looks automated. */
export const LINK_FLAG_THRESHOLD = 3;
/** Repeat messages at least this similar (Jaccard index of words) are merged into the first. */
export const SIMILARITY_THRESHOLD = 0.6;
/** Repeat submissions from the same email address within this window are merged. */
export const MERGE_WINDOW_HOURS = 24;

export interface SpamLimits {
  emailPerHour: number;
  emailPerDay: number;
  ipPerHour: number;
  ipPerDay: number;
}

export const SPAM_LIMITS: { enquiry: SpamLimits; application: SpamLimits } = {
  enquiry: { emailPerHour: 3, emailPerDay: 6, ipPerHour: 5, ipPerDay: 20 },
  application: { emailPerHour: 2, emailPerDay: 3, ipPerHour: 3, ipPerDay: 10 },
};

export const RATE_LIMIT_CODE = 'PT429';
export const RATE_LIMIT_MESSAGE =
  'Thank you. We have received several messages from you in a short time, so we have paused further submissions for now. We will be in touch shortly; if your enquiry is urgent, please email craig@craigobrieneducation.com.';

/** Raised when someone has sent too many forms in a short time. The message is shown to them as it is. */
export class RateLimitError extends Error {
  readonly code = RATE_LIMIT_CODE;
  constructor() {
    super(RATE_LIMIT_MESSAGE);
    this.name = 'RateLimitError';
  }
}

export const SPAM_REASON_LABEL: Record<SpamReason, string> = {
  'link-in-name': 'Link in the name',
  links: 'Several links',
  'too-fast': 'Sent very quickly',
  captcha: 'Security check not completed',
};

export const PAYLOAD_MESSAGES = {
  name: 'Please shorten the name to 200 characters or fewer',
  contact: 'Please check the email address or telephone number',
  message: 'Please shorten your message to 4,000 characters or fewer',
  other: 'Please shorten your answers a little',
} as const;

const LINK = /(https?:\/\/|www\.)/gi;
// The POSIX [[:punct:]] set: ASCII punctuation only, so Arabic and other scripts are kept.
const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+/g;

export function countLinks(text: string | undefined | null): number {
  return text ? (text.match(LINK) ?? []).length : 0;
}

export function normaliseMessage(text: string | undefined | null): string {
  return (text ?? '').toLowerCase().replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
}

/** 1 when either message is empty; otherwise the Jaccard index of their distinct words. */
export function messageSimilarity(a: string | undefined | null, b: string | undefined | null): number {
  const x = normaliseMessage(a);
  const y = normaliseMessage(b);
  if (!x || !y) return 1;
  const sa = new Set(x.split(' '));
  const sb = new Set(y.split(' '));
  let both = 0;
  for (const w of sa) if (sb.has(w)) both++;
  return both / (sa.size + sb.size - both);
}

/** Why a submission looks automated, in a fixed order. Empty means it looks genuine. */
export function spamReasons(input: {
  names: (string | undefined)[];
  text: (string | undefined)[];
  elapsedMs?: number | null;
  captchaMissing?: boolean;
}): SpamReason[] {
  const out: SpamReason[] = [];
  if (input.names.some((n) => countLinks(n) > 0)) out.push('link-in-name');
  if (input.text.reduce((sum, t) => sum + countLinks(t), 0) >= LINK_FLAG_THRESHOLD) out.push('links');
  if (input.elapsedMs != null && input.elapsedMs < MIN_ELAPSED_MS) out.push('too-fast');
  if (input.captchaMissing) out.push('captcha');
  return out;
}

/** Suspected or confirmed spam: kept, but left out of the pipeline and statistics. */
export function isPossibleSpam(x: { spamStatus?: SpamStatus }): boolean {
  return x.spamStatus === 'suspected' || x.spamStatus === 'spam';
}

export function withoutSpam<T extends { spamStatus?: SpamStatus }>(list: T[]): T[] {
  return list.filter((x) => !isPossibleSpam(x));
}

export function spamSummary(reasons: SpamReason[] | undefined): string {
  return (reasons ?? []).map((r) => SPAM_REASON_LABEL[r]).join(' · ');
}

const HOUR = 3_600_000;

function same(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a new submission from `who` would go over any of the limits, given recent submissions. */
export function rateLimited(
  history: { at: string; email?: string; ipHash?: string }[],
  who: { email?: string; ipHash?: string },
  limits: SpamLimits,
  now: Date,
): boolean {
  const t = now.getTime();
  const count = (match: (h: { email?: string; ipHash?: string }) => boolean, hours: number) =>
    history.filter((h) => match(h) && t - new Date(h.at).getTime() < hours * HOUR).length;
  if (who.email) {
    const byEmail = (h: { email?: string }) => same(h.email, who.email);
    if (count(byEmail, 1) >= limits.emailPerHour || count(byEmail, 24) >= limits.emailPerDay) return true;
  }
  if (who.ipHash) {
    const byIp = (h: { ipHash?: string }) => !!h.ipHash && h.ipHash === who.ipHash;
    if (count(byIp, 1) >= limits.ipPerHour || count(byIp, 24) >= limits.ipPerDay) return true;
  }
  return false;
}

function within(x: { createdAt: string; lastSubmittedAt?: string }, now: Date): boolean {
  const last = x.lastSubmittedAt && x.lastSubmittedAt > x.createdAt ? x.lastSubmittedAt : x.createdAt;
  return now.getTime() - new Date(last).getTime() < MERGE_WINDOW_HOURS * HOUR;
}

/** An earlier enquiry this one repeats, which it should be merged into, if any. */
export function findDuplicateEnquiry(list: Enquiry[], candidate: { email?: string; studentName?: string; message?: string }, now: Date): Enquiry | undefined {
  if (!candidate.email) return undefined;
  return list
    .filter(
      (e) =>
        same(e.email, candidate.email) &&
        within(e, now) &&
        e.spamStatus !== 'spam' &&
        e.status !== 'enrolled' &&
        e.status !== 'lost' &&
        !(e.studentName?.trim() && candidate.studentName?.trim() && !same(e.studentName, candidate.studentName)) &&
        messageSimilarity(e.message, candidate.message) >= SIMILARITY_THRESHOLD,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** An earlier, still-new application from the same email address to merge this one into, if any. */
export function findDuplicateApplication(list: TutorApplication[], candidate: { email?: string }, now: Date): TutorApplication | undefined {
  if (!candidate.email) return undefined;
  return list
    .filter((a) => same(a.email, candidate.email) && within(a, now) && a.status === 'applied' && a.spamStatus !== 'spam')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

const over = (s: string | undefined | null, max: number) => (s ?? '').length > max;

/** The polite message for an enquiry that is too long to accept, or null when it is fine. */
export function enquiryPayloadProblem(e: {
  parentName?: string;
  studentName?: string;
  email?: string;
  phone?: string;
  message?: string;
  preferredTimes?: string;
  yearGroup?: string;
}): string | null {
  if (over(e.parentName, 200) || over(e.studentName, 200)) return PAYLOAD_MESSAGES.name;
  if (over(e.email, 200) || over(e.phone, 50)) return PAYLOAD_MESSAGES.contact;
  if (over(e.message, 4000)) return PAYLOAD_MESSAGES.message;
  if (over(e.preferredTimes, 1000) || over(e.yearGroup, 100)) return PAYLOAD_MESSAGES.other;
  return null;
}

/** The polite message for a tutor application that is too long to accept, or null when it is fine. */
export function applicationPayloadProblem(a: {
  fullName?: string;
  email?: string;
  phone?: string;
  experience?: string;
  availability?: string;
  qualifications?: string;
  subjects?: string;
  curricula?: string[];
  phases?: string[];
}): string | null {
  if (over(a.fullName, 200)) return PAYLOAD_MESSAGES.name;
  if (over(a.email, 200) || over(a.phone, 50)) return PAYLOAD_MESSAGES.contact;
  if (over(a.experience, 4000)) return PAYLOAD_MESSAGES.message;
  if (over(a.availability, 1000) || over(a.qualifications, 2000) || over(a.subjects, 500) || (a.curricula?.length ?? 0) > 20 || (a.phases?.length ?? 0) > 20) {
    return PAYLOAD_MESSAGES.other;
  }
  return null;
}
