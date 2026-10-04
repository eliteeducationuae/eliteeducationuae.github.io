import { builtInSyllabusesFor, courseStillFits, enrolmentFieldsFor, getSyllabus, resolveBuiltInSyllabus, SYLLABUSES } from '../curriculum';
import { addChildSubjects } from '../rpc-mapping';

describe('built-in syllabuses', () => {
  it('describe their subject, curriculum, level and exam board', () => {
    expect(getSyllabus('ib-aa-hl')).toMatchObject({ subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB' });
    expect(getSyllabus('igcse-0606')).toMatchObject({ subject: 'Maths', level: 'Additional', curriculum: 'IGCSE', examBoard: 'Cambridge' });
    expect(getSyllabus('alevel-maths')).toMatchObject({ subject: 'Maths', curriculum: 'A-Level' });
    expect(getSyllabus('alevel-maths')?.level).toBeUndefined();
    expect(SYLLABUSES.every((s) => !!s.subject)).toBe(true);
  });

  it('are found by subject, optionally limited to a curriculum', () => {
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(builtInSyllabusesFor('maths'))).toEqual(['ib-aa-sl', 'ib-aa-hl', 'ib-ai-sl', 'ib-ai-hl', 'igcse-4ma1', 'igcse-0580', 'igcse-0606', 'alevel-maths']);
    expect(ids(builtInSyllabusesFor('Maths', 'IGCSE'))).toEqual(['igcse-4ma1', 'igcse-0580', 'igcse-0606']);
    expect(ids(builtInSyllabusesFor('Additional Maths', 'igcse'))).toEqual(['igcse-0606']);
    expect(ids(builtInSyllabusesFor('Chemistry'))).toEqual([]);
    expect(ids(builtInSyllabusesFor(undefined))).toEqual([]);
  });

  it('read the legacy curriculum "IB" as "IB DP"', () => {
    expect(builtInSyllabusesFor('Maths', 'IB').map((s) => s.id)).toEqual(['ib-aa-sl', 'ib-aa-hl', 'ib-ai-sl', 'ib-ai-hl']);
    expect(builtInSyllabusesFor('Maths', 'IB DP')).toHaveLength(4);
    expect(builtInSyllabusesFor('Maths', 'British')).toEqual([]);
  });
});

describe('resolveBuiltInSyllabus', () => {
  const id = (e: Parameters<typeof resolveBuiltInSyllabus>[0]) => resolveBuiltInSyllabus(e)?.id;

  it('keeps a requested course only when it fits the subject and curriculum', () => {
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', syllabusId: 'igcse-4ma1' })).toBe('igcse-4ma1');
    expect(id({ subject: 'Maths', syllabusId: 'ib-aa-hl' })).toBe('ib-aa-hl');
    expect(id({ subject: 'Chemistry', curriculum: 'IGCSE', syllabusId: 'igcse-0580' })).toBeUndefined();
    expect(id({ subject: 'Maths', curriculum: 'A-Level', syllabusId: 'igcse-0580' })).toBe('alevel-maths');
  });

  it('drops a requested course when the level or exam board given beside it contradicts it', () => {
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', examBoard: 'Cambridge', syllabusId: 'igcse-4ma1' })).toBe('igcse-0580');
    expect(id({ subject: 'Maths', curriculum: 'IB DP', level: 'AI SL', syllabusId: 'ib-aa-hl' })).toBe('ib-ai-sl');
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', level: 'Additional', syllabusId: 'igcse-0580' })).toBe('igcse-0606');
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', level: 'Extended', examBoard: 'cambridge', syllabusId: 'igcse-0580' })).toBe('igcse-0580');
  });

  it('finds the single course that matches, and guesses nothing when two fit', () => {
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', examBoard: 'Pearson Edexcel' })).toBe('igcse-4ma1');
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', examBoard: 'Cambridge' })).toBe('igcse-0580');
    expect(id({ subject: 'Maths', curriculum: 'IGCSE', level: 'Additional' })).toBe('igcse-0606');
    expect(id({ subject: 'Additional Maths', curriculum: 'IGCSE' })).toBe('igcse-0606');
    expect(id({ subject: 'maths', curriculum: 'IB', level: 'aa hl' })).toBe('ib-aa-hl');
    expect(id({ subject: 'Maths', curriculum: 'A-Level', examBoard: 'AQA' })).toBe('alevel-maths');
    expect(id({ subject: 'Maths', curriculum: 'IGCSE' })).toBeUndefined();
    expect(id({ subject: 'Maths' })).toBeUndefined();
  });

  it('gives a chosen course the curriculum, level and exam board the backfill uses', () => {
    const aaHl = SYLLABUSES.find((s) => s.id === 'ib-aa-hl')!;
    expect(enrolmentFieldsFor(aaHl, 'Maths')).toEqual({ curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB', syllabusId: 'ib-aa-hl' });
    const add = SYLLABUSES.find((s) => s.id === 'igcse-0606')!;
    expect(enrolmentFieldsFor(add, 'Additional Maths')).toEqual({ curriculum: 'IGCSE', level: undefined, examBoard: 'Cambridge', syllabusId: 'igcse-0606' });
  });
});

describe('courseStillFits', () => {
  const draft = { subject: 'Maths', curriculum: 'IGCSE', examBoard: 'Pearson Edexcel', syllabusId: 'igcse-4ma1' };

  it('clears a course that a new exam board or level contradicts', () => {
    expect(courseStillFits(draft, { examBoard: 'Cambridge' })).toBeUndefined();
    expect(courseStillFits({ subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB', syllabusId: 'ib-aa-hl' }, { level: 'AI SL' })).toBeUndefined();
  });

  it('keeps a course that still agrees', () => {
    expect(courseStillFits(draft, { level: 'Higher' })).toBe('igcse-4ma1');
    expect(courseStillFits(draft, { examBoard: undefined })).toBe('igcse-4ma1');
    expect(courseStillFits({ ...draft, syllabusId: undefined }, { level: 'Higher' })).toBeUndefined();
  });
});

describe('addChildSubjects', () => {
  it('sends snake_case keys, trimmed, with blanks left out', () => {
    expect(addChildSubjects([{ subject: ' Maths ', curriculum: 'IGCSE', syllabusId: ' igcse-4ma1 ', examBoard: '' }])).toEqual([
      { subject: 'Maths', curriculum: 'IGCSE', syllabus_id: 'igcse-4ma1' },
    ]);
  });
});
