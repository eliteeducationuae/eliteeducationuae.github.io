import { closedCount, closedLast, closedToggleLabel, isClosed, withoutClosed } from '../closed-accounts';

type R = { id: string; deletedAt?: string | null };
const a: R = { id: 'a' };
const b: R = { id: 'b', deletedAt: '2026-10-01T00:00:00Z' };
const c: R = { id: 'c', deletedAt: null };

describe('closed accounts', () => {
  it('knows a closed record by deletedAt', () => {
    expect(isClosed(a)).toBe(false);
    expect(isClosed(b)).toBe(true);
    expect(isClosed(c)).toBe(false);
    expect(isClosed(undefined)).toBe(false);
  });

  it('keeps closed records out of pickers', () => {
    expect(withoutClosed([a, b, c]).map((x) => x.id)).toEqual(['a', 'c']);
    expect(withoutClosed(undefined)).toEqual([]);
  });

  it('lists closed records last, and only when asked', () => {
    expect(closedLast([b, a, c], false).map((x) => x.id)).toEqual(['a', 'c']);
    expect(closedLast([b, a, c], true).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(closedCount([a, b, c])).toBe(1);
  });

  it('labels the toggle', () => {
    expect(closedToggleLabel(1, false)).toBe('Show 1 closed account');
    expect(closedToggleLabel(3, false)).toBe('Show 3 closed accounts');
    expect(closedToggleLabel(3, true)).toBe('Hide closed accounts');
  });
});
