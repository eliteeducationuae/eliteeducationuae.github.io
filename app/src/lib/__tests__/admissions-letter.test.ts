import {
  admissionsFacts,
  admissionsLetterInstructions,
  letterSalutation,
  letterSignOff,
  salutationName,
  typographic,
} from '../../../supabase/functions/_shared/admissions-letter';

describe('admissions letter salutation', () => {
  it('uses a recorded title with the surname, else the first name, else Parents', () => {
    expect(salutationName('Mrs Fatima Al Mansoori')).toBe('Mrs Al Mansoori');
    expect(salutationName('Dr. Khan')).toBe('Dr Khan');
    expect(salutationName('Sheikha Mariam Al Nahyan')).toBe('Sheikha Al Nahyan');
    expect(salutationName('Fatima Al Mansoori')).toBe('Fatima');
    expect(salutationName('  ')).toBe('Parents');
    expect(salutationName(undefined)).toBe('Parents');
    expect(salutationName('Mrs')).toBe('Parents');
    expect(letterSalutation('Mona Ahmed')).toBe('Dear Mona,');
  });
  it('signs off as the adviser, or as the admissions team for office-led cases', () => {
    expect(letterSignOff('Sarah Khan')).toBe('With kind regards,\nSarah Khan\nAdmissions Adviser, Elite Education');
    expect(letterSignOff(null)).toBe('With kind regards,\nThe Admissions Team\nElite Education');
    expect(letterSignOff('Elite Education')).toBe('With kind regards,\nThe Admissions Team\nElite Education');
  });
  it('uses typographic apostrophes', () => {
    expect(typographic("Omar's offer and the parents' evening")).toBe('Omar’s offer and the parents’ evening');
    expect(typographic('No quotes here')).toBe('No quotes here');
  });
});

describe('admissions AI facts', () => {
  const base = {
    today: '2026-10-05',
    studentFirstName: 'Omar',
    caseInfo: { title: 'UK universities', kind: 'uk-university', entryYear: '2027', status: 'active', summary: null },
    targets: [],
    keyDates: [],
    tasks: [{ title: 'Send report', due_on: null, owner: 'family', done_at: null }],
  };
  it('never passes adviser-only timeline entries to the model', () => {
    const facts = admissionsFacts({
      ...base,
      events: [
        { at: '2026-10-01T09:00:00Z', kind: 'document', title: 'Document added: Year 12 report', family_visible: true },
        { at: '2026-10-02T09:00:00Z', kind: 'document', title: 'Document added: Confidential reference from Mr Hale', family_visible: false },
        { at: '2026-10-03T09:00:00Z', kind: 'note', title: 'Unknown visibility' },
      ],
    });
    expect(facts.recentTimeline.map((e) => e.title)).toEqual(['Document added: Year 12 report']);
    expect(JSON.stringify(facts)).not.toContain('Confidential');
    expect(facts.tasks).toEqual([{ title: 'Send report', dueOn: null, owner: 'family', done: false }]);
  });
  it('tells the model who writes, how to open and close, and what to leave out', () => {
    const named = admissionsLetterInstructions({ kind: 'monthly', studentFirstName: 'Omar', parentName: 'Mrs Fatima Al Mansoori', adviser: 'Sarah Khan' });
    expect(named).toContain('Only mention information the family is entitled to see.');
    expect(named).toContain('on behalf of Sarah Khan, their admissions adviser');
    expect(named).toContain('"Dear Mrs Al Mansoori,"');
    expect(named).toContain(letterSignOff('Sarah Khan'));
    expect(named).toContain('Never use placeholders');
    const office = admissionsLetterInstructions({ kind: 'ad-hoc', studentFirstName: 'Layla', parentName: null, adviser: null });
    expect(office).toContain('on behalf of the admissions team');
    expect(office).toContain('"Dear Parents,"');
    expect(office).toContain(letterSignOff(null));
  });
});
