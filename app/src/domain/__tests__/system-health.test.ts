import { attentionCount, firstLine, jobStatus, jobSummary, overallHeadline, sinceLabel, statusLabel, statusTone, worstStatus } from '../system-health';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('worstStatus', () => {
  it('picks the most serious status', () => {
    expect(worstStatus([])).toBe('ok');
    expect(worstStatus(['ok', 'warning', 'ok'])).toBe('warning');
    expect(worstStatus(['warning', 'failing', 'ok'])).toBe('failing');
  });
});

describe('labels and tones', () => {
  it('maps statuses to words and calm badge tones', () => {
    expect(statusLabel('ok')).toBe('Working');
    expect(statusLabel('warning')).toBe('Needs attention');
    expect(statusLabel('failing')).toBe('Failing');
    expect(statusTone('ok')).toBe('success');
    expect(statusTone('warning')).toBe('gold');
    expect(statusTone('failing')).toBe('danger');
  });
});

describe('overallHeadline', () => {
  it('reassures when everything is fine', () => {
    expect(overallHeadline({ checks: [{ key: 'a', label: 'A', status: 'ok', detail: '' }] })).toBe('All systems are working normally');
  });
  it('counts the items needing attention', () => {
    const checks = [
      { key: 'a', label: 'A', status: 'warning' as const, detail: '' },
      { key: 'b', label: 'B', status: 'failing' as const, detail: '' },
      { key: 'c', label: 'C', status: 'ok' as const, detail: '' },
    ];
    expect(attentionCount(checks)).toBe(2);
    expect(overallHeadline({ checks })).toBe('2 items need your attention');
    expect(overallHeadline({ checks: checks.slice(0, 1) })).toBe('1 item needs your attention');
  });
});

describe('sinceLabel', () => {
  it('describes elapsed time in words', () => {
    expect(sinceLabel(undefined, NOW)).toBe('Never');
    expect(sinceLabel('not a date', NOW)).toBe('Never');
    expect(sinceLabel(ago(20_000), NOW)).toBe('Just now');
    expect(sinceLabel(ago(60_000), NOW)).toBe('1 minute ago');
    expect(sinceLabel(ago(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(sinceLabel(ago(3_600_000), NOW)).toBe('1 hour ago');
    expect(sinceLabel(ago(30 * 3_600_000), NOW)).toBe('30 hours ago');
    expect(sinceLabel(ago(3 * 86_400_000), NOW)).toBe('3 days ago');
  });
  it('never shows a negative time for clock skew', () => {
    expect(sinceLabel(new Date(NOW + 60_000).toISOString(), NOW)).toBe('Just now');
  });
});

describe('jobs', () => {
  it('works out a job state from its last runs', () => {
    expect(jobStatus({ name: 'x' })).toBe('never');
    expect(jobStatus({ name: 'x', lastStartedAt: ago(1000), lastSucceededAt: ago(1000) })).toBe('ok');
    expect(jobStatus({ name: 'x', lastSucceededAt: ago(60_000), lastFailedAt: ago(1000) })).toBe('failing');
    expect(jobStatus({ name: 'x', lastSucceededAt: ago(1000), lastFailedAt: ago(60_000) })).toBe('ok');
  });
  it('summarises the last run', () => {
    expect(jobSummary({ name: 'x', lastSucceededAt: ago(5 * 60_000) }, NOW)).toBe('Last succeeded 5 minutes ago.');
    expect(jobSummary({ name: 'x', lastFailedAt: ago(60_000), lastError: 'Timed out' }, NOW)).toBe('Last failed 1 minute ago: Timed out');
    expect(jobSummary({ name: 'x' }, NOW)).toBe('Has not run yet.');
  });
});

describe('firstLine', () => {
  it('keeps the first line and shortens long ones', () => {
    expect(firstLine('Boom\n  at x')).toBe('Boom');
    expect(firstLine('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(firstLine(undefined)).toBe('');
  });
});
