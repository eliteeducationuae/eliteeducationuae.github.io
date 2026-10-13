import { dubaiDateKey, recentVatQuarters } from './tax';
import type { VatQuarter, VatQuarterStartMonth } from './types';

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The FTA filing deadline for a VAT quarter: the 28th day of the month after the quarter ends (YYYY-MM-DD).
 */
export function vatReturnDueDate(q: Pick<VatQuarter, 'end'>): string {
  const [y, m] = q.end.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-28` : `${y}-${pad(m + 1)}-28`;
}

/** e.g. '28 October' (the year is left out, as on the return notice). */
export function dayMonth(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${d} ${LONG_MONTHS[m - 1]}`;
}

/** e.g. '1 July to 30 September 2026'. */
export function quarterRange(q: Pick<VatQuarter, 'start' | 'end'>): string {
  const [sy] = q.start.split('-').map(Number);
  const [ey] = q.end.split('-').map(Number);
  return `${dayMonth(q.start)}${sy === ey ? '' : ` ${sy}`} to ${dayMonth(q.end)} ${ey}`;
}

/** e.g. 'July to September'. */
export function quarterMonths(q: Pick<VatQuarter, 'start' | 'end'>): string {
  return `${LONG_MONTHS[Number(q.start.slice(5, 7)) - 1]} to ${LONG_MONTHS[Number(q.end.slice(5, 7)) - 1]}`;
}

export type VatQuarterState = 'open' | 'due' | 'past';

/**
 * Where a quarter stands on `today` (YYYY-MM-DD, Dubai): 'open' while it is still running, 'due' once it has ended and
 * its return deadline has not passed yet, 'past' after the deadline. Filing itself is not recorded in the app.
 */
export function vatQuarterState(q: Pick<VatQuarter, 'end'>, today: string): VatQuarterState {
  if (today <= q.end) return 'open';
  return today <= vatReturnDueDate(q) ? 'due' : 'past';
}

/** The quarter whose return is due now (ended, deadline not passed), if any. */
export function quarterWithReturnDue(now: Date, startMonth: VatQuarterStartMonth): VatQuarter | undefined {
  const today = dubaiDateKey(now);
  return recentVatQuarters(now, startMonth, 2).find((q) => vatQuarterState(q, today) === 'due');
}
