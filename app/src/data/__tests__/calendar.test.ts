import { addDays } from '@/domain/dates';

import { cal } from '../demo/calendar';
import { AccessError, type DemoDB } from '../demo/db';
import { eq } from '../demo/engagement';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026
const who = (db: DemoDB, role: string) => db.profiles.find((p) => p.role === role)!;

describe('Google busy blocks (mirrors the busy_blocks policies)', () => {
  it('shows a tutor their own, the admin everyone’s and families none', () => {
    const db = createSeed(NOW);
    const all = db.busyBlocks ?? [];
    expect(all.some((b) => b.tutorId === 't-sarah')).toBe(true);
    // Craig has not connected, so he has no Google busy times yet.
    expect(all.some((b) => b.tutorId === 't-craig')).toBe(false);
    expect(all.map((b) => b.id)).toEqual(expect.arrayContaining(['busy-1']));

    const tutor = cal.busyBlocks(db, who(db, 'tutor'));
    expect(tutor.length).toBeGreaterThan(0);
    expect(tutor.every((b) => b.tutorId === 't-sarah')).toBe(true);
    expect(cal.busyBlocks(db, who(db, 'admin'))).toHaveLength(all.length);
    expect(cal.busyBlocks(db, who(db, 'parent'))).toEqual([]);
    expect(cal.busyBlocks(db, who(db, 'student'))).toEqual([]);
  });

  it('seeds busy times in the future, clear of lessons, and filters by tutor and range', () => {
    const db = createSeed(NOW);
    for (const b of db.busyBlocks ?? []) {
      expect(new Date(b.start).getTime()).toBeGreaterThanOrEqual(addDays(NOW, 2).getTime());
      const clash = db.lessons.some((l) => l.tutorId === b.tutorId && l.start < b.end && l.end > b.start && l.status === 'scheduled');
      expect(clash).toBe(false);
    }
    const admin = who(db, 'admin');
    expect(cal.busyBlocks(db, admin, { tutorId: 't-craig' })).toEqual([]);
    cal.connect(db, admin, NOW);
    const craig = cal.busyBlocks(db, admin, { tutorId: 't-craig' });
    expect(craig.length).toBe(2);
    for (const b of craig) expect(new Date(b.start).getTime()).toBeGreaterThanOrEqual(addDays(NOW, 2).getTime());
    expect(cal.busyBlocks(db, admin, { tutorId: 't-craig', from: craig[1].end })).toEqual([]);
    expect(cal.busyBlocks(db, admin, { tutorId: 't-craig', to: craig[0].start })).toEqual([]);
    expect(cal.busyBlocks(db, admin, { tutorId: 't-craig', from: craig[0].end })).toEqual([craig[1]]);
  });

  it('hides booking slots that overlap a busy block, and refuses requests then', () => {
    const db = createSeed(NOW);
    cal.connect(db, who(db, 'admin'), NOW);
    const block = (db.busyBlocks ?? []).find((b) => b.tutorId === 't-craig')!;
    const day = new Date(block.start);
    day.setHours(0, 0, 0, 0);
    const input = { tutorId: 't-craig', from: day.toISOString(), days: 1, durationMin: 60 };
    const slots = eq.openSlots(db, input, NOW);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.start < block.end && s.end > block.start)).toBe(false);

    // Without the block the same time is offered.
    const free = eq.openSlots({ ...db, busyBlocks: [] }, input, NOW);
    expect(free.some((s) => s.start === block.start)).toBe(true);

    expect(() =>
      eq.requestLesson(db, who(db, 'parent'), { studentId: 's-omar', kind: 'new-lesson', tutorId: 't-craig', serviceId: 'svc-ib', start: block.start }, NOW),
    ).toThrow('no longer available');
  });
});

