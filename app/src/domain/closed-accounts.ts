/**
 * Closed accounts: tutors, students and families whose account was closed are anonymised but kept (as "Former tutor",
 * "Former student") because invoices and past lessons refer to them. They never appear in pickers, and lists show them
 * last behind a "Show closed" choice.
 */

export interface MaybeClosed {
  deletedAt?: string | null;
}

export const CLOSED_LABEL = 'Account closed';

export function isClosed(x: MaybeClosed | null | undefined): boolean {
  return !!x?.deletedAt;
}

/** Only the records that can still be chosen (for scheduling, enrolments, invitations and recipients). */
export function withoutClosed<T extends MaybeClosed>(items: readonly T[] | null | undefined): T[] {
  return (items ?? []).filter((x) => !isClosed(x));
}

/** Open records first in their existing order, then closed ones; closed ones only when asked for. */
export function closedLast<T extends MaybeClosed>(items: readonly T[] | null | undefined, showClosed: boolean): T[] {
  const list = items ?? [];
  const open = list.filter((x) => !isClosed(x));
  return showClosed ? [...open, ...list.filter(isClosed)] : open;
}

export function closedCount(items: readonly MaybeClosed[] | null | undefined): number {
  return (items ?? []).filter(isClosed).length;
}

/** e.g. "Show 2 closed accounts" / "Hide closed accounts". */
export function closedToggleLabel(count: number, showing: boolean): string {
  if (showing) return 'Hide closed accounts';
  return `Show ${count} closed ${count === 1 ? 'account' : 'accounts'}`;
}
