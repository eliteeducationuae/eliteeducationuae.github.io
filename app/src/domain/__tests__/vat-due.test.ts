import { dayMonth, quarterMonths, quarterRange, quarterWithReturnDue, vatQuarterState, vatReturnDueDate } from '../vat-due';

describe('VAT return deadlines', () => {
  it('falls on the 28th of the month after the quarter', () => {
    expect(vatReturnDueDate({ end: '2026-09-30' })).toBe('2026-10-28');
    expect(vatReturnDueDate({ end: '2026-12-31' })).toBe('2027-01-28');
    expect(vatReturnDueDate({ end: '2027-02-28' })).toBe('2027-03-28');
  });

  it('formats the dates as the return notice reads', () => {
    expect(dayMonth('2026-10-28')).toBe('28 October');
    expect(quarterRange({ start: '2026-07-01', end: '2026-09-30' })).toBe('1 July to 30 September 2026');
    expect(quarterRange({ start: '2025-12-01', end: '2026-02-28' })).toBe('1 December 2025 to 28 February 2026');
    expect(quarterMonths({ start: '2026-07-01', end: '2026-09-30' })).toBe('July to September');
  });

  it('knows whether a quarter is open, due or past', () => {
    const q = { end: '2026-09-30' };
    expect(vatQuarterState(q, '2026-09-30')).toBe('open');
    expect(vatQuarterState(q, '2026-10-01')).toBe('due');
    expect(vatQuarterState(q, '2026-10-28')).toBe('due');
    expect(vatQuarterState(q, '2026-10-29')).toBe('past');
  });

  it('finds the quarter whose return is due', () => {
    expect(quarterWithReturnDue(new Date('2026-10-12T08:00:00Z'), 1)?.label).toBe('Jul – Sep 2026');
    expect(quarterWithReturnDue(new Date('2026-11-12T08:00:00Z'), 1)).toBeUndefined();
    expect(quarterWithReturnDue(new Date('2026-11-12T08:00:00Z'), 2)?.label).toBe('Aug – Oct 2026');
  });
});
