import { connectionSummary, lastSyncedText } from '../calendar-connection';
import type { CalendarConnection } from '../types';

const NOW = new Date(2026, 9, 5, 12, 0);
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const conn = (over: Partial<CalendarConnection> = {}): CalendarConnection => ({
  profileId: 'p1',
  provider: 'google',
  googleEmail: 'tutor@example.com',
  calendarId: 'primary',
  status: 'connected',
  lastSyncedAt: ago(5),
  ...over,
});

describe('lastSyncedText', () => {
  it('describes how long ago the last sync was', () => {
    expect(lastSyncedText(undefined, NOW)).toBe('Not yet synced');
    expect(lastSyncedText(ago(0.5), NOW)).toBe('Synced just now');
    expect(lastSyncedText(ago(1), NOW)).toBe('Synced 1 minute ago');
    expect(lastSyncedText(ago(59), NOW)).toBe('Synced 59 minutes ago');
    expect(lastSyncedText(ago(60), NOW)).toBe('Synced 1 hour ago');
    expect(lastSyncedText(ago(23 * 60 + 59), NOW)).toBe('Synced 23 hours ago');
    expect(lastSyncedText(ago(24 * 60), NOW)).toBe('Synced on 4 Oct 2026');
  });
});

describe('connectionSummary', () => {
  it('invites the user to connect when there is no connection', () => {
    for (const c of [null, undefined]) {
      const s = connectionSummary(c, NOW);
      expect(s).toMatchObject({ tone: 'neutral', status: 'Not connected', action: 'connect' });
      expect(s.detail).toContain('Google Meet link');
    }
  });

  it('shows a healthy connection', () => {
    expect(connectionSummary(conn(), NOW)).toEqual({
      tone: 'success',
      status: 'Connected',
      detail: 'tutor@example.com · Synced 5 minutes ago',
      action: 'disconnect',
    });
    expect(connectionSummary(conn({ googleEmail: undefined, lastSyncedAt: undefined }), NOW)).toEqual({
      tone: 'success',
      status: 'Connected',
      detail: 'Google Calendar · Not yet synced',
      action: 'disconnect',
    });
    expect(connectionSummary(conn({ lastSyncedAt: ago(30) }), NOW).tone).toBe('success');
  });

  it('warns when syncing is delayed', () => {
    expect(connectionSummary(conn({ lastSyncedAt: ago(31) }), NOW)).toEqual({
      tone: 'warning',
      status: 'Connected',
      detail: 'tutor@example.com · Synced 31 minutes ago · Syncing appears delayed',
      action: 'disconnect',
    });
  });

  it('asks for a reconnection after an error', () => {
    expect(connectionSummary(conn({ status: 'error', lastError: 'Access was revoked.' }), NOW)).toEqual({
      tone: 'warning',
      status: 'Needs attention',
      detail: 'Access was revoked.',
      action: 'reconnect',
    });
    expect(connectionSummary(conn({ status: 'error' }), NOW).detail).toBe('We could not reach your Google Calendar. Please reconnect.');
  });
});
