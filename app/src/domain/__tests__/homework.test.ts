import {
  attachmentKindLabel,
  classworkFolder,
  dueDateChoices,
  dueLabel,
  fileAttachment,
  filterResources,
  HOMEWORK_STATUS_LABEL,
  homeworkStatus,
  isImageAttachment,
  latestSubmission,
  lessonHomeworkWarning,
  linkAttachment,
  normaliseLink,
  parseTags,
  resourceAttachment,
  resourceFacets,
  resourceMeta,
  shouldDiscardUpload,
} from '../homework';
import type { Homework, HomeworkSubmission, Resource } from '../types';

const hw = (over: Partial<Homework> = {}): Homework => ({ id: 'hw1', studentId: 's1', title: 'Essay', dueDate: '2026-10-10', done: false, ...over });
const sub = (over: Partial<HomeworkSubmission> = {}): HomeworkSubmission => ({
  id: 'sub1',
  homeworkId: 'hw1',
  studentId: 's1',
  files: [],
  submittedAt: '2026-10-05T10:00:00.000Z',
  ...over,
});
const res = (over: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  title: 'Calculus booklet',
  kind: 'file',
  path: 'resources/calc.pdf',
  tags: [],
  visibility: 'tutors',
  studentIds: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('latestSubmission', () => {
  it('returns the newest hand-in for that homework only', () => {
    const subs = [
      sub({ id: 'a', submittedAt: '2026-10-05T10:00:00.000Z' }),
      sub({ id: 'b', submittedAt: '2026-10-06T10:00:00.000Z' }),
      sub({ id: 'c', homeworkId: 'other', submittedAt: '2026-10-09T10:00:00.000Z' }),
    ];
    expect(latestSubmission(subs, 'hw1')?.id).toBe('b');
    expect(latestSubmission(subs, 'none')).toBeUndefined();
    expect(latestSubmission([], 'hw1')).toBeUndefined();
  });
});

describe('homeworkStatus', () => {
  const today = '2026-10-08';
  it('prefers feedback, then a hand-in, then done', () => {
    expect(homeworkStatus(hw(), [sub({ feedback: 'Good' })], today)).toBe('reviewed');
    expect(homeworkStatus(hw(), [sub()], today)).toBe('submitted');
    expect(homeworkStatus(hw({ done: true }), [], today)).toBe('done');
  });
  it('uses the latest hand-in, so a resubmission awaits feedback again', () => {
    const subs = [sub({ id: 'a', feedback: 'Redo', submittedAt: '2026-10-05T00:00:00Z' }), sub({ id: 'b', submittedAt: '2026-10-06T00:00:00Z' })];
    expect(homeworkStatus(hw(), subs, today)).toBe('submitted');
  });
  it('is overdue only after the due date', () => {
    expect(homeworkStatus(hw({ dueDate: '2026-10-07' }), [], today)).toBe('overdue');
    expect(homeworkStatus(hw({ dueDate: '2026-10-08' }), [], today)).toBe('due');
    expect(homeworkStatus(hw({ dueDate: '2026-10-07' }), [], '2026-10-07')).toBe('due');
    expect(homeworkStatus(hw({ dueDate: '2026-10-01', done: true }), [], today)).toBe('done');
    expect(homeworkStatus(hw(), [sub({ homeworkId: 'other' })], today)).toBe('due');
  });
  it('has a label for every status', () => {
    expect(Object.values(HOMEWORK_STATUS_LABEL).map((s) => s.label)).toEqual(['Feedback given', 'Handed in', 'Done', 'Overdue', 'To do']);
  });
});

describe('normaliseLink', () => {
  it('accepts http and https and adds https when missing', () => {
    expect(normaliseLink('  https://www.bbc.co.uk/bitesize  ')).toBe('https://www.bbc.co.uk/bitesize');
    expect(normaliseLink('http://example.org')).toBe('http://example.org');
    expect(normaliseLink('HTTPS://Example.org/A?b=1#c')).toBe('https://Example.org/A?b=1#c');
    expect(normaliseLink('bbc.co.uk/bitesize')).toBe('https://bbc.co.uk/bitesize');
    expect(normaliseLink('example.org:8080/x')).toBe('https://example.org:8080/x');
  });
  it('rejects other schemes, spaces and hosts without a dot', () => {
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('JavaScript:alert(1)')).toBeNull();
    expect(normaliseLink('mailto:a@b.com')).toBeNull();
    expect(normaliseLink('ftp://example.org')).toBeNull();
    expect(normaliseLink('data:text/html,hi')).toBeNull();
    expect(normaliseLink('https://exa mple.org')).toBeNull();
    expect(normaliseLink('two words.com')).toBeNull();
    expect(normaliseLink('localhost')).toBeNull();
    expect(normaliseLink('https://localhost/x')).toBeNull();
    expect(normaliseLink('https://example..org')).toBeNull();
    expect(normaliseLink('https://user@evil.com')).toBeNull();
    expect(normaliseLink('')).toBeNull();
    expect(normaliseLink('   ')).toBeNull();
    expect(normaliseLink('https://')).toBeNull();
  });
});

