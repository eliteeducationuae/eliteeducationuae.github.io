import { cleanChoice, CURRICULA, SUBJECTS } from '@/domain/catalogue';
import type { ApplicationStatus, TutorApplication } from '@/domain/types';

import { canonical, modernCurriculum, splitSubjects } from './catalogue-choice';
import type { Tone } from './ui';

export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  applied: { label: 'New', tone: 'gold' },
  interview: { label: 'Interview', tone: 'info' },
  offer: { label: 'Offer', tone: 'warning' },
  hired: { label: 'Hired', tone: 'success' },
  rejected: { label: 'Not now', tone: 'neutral' },
};

/**
 * What a new tutor record teaches, from their application: the typed subjects split on commas,
 * semicolons and 'and' (catalogue spelling where one matches), their curricula and their phases.
 */
export function teachingFromApplication(a: Pick<TutorApplication, 'subjects' | 'curricula' | 'phases'>): {
  subjects: string[];
  curricula: string[];
  phases: string[];
} {
  const subjects = splitSubjects(a.subjects, SUBJECTS)
    .map((s) => cleanChoice(s))
    .filter((s): s is string => !!s);
  const curricula = [
    ...new Set(
      (a.curricula ?? [])
        .map((c) => modernCurriculum(c))
        .filter((c): c is string => !!c)
        .map((c) => canonical(CURRICULA, c) ?? c),
    ),
  ];
  const phases = (a.phases ?? []).map((p) => cleanChoice(p)).filter((p): p is string => !!p);
  return { subjects, curricula, phases };
}
