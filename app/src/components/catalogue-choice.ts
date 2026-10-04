/**
 * Pure helpers behind the subject, phase and curriculum pickers (catalogue-picker.tsx).
 * Every picker offers the catalogue plus free text ("Other…"), so a stored value may be anything.
 */
import { OTHER } from '@/domain/catalogue';

const norm = (v?: string) => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The catalogue spelling of a value, if it matches an option (trimmed, case-insensitive). */
export function canonical(options: readonly string[], value?: string): string | undefined {
  const v = norm(value);
  if (!v) return undefined;
  return options.find((o) => norm(o) === v);
}

/**
 * Which chip is selected for a single-choice value: the matching option, 'Other' for free text,
 * or undefined when nothing is chosen. `otherText` is the free text to show in the Other field.
 */
export function choiceState(options: readonly string[], value?: string): { selected: string | undefined; otherText: string } {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return { selected: undefined, otherText: '' };
  const match = canonical(options, trimmed);
  if (match) return { selected: match, otherText: '' };
  return { selected: OTHER, otherText: value ?? '' };
}

/**
 * The options to show as chips. With `collapsed` = N and not expanded, the first N options,
 * plus the current value (or values) if they are options further down the list.
 */
export function visibleOptions(
  options: readonly string[],
  value: string | readonly string[] | undefined,
  collapsed: number | undefined,
  expanded: boolean,
): string[] {
  if (expanded || !collapsed || collapsed >= options.length) return [...options];
  const head = options.slice(0, Math.max(0, collapsed));
  const current = (Array.isArray(value) ? value : value ? [value] : []) as readonly string[];
  const extra = options.filter((o, i) => i >= collapsed && current.some((c) => norm(c) === norm(o)));
  return [...head, ...extra];
}

/** Whether the collapsed list hides any options. */
export function hasMore(options: readonly string[], collapsed: number | undefined, expanded: boolean): boolean {
  return !expanded && !!collapsed && collapsed < options.length;
}

/** Adds or removes `v` (case-insensitive), keeping the order of the rest. */
export function toggleMulti(values: readonly string[], v: string): string[] {
  const k = norm(v);
  if (!k) return [...values];
  return values.some((x) => norm(x) === k) ? values.filter((x) => norm(x) !== k) : [...values, v.trim()];
}

/**
 * Adds typed text to a multi-choice list: trims and collapses spaces, ignores blanks and
 * case-insensitive duplicates, and uses the catalogue spelling when the text matches an option.
 */
export function addOther(values: readonly string[], text: string, options: readonly string[] = []): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [...values];
  if (values.some((x) => norm(x) === norm(clean))) return [...values];
  return [...values, canonical(options, clean) ?? clean];
}

/** The values that are not catalogue options (shown as removable chips). */
export function freeTextValues(options: readonly string[], values: readonly string[]): string[] {
  return values.filter((v) => !canonical(options, v));
}

/** Whether a multi-choice list includes the option (case-insensitive). */
export function includesChoice(values: readonly string[], option: string): boolean {
  return values.some((v) => norm(v) === norm(option));
}

/**
 * Splits a typed list of subjects ('Chemistry; English Literature and Arabic') into tidy values,
 * using the catalogue spelling where one matches. Used when hiring an applicant.
 */
export function splitSubjects(text: string | undefined, options: readonly string[]): string[] {
  // Catalogue entries that contain ' and ' ('Phonics and reading') would be split above, so match those first.
  const whole = (text ?? '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const w of whole) {
    const match = canonical(options, w);
    if (match) {
      if (!includesChoice(out, match)) out.push(match);
      continue;
    }
    for (const p of w.split(/\s+and\s+|\s*&\s*/i).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      const value = canonical(options, p) ?? p;
      if (!includesChoice(out, value)) out.push(value);
    }
  }
  return out;
}

/** Maps legacy stored curricula onto the catalogue: 'IB' meant the IB Diploma before round 4. */
export function modernCurriculum(value?: string): string | undefined {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return undefined;
  if (v.toLowerCase() === 'ib') return 'IB DP';
  if (v.toLowerCase() === 'other') return undefined;
  return v;
}

/** Whether a tutor's curricula cover the given curriculum (true when no curriculum is given). 'IB' and 'IB DP' match. */
export function teachesCurriculum(curricula: readonly string[] | undefined, curriculum?: string): boolean {
  const want = modernCurriculum(curriculum);
  if (!want) return true;
  return (curricula ?? []).some((c) => norm(modernCurriculum(c)) === norm(want));
}

/** Subject, phase and curriculum for a subtitle: 'Chemistry · GCSE and IGCSE · IGCSE'. */
export function subjectLine(x: { subject?: string; phase?: string; curriculum?: string }, sep = ' · '): string {
  return [x.subject, x.phase, x.curriculum].map((v) => v?.trim()).filter(Boolean).join(sep);
}
