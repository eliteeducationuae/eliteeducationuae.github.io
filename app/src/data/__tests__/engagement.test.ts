import { AccessError } from '../demo/db';
import { eq } from '../demo/engagement';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026
const who = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;

describe('booking (mirrors open_slots / request_lesson / decide_request)', () => {
  it('offers open slots and turns an approved request into a lesson', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    const from = new Date(2026, 9, 5).toISOString(); // Monday
    const slots = eq.openSlots(db, { tutorId: 't-craig', from, days: 1, durationMin: 60 }, NOW);
    expect(slots.length).toBeGreaterThan(0);
    // Craig teaches Omar 18:00 on Fridays and Arjun Tuesdays — Monday afternoon should be wide open.
    eq.requestLesson(db, parent, { studentId: 's-omar', kind: 'new-lesson', tutorId: 't-craig', serviceId: 'svc-ib', start: slots[0].start }, NOW);
    const req = db.requests.find((r) => r.start === slots[0].start)!;
    expect(req.status).toBe('pending');

    const before = db.lessons.length;
    eq.decideRequest(db, who(db, 'admin'), req.id, true, 'See you then', NOW);
    expect(db.lessons.length).toBe(before + 1);
    expect(req.status).toBe('approved');
    // The slot is now taken.
    expect(eq.openSlots(db, { tutorId: 't-craig', from, days: 1, durationMin: 60 }, NOW).some((s) => s.start === slots[0].start)).toBe(false);
  });

  it('rejects taken slots, other families’ children and non-admin approvals', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    const omar = db.lessons.find((l) => l.studentIds.includes('s-omar') && l.status === 'scheduled' && new Date(l.start) > new Date(2026, 9, 4))!;
    expect(() => eq.requestLesson(db, parent, { studentId: 's-omar', kind: 'new-lesson', tutorId: 't-craig', serviceId: 'svc-ib', start: omar.start }, NOW)).toThrow(
      'no longer available',
    );
    expect(() => eq.requestLesson(db, parent, { studentId: 's-arjun', kind: 'new-lesson', tutorId: 't-craig', serviceId: 'svc-alevel', start: omar.start }, NOW)).toThrow(
      AccessError,
    );
    expect(() => eq.decideRequest(db, who(db, 'tutor'), 'req-1', true)).toThrow(AccessError);
  });

  it('moves a lesson when a reschedule is approved', () => {
    const db = createSeed(NOW);
    const lesson = db.lessons.find((l) => l.studentIds.includes('s-omar') && l.status === 'scheduled' && new Date(l.start) > new Date(2026, 9, 6))!;
    const day = new Date(lesson.start);
    day.setHours(0, 0, 0, 0);
    const slot = eq.openSlots(db, { tutorId: lesson.tutorId, from: day.toISOString(), days: 1, durationMin: 60, ignoreLessonId: lesson.id }, NOW)[0];
    eq.requestLesson(db, who(db, 'parent'), { studentId: 's-omar', kind: 'reschedule', lessonId: lesson.id, tutorId: '', serviceId: '', start: slot.start }, NOW);
    const req = db.requests[db.requests.length - 1];
    eq.decideRequest(db, who(db, 'admin'), req.id, true, undefined, NOW);
    expect(lesson.start).toBe(slot.start);
  });
});

describe('messaging', () => {
  it('limits conversations to the family, its tutors and admins, and tracks unread', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    const tutor = who(db, 'tutor'); // Sarah teaches Layla (Al Mansoori) and the Haddads
    expect(eq.threads(db, parent).map((t) => t.familyId)).toEqual(['f-mansoori']);
    expect(eq.threads(db, tutor).map((t) => t.familyId).sort()).toEqual(['f-haddad', 'f-mansoori']);
    expect(() => eq.sendMessage(db, parent, 'f-sharma', 'hi')).toThrow(AccessError);

    const admin = who(db, 'admin');
    const unreadBefore = eq.threads(db, admin).find((t) => t.familyId === 'f-mansoori')!.unread;
    expect(unreadBefore).toBeGreaterThan(0);
    eq.markRead(db, admin, 'f-mansoori', NOW);
    expect(eq.threads(db, admin).find((t) => t.familyId === 'f-mansoori')!.unread).toBe(0);
    eq.sendMessage(db, parent, 'f-mansoori', 'Thanks!', new Date(NOW.getTime() + 1000));
    expect(eq.threads(db, admin).find((t) => t.familyId === 'f-mansoori')!.unread).toBe(1);
  });

  it('shows announcements to the right audience', () => {
    const db = createSeed(NOW);
    eq.postAnnouncement(db, who(db, 'admin'), { title: 'Tutor meeting', body: 'Monday', audience: 'tutors' }, NOW);
    expect(eq.announcements(db, who(db, 'parent')).map((a) => a.title)).not.toContain('Tutor meeting');
    expect(eq.announcements(db, who(db, 'tutor')).map((a) => a.title)).toContain('Tutor meeting');
  });
});

describe('sign-up and enquiries', () => {
  it('lets parents add children and anyone send an enquiry', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    eq.addMyChild(db, parent, { fullName: 'Noor Al Mansoori', curriculum: 'IGCSE', syllabusId: 'igcse-4ma1' });
    expect(db.students.filter((s) => s.familyId === 'f-mansoori')).toHaveLength(3);
    expect(() => eq.addMyChild(db, who(db, 'tutor'), { fullName: 'X', curriculum: 'IB', syllabusId: 'ib-aa-sl' })).toThrow(AccessError);

    eq.submitEnquiry(db, null, { parentName: 'Web Visitor', email: 'v@example.com', source: 'website' }, NOW);
    expect(db.enquiries.some((e) => e.parentName === 'Web Visitor' && e.status === 'new')).toBe(true);
    expect(() => eq.submitEnquiry(db, null, { parentName: 'No contact' })).toThrow('email address or phone');
    expect(eq.enquiries(db, parent)).toEqual([]);
  });
});

describe('setMyName (mirrors set_my_name)', () => {
  it('names a parent whose prospect family was created without one', () => {
    const db = createSeed(NOW);
    db.families.push({ id: 'f-new', name: 'New family', parentName: 'New parent', email: 'x@privaterelay.appleid.com', status: 'prospect', createdAt: NOW.toISOString() });
    const me = { id: 'u-new', role: 'parent' as const, fullName: 'New parent', email: 'x@privaterelay.appleid.com', familyId: 'f-new' };
    db.profiles.push(me);
    const updated = eq.setMyName(db, me, '  Fatima   Al Mansoori ');
    expect(updated.fullName).toBe('Fatima Al Mansoori');
    expect(db.families.find((f) => f.id === 'f-new')).toMatchObject({ parentName: 'Fatima Al Mansoori', name: 'Al Mansoori' });
    expect(() => eq.setMyName(db, me, '   ')).toThrow('Please enter your name.');
    expect(() => eq.setMyName(db, me, 'a'.repeat(121))).toThrow('Please enter a name of 120 characters or fewer.');
  });

  it('never overwrites the name recorded for an active family, and ignores other roles', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    const family = db.families.find((f) => f.id === parent.familyId)!;
    expect(family.status).not.toBe('prospect');
    const before = parent.fullName;
    expect(eq.setMyName(db, parent, 'Someone Else').fullName).toBe(before);
    expect(family.parentName).not.toBe('Someone Else');
    const tutor = who(db, 'tutor');
    expect(eq.setMyName(db, tutor, 'Someone Else').fullName).toBe(tutor.fullName);
  });
});
