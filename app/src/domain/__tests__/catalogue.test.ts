import { CURRICULA, EXAM_BOARDS, LEVELS, OTHER, PHASES, SUBJECTS, cleanChoice, inCatalogue } from '../catalogue';

describe('catalogue', () => {
  it.each([
    ['SUBJECTS', SUBJECTS],
    ['PHASES', PHASES],
    ['CURRICULA', CURRICULA],
    ['LEVELS', LEVELS],
    ['EXAM_BOARDS', EXAM_BOARDS],
  ])('%s has no duplicates, blanks or "Other"', (_name, list) => {
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((x) => x.toLowerCase())).size).toBe(list.length);
    for (const x of list) {
      expect(x).toBe(x.trim());
      expect(x).not.toBe('');
      expect(x.toLowerCase()).not.toBe(OTHER.toLowerCase());
    }
  });

  it('covers every subject, phase and curriculum we teach', () => {
    expect(SUBJECTS).toEqual(expect.arrayContaining(['Maths', 'English', 'Chemistry', 'Arabic', 'Primary (all subjects)']));
    expect(PHASES).toEqual(expect.arrayContaining(['Primary', 'GCSE and IGCSE', 'Sixth Form and IB Diploma']));
    expect(CURRICULA).toEqual(expect.arrayContaining(['British', 'IB PYP', 'IB MYP', 'IB DP', 'American', 'Indian CBSE', 'Indian ICSE', 'French', 'UAE MoE']));
  });

  it('matches catalogue values ignoring case and outer spaces', () => {
    expect(inCatalogue(SUBJECTS, ' chemistry ')).toBe(true);
    expect(inCatalogue(CURRICULA, 'ib dp')).toBe(true);
    expect(inCatalogue(SUBJECTS, 'Astrophysics')).toBe(false);
    expect(inCatalogue(SUBJECTS, '')).toBe(false);
    expect(inCatalogue(SUBJECTS, undefined)).toBe(false);
  });

  it('tidies typed choices', () => {
    expect(cleanChoice('  Marine   Biology ')).toBe('Marine Biology');
    expect(cleanChoice('   ')).toBeUndefined();
    expect(cleanChoice('')).toBeUndefined();
    expect(cleanChoice(undefined)).toBeUndefined();
  });
});