describe('attachments', () => {
  it('builds link, file and resource attachments', () => {
    expect(linkAttachment('https://www.bbc.co.uk/bitesize/')).toEqual({ kind: 'link', name: 'www.bbc.co.uk/bitesize', url: 'https://www.bbc.co.uk/bitesize/' });
    expect(linkAttachment('https://x.org', ' Notes ')).toEqual({ kind: 'link', name: 'Notes', url: 'https://x.org' });
    expect(fileAttachment('students/s1/a.pdf', 'a.pdf', 'application/pdf')).toEqual({ kind: 'file', name: 'a.pdf', path: 'students/s1/a.pdf', mimeType: 'application/pdf' });
    expect(fileAttachment('students/s1/a.pdf', 'a.pdf')).toEqual({ kind: 'file', name: 'a.pdf', path: 'students/s1/a.pdf' });
    expect(resourceAttachment(res({ mimeType: 'application/pdf' }))).toEqual({ kind: 'file', name: 'Calculus booklet', path: 'resources/calc.pdf', resourceId: 'r1', mimeType: 'application/pdf' });
    expect(resourceAttachment(res({ kind: 'link', path: undefined, url: 'https://x.org' }))).toEqual({ kind: 'link', name: 'Calculus booklet', url: 'https://x.org', resourceId: 'r1' });
  });
  it('recognises photos by type or extension', () => {
    expect(isImageAttachment({ kind: 'file', name: 'scan', path: 'students/s1/scan', mimeType: 'image/heic' })).toBe(true);
    for (const ext of ['jpg', 'JPEG', 'png', 'heic', 'webp', 'gif']) {
      expect(isImageAttachment({ kind: 'file', name: `a.${ext}`, path: `students/s1/a.${ext}` })).toBe(true);
    }
    expect(isImageAttachment({ kind: 'file', name: 'a.pdf', path: 'students/s1/a.pdf' })).toBe(false);
    expect(isImageAttachment({ kind: 'link', name: 'a.png', url: 'https://x.org/a.png' })).toBe(false);
  });
  it('labels each kind', () => {
    expect(attachmentKindLabel({ kind: 'link', name: 'x', url: 'https://x.org' })).toBe('Link');
    expect(attachmentKindLabel({ kind: 'file', name: 'a.jpg', path: 'p/a.jpg' })).toBe('Photo');
    expect(attachmentKindLabel({ kind: 'file', name: 'a.PDF', path: 'p/a.PDF' })).toBe('PDF');
    expect(attachmentKindLabel({ kind: 'file', name: 'a', path: 'p/a', mimeType: 'application/pdf' })).toBe('PDF');
    expect(attachmentKindLabel({ kind: 'file', name: 'a.docx', path: 'p/a.docx' })).toBe('Document');
    expect(attachmentKindLabel({ kind: 'file', name: 'a', path: 'p/a', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('Document');
    expect(attachmentKindLabel({ kind: 'file', name: 'a.zip', path: 'p/a.zip' })).toBe('File');
    expect(attachmentKindLabel({ kind: 'file', name: 'noext' })).toBe('File');
  });
});

describe('classworkFolder', () => {
  it('points at the student folder or the library', () => {
    expect(classworkFolder({ studentId: 's-omar' })).toBe('students/s-omar');
    expect(classworkFolder('resources')).toBe('resources');
  });
});

describe('resource filters', () => {
  const list = [
    res({ id: 'a', title: 'Calculus booklet', subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', tags: ['revision'] }),
    res({ id: 'b', title: 'Essay guide', description: 'Structure for ESSAYS', subject: 'English', curriculum: 'A-Level', level: 'A2', tags: [] }),
    res({ id: 'c', title: 'Reaction map', subject: 'chemistry', curriculum: 'IGCSE', level: 'Extended', tags: ['Organic'] }),
    res({ id: 'd', title: 'Untagged', subject: ' ', level: undefined }),
  ];
  it('filters by subject, curriculum, level and query, ignoring case', () => {
    expect(filterResources(list, {}).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterResources(list, { subject: 'Chemistry' }).map((r) => r.id)).toEqual(['c']);
    expect(filterResources(list, { level: 'a2' }).map((r) => r.id)).toEqual(['b']);
    expect(filterResources(list, { curriculum: ' ib dp ' }).map((r) => r.id)).toEqual(['a']);
    expect(filterResources(list, { subject: 'English', curriculum: 'IGCSE' })).toEqual([]);
    expect(filterResources(list, { query: 'essays' }).map((r) => r.id)).toEqual(['b']);
    expect(filterResources(list, { query: 'organic' }).map((r) => r.id)).toEqual(['c']);
    expect(filterResources(list, { query: ' CALC ' }).map((r) => r.id)).toEqual(['a']);
    expect(filterResources(list, { subject: 'Maths', query: 'essay' })).toEqual([]);
    expect(filterResources(list, { subject: '', curriculum: '', level: '', query: '' })).toHaveLength(4);
  });
  it('lists unique, sorted, non-empty facets', () => {
    expect(resourceFacets([...list, res({ subject: 'English', curriculum: 'igcse', level: 'Core' })])).toEqual({
      subjects: ['chemistry', 'English', 'Maths'],
      curricula: ['A-Level', 'IB DP', 'IGCSE'],
      levels: ['A2', 'AA HL', 'Core', 'Extended'],
    });
    expect(resourceFacets([])).toEqual({ subjects: [], curricula: [], levels: [] });
  });
});

describe('parseTags', () => {
  it('splits, trims, drops empties and removes duplicates ignoring case', () => {
    expect(parseTags(' revision, Past papers ,, revision , REVISION, calculus ')).toEqual(['revision', 'Past papers', 'calculus']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags(' , , ')).toEqual([]);
  });
});

describe('resourceMeta', () => {
  it('joins subject, curriculum and level, in the order the subject pickers use', () => {
    expect(resourceMeta({ subject: 'Chemistry', level: 'HL', curriculum: 'IB DP' })).toBe('Chemistry · IB DP · HL');
  });
  it('drops a level that repeats the curriculum, ignoring case and spaces', () => {
    expect(resourceMeta({ subject: 'Chemistry', level: ' igcse ', curriculum: 'IGCSE' })).toBe('Chemistry · IGCSE');
    expect(resourceMeta({ subject: 'English', level: 'A-Level', curriculum: 'A-Level' })).toBe('English · A-Level');
  });
  it('skips blanks', () => {
    expect(resourceMeta({ subject: ' ', curriculum: 'IB' })).toBe('IB');
    expect(resourceMeta({})).toBe('');
  });
});

describe('dueLabel', () => {
  const now = new Date(2026, 9, 4, 9, 0);
  it('lower-cases today, tomorrow and yesterday mid-sentence', () => {
    expect(dueLabel('2026-10-04', now)).toBe('Due today');
    expect(dueLabel('2026-10-05', now)).toBe('Due tomorrow');
    expect(dueLabel('2026-10-03T00:00:00Z', now)).toBe('Due yesterday');
  });
  it('keeps the capitals of a named day', () => {
    const label = dueLabel('2026-10-12', now);
    expect(label.startsWith('Due ')).toBe(true);
    expect(label.charAt(4)).toBe(label.charAt(4).toUpperCase());
    expect(label).not.toMatch(/today|tomorrow|yesterday/i);
  });
});

describe('dueDateChoices', () => {
  const now = new Date(2026, 9, 4, 9, 0);
  it('offers tomorrow, three days, a week and two weeks', () => {
    expect(dueDateChoices(now)).toEqual([
      { label: 'Tomorrow', date: '2026-10-05' },
      { label: 'In 3 days', date: '2026-10-07' },
      { label: 'In a week', date: '2026-10-11' },
      { label: 'In two weeks', date: '2026-10-18' },
    ]);
  });
  it('puts the next lesson first when one is booked after today', () => {
    expect(dueDateChoices(now, new Date(2026, 9, 9, 16, 0).toISOString())[0]).toEqual({ label: 'Next lesson', date: '2026-10-09' });
    expect(dueDateChoices(now, new Date(2026, 9, 4, 16, 0).toISOString())[0].label).toBe('Tomorrow');
  });
});

describe('lessonHomeworkWarning', () => {
  it('names the homework and says the lesson is recorded', () => {
    const msg = lessonHomeworkWarning(['Quadratics', 'Reading']);
    expect(msg).toContain('The lesson has been recorded');
    expect(msg).toContain('"Quadratics", "Reading"');
    expect(lessonHomeworkWarning([])).not.toContain(' for ');
  });
});

describe('shouldDiscardUpload', () => {
  const fresh = new Set(['students/s1/new.pdf']);
  it('deletes only files uploaded in this form', () => {
    expect(shouldDiscardUpload(fileAttachment('students/s1/new.pdf', 'new.pdf'), fresh)).toBe(true);
    expect(shouldDiscardUpload(fileAttachment('students/s1/old.pdf', 'old.pdf'), fresh)).toBe(false);
    expect(shouldDiscardUpload(linkAttachment('https://example.org'), fresh)).toBe(false);
  });
  it('never deletes a library file, which other homework may share', () => {
    expect(shouldDiscardUpload({ kind: 'file', name: 'x', path: 'students/s1/new.pdf', resourceId: 'r1' }, fresh)).toBe(false);
  });
});
