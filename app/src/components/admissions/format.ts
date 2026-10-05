import type { Lookup } from '@/data/hooks';
import type {
  AdmissionsCase,
  AdmissionsCaseStatus,
  AdmissionsEventKind,
  AdvisoryUpdateStatus,
  TargetStatus,
} from '@/domain/admissions';
import { formatDate } from '@/domain/dates';

import type { IconName } from '../icon';
import type { Tone } from '../ui';

/** The tabs on a case page, in order. Also the values accepted by `?tab=` in deep links. */
export const CASE_TABS = ['overview', 'targets', 'dates', 'tasks', 'documents', 'updates', 'timeline'] as const;
export type CaseTab = (typeof CASE_TABS)[number];

export const CASE_TAB_LABELS: Record<CaseTab, string> = {
  overview: 'Overview',
  targets: 'Shortlist',
  dates: 'Key dates',
  tasks: 'Tasks',
  documents: 'Documents',
  updates: 'Updates',
  timeline: 'Timeline',
};

export function parseCaseTab(value: string | string[] | undefined): CaseTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (CASE_TABS as readonly string[]).includes(v ?? '') ? (v as CaseTab) : 'overview';
}

/** A `YYYY-MM-DD` key as a local date (never parsed as UTC). */
export function dateKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** '6 Oct 2026' for a `YYYY-MM-DD` key. */
export function formatDateKey(key: string): string {
  return formatDate(dateKeyToDate(key));
}

export function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

export const OFFICE_ADVISER = 'Elite Education';

/** The adviser's name, or the office when no tutor is assigned. */
export function adviserName(c: Pick<AdmissionsCase, 'adviserTutorId'>, lookup: Pick<Lookup, 'tutor'>): string {
  return (c.adviserTutorId && lookup.tutor(c.adviserTutorId)?.fullName) || OFFICE_ADVISER;
}

/** Muted badge tones, in keeping with the brand: never bright, never saturated. */
export function caseStatusTone(status: AdmissionsCaseStatus): Tone {
  switch (status) {
    case 'active':
      return 'gold';
    case 'on-hold':
      return 'warning';
    case 'completed':
      return 'success';
    default:
      return 'neutral';
  }
}

export function targetStatusTone(status: TargetStatus): Tone {
  switch (status) {
    case 'offer':
    case 'accepted':
      return 'success';
    case 'interview':
    case 'submitted':
      return 'gold';
    case 'applying':
      return 'info';
    case 'rejected':
    case 'declined':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function updateStatusTone(status: AdvisoryUpdateStatus): Tone {
  switch (status) {
    case 'published':
      return 'success';
    case 'approved':
      return 'info';
    case 'submitted':
      return 'gold';
    default:
      return 'neutral';
  }
}

export const EVENT_ICONS: Record<AdmissionsEventKind, IconName> = {
  case: 'school',
  target: 'school',
  date: 'calendar',
  task: 'check',
  document: 'doc',
  update: 'mail',
  milestone: 'sparkle',
};

/** Types a family or adviser may upload to a case. */
export const ADMISSIONS_FILE_TYPES = [
  'application/pdf',
  'image/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const TITLE_STEMS: Record<AdmissionsCase['kind'], [string, string]> = {
  'school-entry': ['School entry', ''],
  boarding: ['UK boarding schools', ''],
  'uk-university': ['UK universities', ' (UCAS)'],
  'us-university': ['US universities', ' (Common App)'],
  other: ['Admissions', ''],
};

/** e.g. 'UK universities — 2028 entry (UCAS)'. */
export function suggestCaseTitle(kind: AdmissionsCase['kind'], entryYear: string): string {
  const [stem, suffix] = TITLE_STEMS[kind];
  const year = entryYear.trim();
  return year ? `${stem} — ${year} entry${suffix}` : `${stem}${suffix}`;
}
