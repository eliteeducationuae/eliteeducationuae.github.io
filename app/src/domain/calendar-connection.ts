import { formatDate } from './dates';
import type { CalendarConnection } from './types';

export interface ConnectionSummary {
  /** Matches the Badge tones in components/ui.tsx. */
  tone: 'success' | 'warning' | 'neutral';
  status: string;
  detail: string;
  action: 'connect' | 'reconnect' | 'disconnect';
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
  return delayed
    ? { tone: 'warning', status: 'Connected', detail: `${detail} · Syncing appears delayed`, action: 'disconnect' }
    : { tone: 'success', status: 'Connected', detail, action: 'disconnect' };
}
