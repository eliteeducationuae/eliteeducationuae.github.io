/** The advisory update letter (Expo and React Native mocked). */
import type { AdmissionsKeyDate, AdmissionsTarget, AdvisoryUpdate } from '@/domain/admissions';

import { advisoryUpdateHTML } from '../advisory-update-pdf';
import { PDF_FOOTER_TEXT } from '../pdf-brand';

// ts-jest hoists these above the imports.
jest.mock('expo-print', () => ({}), { virtual: true });
jest.mock('expo-sharing', () => ({}), { virtual: true });
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }), { virtual: true });

const update: AdvisoryUpdate = {
  id: 'aup-1',
  caseId: 'adm-1',
  kind: 'monthly',
  title: 'October 2026 advisory update',
  period: 'October 2026',
  body: 'Omar has made a positive start.\n\nPlease send the <latest> school report & predicted grades.\nThank you.',
  status: 'published',
  aiAssisted: false,
  authorName: 'Sarah Khan',
  createdAt: '2026-10-01T08:00:00.000Z',
  publishedAt: '2026-10-03T08:00:00.000Z',
};

const targets: AdmissionsTarget[] = [
  { id: 'atg-ucl', caseId: 'adm-1', institution: 'University College London', status: 'applying', sort: 0, updatedAt: '2026-10-01T08:00:00.000Z' },
];

const upcoming: AdmissionsKeyDate[] = [
  { id: 'd1', caseId: 'adm-1', kind: 'deadline', title: 'Personal statement first draft', dueOn: '2026-10-16', done: false },
  { id: 'd2', caseId: 'adm-1', targetId: 'atg-ucl', kind: 'interview', title: 'Interview <online>', dueOn: '2026-11-02', time: '10:00', done: false },
];

describe('advisoryUpdateHTML', () => {
  const html = advisoryUpdateHTML(
    update,
    { kind: 'uk-university', title: 'UK universities — 2028 entry (UCAS)' },
    { fullName: 'Omar Al Mansoori' },
    'Sarah Khan',
    'Elite Education',
    upcoming,
    targets,
  );

  it('is a complete branded document with the footer', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(PDF_FOOTER_TEXT);
    expect(html).toContain('Admissions advisory');
  });

  it('includes the student, title, kind, period and adviser', () => {
    expect(html).toContain('Omar Al Mansoori · October 2026 advisory update');
    expect(html).toContain('UK universities (UCAS)');
    expect(html).toContain('October 2026');
    expect(html).toContain('Adviser: Sarah Khan');
    expect(html).toContain('3 Oct 2026');
  });

  it('escapes the body and splits it into paragraphs', () => {
    expect(html).toContain('<p>Omar has made a positive start.</p>');
    expect(html).toContain('&lt;latest&gt; school report &amp; predicted grades.<br>Thank you.');
    expect(html).not.toContain('<latest>');
    expect(html).not.toContain('<online>');
  });

  it('lists upcoming key dates with the institution', () => {
    expect(html).toContain('Upcoming key dates');
    expect(html).toContain('16 Oct 2026');
    expect(html).toContain('Deadline: Personal statement first draft');
    expect(html).toContain('2 Nov 2026 at 10:00');
    expect(html).toContain('Interview: Interview &lt;online&gt;');
    expect(html).toContain('University College London');
  });

  it('never prints placeholders', () => {
    expect(html).not.toContain('[object');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  it('leaves the table out when there are no upcoming dates and copes without an adviser or period', () => {
    const plain = advisoryUpdateHTML(
      { ...update, period: undefined, publishedAt: undefined, authorName: undefined },
      { kind: 'boarding', title: 'Boarding' },
      { fullName: 'Layla Al Mansoori' },
      undefined,
      '',
      [],
      [],
    );
    expect(plain).not.toContain('Upcoming key dates');
    expect(plain).not.toContain('undefined');
    expect(plain).toContain('UK boarding school');
    expect(plain).toContain(PDF_FOOTER_TEXT);
  });
});
