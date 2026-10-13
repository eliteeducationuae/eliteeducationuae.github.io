import { useSettings } from '@/data/hooks';
import { quarterWithReturnDue } from '@/domain/vat-due';

export const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. 'Monday 12 October' (the hero kicker). */
export function longDay(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`;
}

/** e.g. '20 Sep' from a date or an ISO date string (local time). */
export function shortDate(d: string | Date): string {
  const date = typeof d === 'string' ? (d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d)) : d;
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

/** An amount to the fils without the currency, for line tables headed "AED, excluding VAT": '1,050.00'. */
export function plainAmount(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? '−' : ''}${Math.abs(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** The VAT tab's badge: 1 while a quarter has ended and its return deadline (the 28th of the next month) is ahead. */
export function useVatReturnDueCount(): number {
  const settings = useSettings();
  if (!settings.data) return 0;
  return quarterWithReturnDue(new Date(), settings.data.vatQuarterStartMonth) ? 1 : 0;
}
