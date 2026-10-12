import { formatDate } from '@/domain/dates';

/** '1 Oct' for a date in this year, '1 Oct 2025' otherwise. */
export function shortDate(d: string, now: Date = new Date()): string {
  const full = formatDate(d);
  return full.endsWith(` ${now.getFullYear()}`) ? full.slice(0, -5) : full;
}

/** The FTA due date of a VAT return: the 28th day after the end of the tax period (end of that day). */
export function vatReturnDue(periodEnd: string): Date {
  const [y, m, day] = periodEnd.split('-').map(Number);
  return new Date(y, m - 1, day + 28, 23, 59, 59);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'October' for '2026-10' (a MonthFigures month). */
export function monthName(ym: string): string {
  return MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym;
}
