import { advisoryUpdateSentTitle, previewText, sentForSameMonth } from '../admissions';

const letter = [
  'Dear Mrs Al Mansoori,',
  'Omar’s UCAS preparation is well under way. His personal statement now has a clear structure. We will review the second draft together next week, and I will send his referee the updated school report.',
  'Interview practice begins in November.',
].join('\n\n');

describe('previewText', () => {
  it('drops the salutation and keeps a short letter whole, without an ellipsis', () => {
    expect(previewText('Dear Fatima,\n\nA short note.')).toBe('A short note.');
  });

  it('ends on a whole sentence with one ellipsis', () => {
    const text = previewText(letter, 100);
    expect(text).toBe('Omar’s UCAS preparation is well under way. His personal statement now has a clear structure…');
    expect(text).not.toMatch(/\.…|\.\.\.|…\./);
  });

  it('cuts a very long first sentence at a word, with one ellipsis', () => {
    const text = previewText(`Dear Omar,\n\n${'word '.repeat(80)}end.`, 40);
    expect(text.endsWith('word…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(41);
  });
});

describe('advisory update follow-ups', () => {
  const sent = (id: string, period: string, kind: 'monthly' | 'ad-hoc' = 'monthly') =>
    ({ id, caseId: 'c', kind, title: `${period} advisory update`, period, body: 'x', status: 'published', aiAssisted: false, createdAt: '2026-10-01' }) as never;

  it('names the month when a monthly update is sent, otherwise the title', () => {
    expect(advisoryUpdateSentTitle({ kind: 'monthly', period: 'October 2026', title: 'October 2026 advisory update' })).toBe(
      'Advisory update sent: October 2026',
    );
    expect(advisoryUpdateSentTitle({ kind: 'ad-hoc', period: undefined, title: 'Offer from Brighton College' })).toBe(
      'Advisory update sent: Offer from Brighton College',
    );
  });

  it('finds a monthly update already sent for the same month', () => {
    const updates = [sent('u1', 'October 2026'), sent('u2', 'September 2026')];
    expect(sentForSameMonth(updates, { kind: 'monthly', period: 'october 2026 ' })?.id).toBe('u1');
    expect(sentForSameMonth(updates, { id: 'u1', kind: 'monthly', period: 'October 2026' })).toBeUndefined();
    expect(sentForSameMonth(updates, { kind: 'ad-hoc', period: 'October 2026' })).toBeUndefined();
    expect(sentForSameMonth(updates, { kind: 'monthly', period: 'November 2026' })).toBeUndefined();
  });
});
