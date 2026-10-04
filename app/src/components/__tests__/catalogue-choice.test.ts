import { CURRICULA, OTHER, SUBJECTS } from '@/domain/catalogue';

import {
  addOther,
  canonical,
  choiceState,
  freeTextValues,
  hasMore,
  includesChoice,
  modernCurriculum,
  splitSubjects,
  subjectLine,
  teachesCurriculum,
  toggleMulti,
  visibleOptions,
} from '../catalogue-choice';
import { teachingFromApplication } from '../hiring';

const OPTS = ['Maths', 'English', 'Chemistry', 'Arabic', 'History'] as const;

describe('choiceState', () => {
  it('returns nothing selected for an empty value', () => {
    expect(choiceState(OPTS, undefined)).toEqual({ selected: undefined, otherText: '' });
    expect(choiceState(OPTS, '   ')).toEqual({ selected: undefined, otherText: '' });
  });
  it('matches options case-insensitively and returns the catalogue spelling', () => {
    expect(choiceState(OPTS, ' chemistry ')).toEqual({ selected: 'Chemistry', otherText: '' });
  });
  it('treats anything else as Other', () => {
    expect(choiceState(OPTS, 'Latin')).toEqual({ selected: OTHER, otherText: 'Latin' });
  });
});

describe('visibleOptions', () => {
  it('shows everything when not collapsed or when expanded', () => {
    expect(visibleOptions(OPTS, undefined, undefined, false)).toEqual([...OPTS]);
    expect(visibleOptions(OPTS, undefined, 2, true)).toEqual([...OPTS]);
  });
  it('shows the first N options', () => {
    expect(visibleOptions(OPTS, undefined, 2, false)).toEqual(['Maths', 'English']);
  });
  it('always includes the current value', () => {
    expect(visibleOptions(OPTS, 'history', 2, false)).toEqual(['Maths', 'English', 'History']);
    expect(visibleOptions(OPTS, ['Arabic', 'Maths'], 2, false)).toEqual(['Maths', 'English', 'Arabic']);
  });
  it('reports whether more are hidden', () => {
    expect(hasMore(OPTS, 2, false)).toBe(true);
    expect(hasMore(OPTS, 2, true)).toBe(false);
    expect(hasMore(OPTS, 10, false)).toBe(false);
    expect(hasMore(OPTS, undefined, false)).toBe(false);
  });
});

describe('toggleMulti', () => {
  it('adds and removes, ignoring case', () => {
    expect(toggleMulti(['Maths'], 'English')).toEqual(['Maths', 'English']);
    expect(toggleMulti(['Maths', 'English'], 'maths')).toEqual(['English']);
    expect(toggleMulti(['Maths'], '  ')).toEqual(['Maths']);
  });
});

describe('addOther', () => {
  it('trims and ignores blanks', () => {
    expect(addOther(['Maths'], '  Latin  ')).toEqual(['Maths', 'Latin']);
    expect(addOther(['Maths'], '   ')).toEqual(['Maths']);
  });
  it('ignores case-insensitive duplicates', () => {
    expect(addOther(['Latin'], 'latin')).toEqual(['Latin']);
  });
  it('uses the catalogue spelling when the text matches an option', () => {
    expect(addOther([], 'ib dp', CURRICULA)).toEqual(['IB DP']);
  });
});

describe('helpers', () => {
  it('finds canonical spellings and free-text values', () => {
    expect(canonical(SUBJECTS, 'further maths')).toBe('Further Maths');
    expect(canonical(SUBJECTS, 'Latin')).toBeUndefined();
    expect(freeTextValues(OPTS, ['Maths', 'Latin'])).toEqual(['Latin']);
    expect(includesChoice(['Maths'], 'MATHS')).toBe(true);
  });
  it('splits a typed subject list into catalogue values', () => {
    expect(splitSubjects('chemistry; English Literature and arabic, Latin', SUBJECTS)).toEqual([
      'Chemistry',
      'English Literature',
      'Arabic',
      'Latin',
    ]);
    expect(splitSubjects('Phonics and reading, Maths, maths', SUBJECTS)).toEqual(['Phonics and reading', 'Maths']);
    expect(splitSubjects('', SUBJECTS)).toEqual([]);
  });
});

describe('curriculum helpers', () => {
  it('maps legacy IB to IB DP and drops Other', () => {
    expect(modernCurriculum('IB')).toBe('IB DP');
    expect(modernCurriculum(' IGCSE ')).toBe('IGCSE');
    expect(modernCurriculum('Other')).toBeUndefined();
    expect(modernCurriculum('')).toBeUndefined();
  });
  it('checks tutor curricula, treating IB as IB DP', () => {
    expect(teachesCurriculum(['IB', 'IGCSE'], 'IB DP')).toBe(true);
    expect(teachesCurriculum(['IGCSE'], 'A-Level')).toBe(false);
    expect(teachesCurriculum([], undefined)).toBe(true);
  });
  it('builds a subject line', () => {
    expect(subjectLine({ subject: 'Chemistry', curriculum: 'IGCSE' })).toBe('Chemistry · IGCSE');
    expect(subjectLine({})).toBe('');
    expect(subjectLine({ subject: 'Physics', phase: 'GCSE and IGCSE', curriculum: 'IGCSE' })).toBe('Physics · IGCSE');
    expect(subjectLine({ subject: 'Maths', phase: 'GCSE and IGCSE', curriculum: 'A-Level' })).toBe('Maths · GCSE and IGCSE · A-Level');
    expect(subjectLine({ subject: 'English', phase: 'Primary', curriculum: 'British' })).toBe('English · Primary · British');
  });
});

describe('teachingFromApplication', () => {
  it('maps an application onto tutor subjects, curricula and phases', () => {
    expect(teachingFromApplication({ subjects: 'chemistry; Biology and physics, Latin', curricula: ['IB', 'igcse'], phases: ['GCSE and IGCSE'] })).toEqual({
      subjects: ['Chemistry', 'Biology', 'Physics', 'Latin'],
      curricula: ['IB DP', 'IGCSE'],
      phases: ['GCSE and IGCSE'],
    });
    expect(teachingFromApplication({ curricula: [] })).toEqual({ subjects: [], curricula: [], phases: [] });
  });
});