describe('connecting Google Calendar', () => {
  it('seeds Sarah as connected and the admin as not connected', () => {
    const db = createSeed(NOW);
    const sarah = cal.connection(db, who(db, 'tutor'))!;
    expect(sarah).toMatchObject({ provider: 'google', googleEmail: 'sarah.khan@gmail.com', status: 'connected', calendarId: 'primary' });
    expect(new Date(sarah.lastSyncedAt!).getTime()).toBe(NOW.getTime() - 4 * 60_000);
    expect(cal.connection(db, who(db, 'admin'))).toBeNull();
  });

  it('connects the admin and gives their online lessons Meet links', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const online = db.lessons.filter((l) => l.tutorId === 't-craig' && l.status === 'scheduled' && l.location === 'online');
    expect(online.length).toBeGreaterThan(0);
    for (const l of online) l.meetingUrl = undefined;
    const otherLesson = db.lessons.find((l) => l.tutorId === 't-james' && l.status === 'scheduled' && l.location === 'online')!;
    otherLesson.meetingUrl = undefined;

    const conn = cal.connect(db, admin, NOW);
    expect(conn).toMatchObject({ profileId: admin.id, status: 'connected', googleEmail: admin.email, lastSyncedAt: NOW.toISOString() });
    expect(cal.connection(db, admin)).toEqual(conn);
    for (const l of online) expect(l.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\/demo-/);
    // Other tutors' lessons are left alone.
    expect(otherLesson.meetingUrl).toBeUndefined();
    // Connecting brings in Craig's busy times; connecting again adds no more.
    expect((db.busyBlocks ?? []).filter((b) => b.tutorId === 't-craig')).toHaveLength(2);
    cal.connect(db, admin, NOW);
    expect((db.busyBlocks ?? []).filter((b) => b.tutorId === 't-craig')).toHaveLength(2);
  });

  it('seeds Craig’s upcoming online lessons without a link, so connecting visibly adds Meet links', () => {
    const db = createSeed(NOW);
    const waiting = db.lessons.filter((l) => l.tutorId === 't-craig' && l.status === 'scheduled' && l.location === 'online' && !l.meetingUrl);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((l) => new Date(l.start) > NOW)).toBe(true);
    cal.connect(db, who(db, 'admin'), NOW);
    for (const l of waiting) expect(l.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\/demo-/);
  });

  it('disconnects, removing the connection and the tutor’s busy times', () => {
    const db = createSeed(NOW);
    cal.connect(db, who(db, 'admin'), NOW);
    const tutor = who(db, 'tutor');
    cal.disconnect(db, tutor);
    expect(cal.connection(db, tutor)).toBeNull();
    expect(cal.busyBlocks(db, tutor)).toEqual([]);
    // Craig's busy time is untouched.
    expect((db.busyBlocks ?? []).some((b) => b.tutorId === 't-craig')).toBe(true);

    // Sarah's generated Meet links on upcoming lessons go with her calendar; links pasted by hand stay.
    expect(
      db.lessons.some(
        (l) => l.tutorId === 't-sarah' && l.status === 'scheduled' && new Date(l.start) > NOW && l.meetingUrl?.startsWith('https://meet.google.com/demo-'),
      ),
    ).toBe(false);

    // Reconnecting adds sample busy times again.
    cal.connect(db, tutor, NOW);
    expect(cal.busyBlocks(db, tutor).length).toBeGreaterThan(0);
  });

  it('clears the Meet links its calendar generated on upcoming lessons when disconnecting', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    cal.connect(db, admin, NOW);
    const generated = db.lessons.filter((l) => l.tutorId === 't-craig' && l.meetingUrl?.startsWith('https://meet.google.com/demo-'));
    expect(generated.length).toBeGreaterThan(0);
    const pasted = db.lessons.find((l) => l.tutorId === 't-craig' && l.status === 'scheduled' && new Date(l.start) > NOW && !generated.includes(l));
    if (pasted) pasted.meetingUrl = 'https://zoom.us/j/123';
    cal.disconnect(db, admin, NOW);
    for (const l of generated) {
      if (l.status === 'scheduled' && new Date(l.start) > NOW) expect(l.meetingUrl).toBeUndefined();
    }
    if (pasted) expect(pasted.meetingUrl).toBe('https://zoom.us/j/123');
  });

  it('refuses families', () => {
    const db = createSeed(NOW);
    expect(() => cal.connect(db, who(db, 'parent'), NOW)).toThrow(AccessError);
    expect(() => cal.connect(db, who(db, 'student'), NOW)).toThrow(AccessError);
    expect(cal.connection(db, who(db, 'parent'))).toBeNull();
  });

  it('works with a demo database saved before the feature existed', () => {
    const { busyBlocks: _b, calendarConnections: _c, ...old } = createSeed(NOW);
    const db = old as DemoDB;
    const admin = who(db, 'admin');
    expect(cal.busyBlocks(db, admin)).toEqual([]);
    expect(cal.connection(db, admin)).toBeNull();
    const from = new Date(2026, 9, 5).toISOString();
    expect(eq.openSlots(db, { tutorId: 't-craig', from, days: 1, durationMin: 60 }, NOW).length).toBeGreaterThan(0);

    cal.connect(db, admin, NOW);
    expect(cal.connection(db, admin)?.status).toBe('connected');
    expect(cal.busyBlocks(db, admin).length).toBeGreaterThan(0);
    cal.disconnect(db, admin, NOW);
    expect(cal.connection(db, admin)).toBeNull();
    expect(cal.busyBlocks(db, admin)).toEqual([]);
  });
});
