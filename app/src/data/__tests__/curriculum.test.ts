import { builtInSyllabusesFor, getSyllabus, SYLLABUSES } from '../curriculum';

describe('built-in syllabuses', () => {
  it('describe their subject, curriculum, level and exam board', () => {
    expect(getSyllabus('ib-aa-hl')).toMatchObject({ subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB' });
    expect(getSyllabus('igcse-0606')).toMatchObject({ subject: 'Additional Maths', curriculum: 'IGCSE', examBoard: 'Cambridge' });
    expect(getSyllabus('alevel-maths')).toMatchObject({ subject: 'Maths', curriculum: 'A-Level' });
    expect(getSyllabus('alevel-maths')?.level).toBeUndefined();
    expect(SYLLABUSES.every((s) => !!s.subject)).toBe(true);
  });

  it('are found by subject, optionally limited to a curriculum', () => {
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(builtInSyllabusesFor('maths'))).toEqual(['ib-aa-sl', 'ib-aa-hl', 'ib-ai-sl', 'ib-ai-hl', 'igcse-4ma1', 'igcse-0580', 'alevel-maths']);
    expect(ids(builtInSyllabusesFor('Maths', 'IGCSE'))).toEqual(['igcse-4ma1', 'igcse-0580']);
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
