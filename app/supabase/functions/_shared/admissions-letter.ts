// Pure helpers for admissions advisory letters, shared by the ai-assist Edge Function and the app's template letter
// (src/domain/admissions.ts), so the AI draft and the template open, sign off and read the same way.
//
// This file deliberately has no imports and uses no Deno globals, so the Edge Functions, Jest and the app's
// TypeScript check can all compile it. Keep it that way.

/** Titles that may begin a parent's recorded name. */
const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Dr', 'Prof', 'Professor', 'Sir', 'Dame', 'Lady', 'Lord', 'Sheikh', 'Sheikha', 'HE', 'HH'];

/**
 * The letter's salutation, without 'Dear'. A recorded title gives the formal 'Mrs Al Mansoori'; a plain name gives the
 * first name only ('Fatima'), never the full name; no name gives 'Parents'.
 */
export function salutationName(parentName: string | null | undefined): string {
  const words = (parentName ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return 'Parents';
  const title = TITLES.find((t) => t.toLowerCase() === words[0].replace(/\.$/, '').toLowerCase());
  if (title) {
    // 'Mrs Fatima Al Mansoori' → 'Mrs Al Mansoori'; 'Dr Khan' → 'Dr Khan'; a bare title falls back to 'Parents'.
    const rest = words.slice(1);
    if (rest.length === 0) return 'Parents';
    return `${title} ${rest.length > 1 ? rest.slice(1).join(' ') : rest[0]}`;
  }
  return words[0];
}

/** 'Dear Mrs Al Mansoori,' / 'Dear Fatima,' / 'Dear Parents,'. */
export function letterSalutation(parentName: string | null | undefined): string {
  return `Dear ${salutationName(parentName)},`;
}

/** The sign-off every advisory letter ends with: the adviser by name, or the admissions team for office-led cases. */
export function letterSignOff(adviser: string | null | undefined): string {
  const name = adviser?.trim();
  return name && name !== 'Elite Education'
    ? `With kind regards,\n${name}\nAdmissions Adviser, Elite Education`
    : 'With kind regards,\nThe Admissions Team\nElite Education';
}

/** Typographic apostrophes for printed and on-screen letters: "Omar's" → "Omar’s", "parents'" → "parents’". */
export function typographic(text: string): string {
  return text.replace(/(\p{L})'(?=\p{L}|\s|$|[.,;:!?)])/gu, '$1’');
}

export interface AdmissionsFactsInput {
  today: string;
  studentFirstName: string;
  caseInfo: { title: string; kind: string; entryYear: string | null; status: string; summary: string | null };
  targets: unknown[];
  keyDates: unknown[];
  tasks: { title: string; due_on: string | null; owner: string; done_at: string | null }[];
  events: { at: string; kind: string; title: string; detail?: string | null; family_visible?: boolean | null }[];
}

/**
 * The facts the model may use for a family-facing letter. Timeline entries the family cannot see (confidential
 * references, adviser-only documents) are left out here as well as in the query, so they can never reach the letter.
 */
export function admissionsFacts(input: AdmissionsFactsInput) {
  return {
    today: input.today,
    student: input.studentFirstName,
    case: input.caseInfo,
    shortlist: input.targets,
    keyDates: input.keyDates,
    tasks: input.tasks.map((t) => ({ title: t.title, dueOn: t.due_on, owner: t.owner, done: !!t.done_at })),
    recentTimeline: input.events
      .filter((e) => e.family_visible === true)
      .map((e) => ({ at: e.at, kind: e.kind, title: e.title, detail: e.detail ?? null })),
  };
}

/** The instructions for an advisory letter: who writes it, to whom, how it opens and closes, and what it must never say. */
export function admissionsLetterInstructions(input: {
  kind: 'monthly' | 'ad-hoc';
  studentFirstName: string;
  parentName?: string | null;
  adviser?: string | null;
}): string {
  const salutation = letterSalutation(input.parentName);
  const signOff = letterSignOff(input.adviser);
  const writer = input.adviser?.trim() && input.adviser.trim() !== 'Elite Education' ? `${input.adviser.trim()}, their admissions adviser` : 'the admissions team';
  return (
    `You write a ${input.kind === 'monthly' ? 'monthly' : 'short ad hoc'} admissions advisory update to the family of ${input.studentFirstName}, ` +
    `on behalf of ${writer} at Elite Education. Summarise progress, decisions, upcoming deadlines and what the family needs to do next. ` +
    `Only mention information the family is entitled to see. ` +
    `Never invent institutions, dates, outcomes or advice that are not in the facts, and never mention fees or payments. ` +
    `Times are UAE time; say so when you give one. ` +
    `Open the body with exactly "${salutation}" on its own line and close it with exactly this sign-off, line for line:\n${signOff}\n` +
    `Separate paragraphs with a blank line. Never use placeholders such as [Your name] or square brackets of any kind. ` +
    `The adviser will review and edit it before it is sent.`
  );
}
