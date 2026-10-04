import type { Syllabus } from '../progress';
import { buildTopicLookup, DEFAULT_UNIT } from '../topics';
import type { Topic, TopicList } from '../types';

const builtIn: Syllabus = {
  id: 'ib-aa-hl',
  name: 'IB Maths AA HL',
  subject: 'Maths',
  curriculum: 'IB DP',
  level: 'AA HL',
  units: [
    { id: 'u-alg', name: 'Algebra', topics: [{ id: 'aa-seq', name: 'Sequences' }] },
    { id: 'u-calc', name: 'Calculus', topics: [{ id: 'aa-diff', name: 'Differentiation' }] },
  ],
};

const lists: TopicList[] = [
  { id: 'tl-maths', subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', name: 'IB DP Maths (AA HL)' },
  { id: 'tl-chem', subject: 'Chemistry', curriculum: 'IGCSE', name: 'IGCSE Chemistry' },
];

const topics: Topic[] = [
  { id: 't-proof', listId: 'tl-maths', unit: 'algebra', name: 'Proof by induction', sort: 1 },
  { id: 't-ia', listId: 'tl-maths', unit: 'Internal Assessment', name: 'Choosing a topic', sort: 2 },
  { id: 't-mole', listId: 'tl-chem', unit: 'Stoichiometry', name: 'The mole', sort: 3 },
  { id: 't-elec', listId: 'tl-chem', name: 'Electrolysis', sort: 4 },
  { id: 't-atoms', listId: 'tl-chem', unit: 'Atoms', name: 'Atomic structure', sort: 1 },
  { id: 't-mass', listId: 'tl-chem', unit: 'Stoichiometry', name: 'Reacting masses', sort: 5 },
];

describe('buildTopicLookup', () => {
  const lookup = buildTopicLookup([builtIn], lists, topics);

  it('names built-in and stored topics, falling back to the id', () => {
    expect(lookup.name('aa-seq')).toBe('Sequences');
    expect(lookup.name('t-mole')).toBe('The mole');
    expect(lookup.name('unknown-id')).toBe('unknown-id');
    // A stored topic that has not loaded never shows its raw id to families.
    expect(lookup.name('0b5c8a52-2f7e-4c1a-9d3e-6a1f2b3c4d5e')).toBe('Topic');
    expect(lookup.unit('aa-diff')).toBe('Calculus');
    expect(lookup.unit('t-mole')).toBe('Stoichiometry');
    expect(lookup.unit('t-elec')).toBeUndefined();
  });

  it('finds a built-in syllabus for records made before subjects existed', () => {
    expect(lookup.builtIn('ib-aa-hl')?.name).toBe('IB Maths AA HL');
    expect(lookup.builtIn('missing')).toBeUndefined();
    expect(lookup.builtIn(undefined)).toBeUndefined();
  });

  it('knows each topic’s subject', () => {
    expect(lookup.subjectOf('aa-diff')).toBe('Maths');
    expect(lookup.subjectOf('t-mole')).toBe('Chemistry');
    expect(lookup.subjectOf('nope')).toBeUndefined();
  });

  it('adds stored topics to a built-in tree: into a matching unit, or a new one', () => {
    const tree = lookup.treeFor({ subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', syllabusId: 'ib-aa-hl', topicListId: 'tl-maths' });
    expect(tree).toMatchObject({ id: 'ib-aa-hl', name: 'IB Maths AA HL', curriculum: 'IB DP', subject: 'Maths' });
    expect(tree.units.map((u) => [u.name, u.topics.map((t) => t.id)])).toEqual([
      ['Algebra', ['aa-seq', 't-proof']],
      ['Calculus', ['aa-diff']],
      ['Internal Assessment', ['t-ia']],
    ]);
    expect(tree.units[2].id).toBe('tl-maths:internal assessment');
    // The built-in syllabus itself is left untouched.
    expect(builtIn.units[0].topics).toHaveLength(1);
  });

  it('groups a custom list by unit in sort order, with "Topics" for topics without a unit', () => {
    const tree = lookup.treeFor({ subject: 'Chemistry', curriculum: 'IGCSE', topicListId: 'tl-chem' });
    expect(tree).toMatchObject({ id: 'tl-chem', name: 'IGCSE Chemistry', curriculum: 'IGCSE', subject: 'Chemistry' });
    expect(tree.units.map((u) => [u.name, u.topics.map((t) => t.name)])).toEqual([
      ['Atoms', ['Atomic structure']],
      ['Stoichiometry', ['The mole', 'Reacting masses']],
      [DEFAULT_UNIT, ['Electrolysis']],
    ]);
  });

  it('finds the shared list by subject, curriculum and level when the enrolment has no list yet', () => {
    const tree = lookup.treeFor({ subject: ' chemistry', curriculum: 'igcse' });
    expect(tree.id).toBe('custom:chemistry|igcse|');
    expect(tree.units.flatMap((u) => u.topics).map((t) => t.id)).toEqual(['t-atoms', 't-mole', 't-mass', 't-elec']);
  });

  it('returns an empty tree for a subject with no topics yet', () => {
    const tree = lookup.treeFor({ subject: 'Arabic' });
    expect(tree).toEqual({ id: 'custom:arabic||', name: 'Arabic', curriculum: '', subject: 'Arabic', level: undefined, units: [] });
  });
});
