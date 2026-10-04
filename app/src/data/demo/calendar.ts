import { addDays, startOfDay } from '@/domain/dates';
import { isAbsent, isActive, isClosed, overlaps, withinAvailability } from '@/domain/scheduling';
import type { BusyBlock, CalendarConnection, Profile } from '@/domain/types';

import { AccessError, type DemoDB } from './db';

/**
 * Demo versions of the Google Calendar features. In production the calendar-sync Edge Function copies busy
 * times from Google into busy_blocks and adds lessons (with Meet links) to the tutor's calendar; here,
 * connecting simply marks the account as connected and adds a couple of sample busy times.
 */

/** Candidate busy times (local hours) tried in order on each day. */
const SAMPLE_TIMES: [number, number, number, number][] = [
  [15, 0, 16, 30],
  [14, 0, 15, 0],
  [16, 0, 17, 0],
];

/**
 * Up to `count` sample Google busy times for a tutor, on separate days from three days after `now`, inside the
 * tutor's weekly availability and clear of their lessons, closures and absences. Deterministic for a given `now`.
 */
export function sampleBusyBlocks(db: DemoDB, tutorId: string, now: Date, count: number, idPrefix: string): BusyBlock[] {
  const out: BusyBlock[] = [];
  const first = addDays(startOfDay(now), 3);
  for (let i = 0; i < 21 && out.length < count; i++) {
    const day = addDays(first, i);
    if (isClosed(day, db.closures) || isAbsent(tutorId, day, db.absences)) continue;
    for (const [sh, sm, eh, em] of SAMPLE_TIMES) {
      const start = new Date(day);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(day);
      end.setHours(eh, em, 0, 0);
      const slot = { start, end };
      if (!withinAvailability(tutorId, slot, db.availability)) continue;
      const clash = db.lessons.some(
        (l) => l.tutorId === tutorId && isActive(l) && overlaps(slot, { start: new Date(l.start), end: new Date(l.end) }),
      );
      if (clash) continue;
      out.push({ id: `${idPrefix}${out.length + 1}`, tutorId, start: start.toISOString(), end: end.toISOString(), source: 'google' });
      break;
    }
  }
  return out;
}

const canConnect = (viewer: Profile) => viewer.role === 'admin' || viewer.role === 'tutor';

export const cal = {
  /** Mirrors the busy_blocks policies: admins see all, tutors their own, families none. */
  busyBlocks(db: DemoDB, viewer: Profile, filter: { tutorId?: string; from?: string; to?: string } = {}): BusyBlock[] {
    const all = db.busyBlocks ?? [];
    const visible =
      viewer.role === 'admin' ? all : viewer.role === 'tutor' && viewer.tutorId ? all.filter((b) => b.tutorId === viewer.tutorId) : [];
    return visible
      .filter(
        (b) =>
          (!filter.tutorId || b.tutorId === filter.tutorId) &&
          (!filter.to || b.start < filter.to) &&
          (!filter.from || b.end > filter.from),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  },

  /** The viewer's own Google Calendar link, or null. */
  connection(db: DemoDB, viewer: Profile): CalendarConnection | null {
    return (db.calendarConnections ?? []).find((c) => c.profileId === viewer.id) ?? null;
  },

  connect(db: DemoDB, viewer: Profile, now = new Date()): CalendarConnection {
    if (!canConnect(viewer)) throw new AccessError('Only tutors and the office can connect Google Calendar.');
    const connection: CalendarConnection = {
      profileId: viewer.id,
      provider: 'google',
      googleEmail: viewer.email,
      calendarId: 'primary',
      status: 'connected',
      lastSyncedAt: now.toISOString(),
    };
    db.calendarConnections = [...(db.calendarConnections ?? []).filter((c) => c.profileId !== viewer.id), connection];

    if (viewer.tutorId) {
      // Online lessons gain a Google Meet link once they are on the tutor's calendar.
      for (const l of db.lessons) {
        if (l.tutorId === viewer.tutorId && l.status === 'scheduled' && l.location === 'online' && !l.meetingUrl) {
          l.meetingUrl = `https://meet.google.com/demo-${l.id.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase()}`;
        }
      }
      const busy = db.busyBlocks ?? [];
      if (!busy.some((b) => b.tutorId === viewer.tutorId)) {
        const prefix = `busy-${viewer.tutorId}-${now.getTime().toString(36)}-`;
        db.busyBlocks = [...busy, ...sampleBusyBlocks(db, viewer.tutorId, now, 2, prefix)];
      }
    }
    return connection;
  },

  disconnect(db: DemoDB, viewer: Profile) {
    if (!canConnect(viewer)) throw new AccessError('Only tutors and the office can manage Google Calendar.');
    const remaining = (db.calendarConnections ?? []).filter((c) => c.profileId !== viewer.id);
    db.calendarConnections = remaining;
    const tutorId = viewer.tutorId;
    if (!tutorId) return;
    const shared = remaining.some((c) => db.profiles.find((p) => p.id === c.profileId)?.tutorId === tutorId);
    if (!shared) db.busyBlocks = (db.busyBlocks ?? []).filter((b) => b.tutorId !== tutorId);
  },
};
