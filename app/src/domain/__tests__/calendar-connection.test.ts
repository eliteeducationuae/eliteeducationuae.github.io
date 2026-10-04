import { connectionSummary, connectResultNotice, lastSyncedText, slotWarning } from '../calendar-connection';
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

describe('connected with a warning', () => {
  it('shows the last error quietly while the calendar stays connected', () => {
    const s = connectionSummary(conn({ lastError: 'We could not read your busy times from Google. We will try again shortly.' }), NOW);
    expect(s).toMatchObject({ status: 'Connected', tone: 'warning', action: 'disconnect' });
    expect(s.warning).toBe('We could not read your busy times from Google. We will try again shortly.');
    expect(connectionSummary(conn(), NOW).warning).toBeUndefined();
  });
});

describe('connectResultNotice', () => {
  it('reads the result Google leaves in the address', () => {
    expect(connectResultNotice('?calendar=connected')?.tone).toBe('success');
    expect(connectResultNotice('?calendar=error&reason=denied')).toEqual({
      tone: 'warning',
      message: 'Access to Google Calendar was not granted. You may try again whenever you wish.',
    });
    expect(connectResultNotice('eliteeducation://calendar-connected?calendar=error&reason=expired')?.message).toMatch(/expired/);
    expect(connectResultNotice('?calendar=error&reason=exchange')?.message).toBe('Google Calendar could not be connected. Please try again.');
    expect(connectResultNotice('?tab=me')).toBeNull();
    // Declining (or failing) while already connected leaves that connection as it was, and says so.
    expect(connectResultNotice('?calendar=error&reason=denied&kept=1')?.message).toBe(
      'Access to Google Calendar was not granted. You may try again whenever you wish. Your existing connection remains in place.',
    );
    expect(connectResultNotice('eliteeducation://calendar-connected?calendar=error&reason=exchange&kept=1')?.message).toMatch(
      /Your existing connection remains in place\.$/,
    );
    expect(connectResultNotice('')).toBeNull();
  });
});

describe('slotWarning', () => {
  it('counts dates once and words each case in full sentences', () => {
    expect(slotWarning({ affected: 0, lessonClashes: 0, googleBusy: 0 })).toBeNull();
    expect(slotWarning({ affected: 1, lessonClashes: 0, googleBusy: 1 })).toBe(
      'Google Calendar shows the tutor as busy on 1 of these dates. Please check the dates below before scheduling.',
    );
    expect(slotWarning({ affected: 1, lessonClashes: 1, googleBusy: 0 })).toBe(
      '1 date clashes with another lesson. Please check the dates below before scheduling.',
    );
    expect(slotWarning({ affected: 3, lessonClashes: 3, googleBusy: 0 })).toMatch(/^3 dates clash with other lessons\./);
    expect(slotWarning({ affected: 3, lessonClashes: 2, googleBusy: 2 })).toBe(
      '3 dates need checking: 2 clash with other lessons and 2 fall in Google Calendar busy times. Please check the dates below before scheduling.',
    );
    expect(slotWarning({ affected: 1, lessonClashes: 1, googleBusy: 1 })).toBe(
      '1 date needs checking: 1 clashes with another lesson and 1 falls in a Google Calendar busy time. Please check the dates below before scheduling.',
    );
  });
});
