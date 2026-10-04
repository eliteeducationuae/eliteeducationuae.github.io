import { adminSummary, countWords, greeting, greetingLine, joinNames } from '../greeting';

const at = (h: number, m: number) => new Date(2026, 9, 6, h, m);

describe('greeting', () => {
  it.each([
    [0, 30, 'Good morning'],
    [11, 59, 'Good morning'],
    [12, 0, 'Good afternoon'],
    [17, 59, 'Good afternoon'],
    [18, 0, 'Good evening'],
    [23, 45, 'Good evening'],
  ] as const)('%i:%i is %s', (h, m, expected) => {
    expect(greeting(at(h, m))).toBe(expected);
  });
});

describe('greetingLine', () => {
  it('addresses the person by name', () => {
    expect(greetingLine(at(14, 0), 'Craig')).toBe('Good afternoon, Craig');
    expect(greetingLine(at(19, 0), 'Fatima Al Mansoori')).toBe('Good evening, Fatima Al Mansoori');
  });

  it('falls back to the greeting alone without a name', () => {
    expect(greetingLine(at(9, 0), '  ')).toBe('Good morning');
    expect(greetingLine(at(9, 0))).toBe('Good morning');
  });
});

describe('countWords', () => {
  it('spells out small numbers and keeps digits for larger ones', () => {
    expect(countWords(0, 'lesson')).toBe('no lessons');
    expect(countWords(1, 'lesson')).toBe('one lesson');
    expect(countWords(3, 'lesson')).toBe('three lessons');
    expect(countWords(12, 'enquiry', 'enquiries')).toBe('12 enquiries');
  });
});

describe('adminSummary', () => {
  it('summarises the day in a full sentence', () => {
    expect(adminSummary(3, 4)).toBe('You have three lessons today and four items that need your attention.');
    expect(adminSummary(1, 1)).toBe('You have one lesson today and one item that needs your attention.');
    expect(adminSummary(0, 0)).toBe('You have no lessons today, and nothing needs your attention.');
  });
});

describe('joinNames', () => {
  it('joins names for prose', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Aisha'])).toBe('Aisha');
    expect(joinNames(['Aisha', 'Omar'])).toBe('Aisha and Omar');
    expect(joinNames(['Aisha', 'Omar', 'Layla'])).toBe('Aisha, Omar and Layla');
  });
});
