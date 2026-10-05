/** Date helpers. All work in the device's local time zone (Gulf Standard Time has no DST). */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MS_PER_MINUTE);
}

/** Monday-based week start. */
export function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const offset = (r.getDay() + 6) % 7;
  return addDays(r, -offset);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_HOUR;
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_MINUTE;
}

/** Whole days from `now` until a `YYYY-MM-DD` date (negative if past). */
export function daysUntil(dateKey: string, now: Date): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

/** `YYYY-MM-DD` in local time. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` and `HH:MM` as local time. */
export function fromDateAndTime(dateKey: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const h = Number(tm[1]);
  const min = Number(tm[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), h, min);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayShort(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

/** e.g. `Mon 6 Oct` */
export function formatDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** e.g. `6 Oct 2026` */
export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * A line description for printing: a trailing ISO date (as charge descriptions carry, e.g.
 * 'IB 1:1 — Sami, 2026-08-24') becomes '24 Aug 2026'. The stored text is unchanged.
 */
export function formatLineDescription(description: string): string {
  return description.replace(/(\d{4})-(\d{2})-(\d{2})\s*$/, (whole, y: string, m: string, d: string) => {
    const month = MONTHS[Number(m) - 1];
    return month && Number(d) >= 1 && Number(d) <= 31 ? `${Number(d)} ${month} ${y}` : whole;
  });
}

export function formatMonth(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Today", "Tomorrow", "Yesterday" or `Mon 6 Oct`. */
export function relativeDay(d: Date | string, now: Date = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, addDays(now, 1))) return 'Tomorrow';
  if (isSameDay(date, addDays(now, -1))) return 'Yesterday';
  return formatDay(date);
}
