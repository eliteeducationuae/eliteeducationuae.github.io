import { formatDate } from './dates';
import type { CalendarConnection } from './types';

export interface ConnectionSummary {
  /** Matches the Badge tones in components/ui.tsx. */
  tone: 'success' | 'warning' | 'neutral';
  status: string;
  detail: string;
  action: 'connect' | 'reconnect' | 'disconnect';
  /** A quiet note while still connected, for example when busy times could not be read on the last run. */
  warning?: string;
}

export interface ConnectNotice {
  tone: 'success' | 'warning';
  message: string;
}

/**
 * The message for the result Google's consent screen leaves in the return address
 * (?calendar=connected, or ?calendar=error&reason=denied|expired|exchange). Null when there is none.
 */
export function connectResultNotice(query: string): ConnectNotice | null {
  const params = new URLSearchParams(query.includes('?') ? query.slice(query.indexOf('?') + 1).split('#')[0] : query);
  const result = params.get('calendar');
  if (result === 'connected') {
    return { tone: 'success', message: 'Your Google Calendar is now connected. Lessons will appear there within a few minutes.' };
  }
  if (result !== 'error') return null;
  const reason = params.get('reason');
  if (reason === 'denied') {
    return { tone: 'warning', message: 'Access to Google Calendar was not granted. You may try again whenever you wish.' };
  }
  if (reason === 'expired') {
    return { tone: 'warning', message: 'The connection link expired before it was completed. Please try again.' };
  }
  return { tone: 'warning', message: 'Google Calendar could not be connected. Please try again.' };
}

/** A sync older than this is flagged as delayed (calendar-sync runs every few minutes). */
const DELAYED_AFTER_MIN = 30;

/** How long ago the calendar last synced, in plain words. `now` is passed in to keep this pure. */
export function lastSyncedText(iso: string | undefined, now: Date): string {
  if (!iso) return 'Not yet synced';
  const when = new Date(iso);
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return minutes === 1 ? 'Synced 1 minute ago' : `Synced ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'Synced 1 hour ago' : `Synced ${hours} hours ago`;
  return `Synced on ${formatDate(when)}`;
}

/** What to show on the Google Calendar card for a tutor or admin. */
export function connectionSummary(conn: CalendarConnection | null | undefined, now: Date): ConnectionSummary {
  if (!conn) {
    return {
      tone: 'neutral',
      status: 'Not connected',
      detail:
        'Connect your Google Calendar so lessons appear there automatically, online lessons receive a Google Meet link, and your busy times are kept free of bookings.',
      action: 'connect',
    };
  }
  if (conn.status === 'error') {
    return {
      tone: 'warning',
      status: 'Needs attention',
      detail: conn.lastError ?? 'We could not reach your Google Calendar. Please reconnect.',
      action: 'reconnect',
    };
  }
  const detail = `${conn.googleEmail ?? 'Google Calendar'} · ${lastSyncedText(conn.lastSyncedAt, now)}`;
  const delayed =
    conn.lastSyncedAt !== undefined && now.getTime() - new Date(conn.lastSyncedAt).getTime() > DELAYED_AFTER_MIN * 60_000;
  const warning = conn.lastError || undefined;
  if (delayed) return { tone: 'warning', status: 'Connected', detail: `${detail} · Syncing appears delayed`, action: 'disconnect', warning };
  if (warning) return { tone: 'warning', status: 'Connected', detail, action: 'disconnect', warning };
  return { tone: 'success', status: 'Connected', detail, action: 'disconnect' };
}

/**
 * The warning above a set of new lesson dates. Each argument counts distinct dates, so a date that both clashes
 * with a lesson and falls in a Google busy time counts once in `affected`. Null when nothing needs checking.
 */
export function slotWarning(counts: { affected: number; lessonClashes: number; googleBusy: number }): string | null {
  const { affected, lessonClashes, googleBusy } = counts;
  if (!affected) return null;
  const dates = (n: number) => (n === 1 ? '1 date' : `${n} dates`);
  const tail = ' Please check the dates below before scheduling.';
  if (lessonClashes && googleBusy) {
    const clash = lessonClashes === 1 ? '1 clashes with another lesson' : `${lessonClashes} clash with other lessons`;
    const busy = googleBusy === 1 ? '1 falls in a Google Calendar busy time' : `${googleBusy} fall in Google Calendar busy times`;
    return `${dates(affected)} need${affected === 1 ? 's' : ''} checking: ${clash} and ${busy}.${tail}`;
  }
  if (lessonClashes) {
    return `${lessonClashes === 1 ? '1 date clashes with another lesson' : `${dates(lessonClashes)} clash with other lessons`}.${tail}`;
  }
  return `Google Calendar shows the tutor as busy on ${googleBusy === 1 ? '1 of these dates' : `${googleBusy} of these dates`}.${tail}`;
}
