import { LAST_ADMIN_MESSAGE } from '@/domain/data-rights';

import {
  APP_ERROR_CAP,
  appErrors,
  cancelDeletionRequest,
  deleteMyAccount,
  deletionRequests,
  exportMyData,
  KNOWN_MIGRATIONS,
  logAppError,
  processDeletionRequest,
  recordDeletionRequest,
  systemHealth,
} from '../demo/launch';
import { createSeed } from '../demo/seed';

type DB = ReturnType<typeof createSeed>;
const who = (db: DB, role: string) => db.profiles.find((p) => p.role === role)!;
const NOW = new Date('2026-10-04T08:00:00Z');

describe('exportMyData (mirrors export_my_data)', () => {
  it('gives a parent their family, children, lessons and invoices', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    const data = exportMyData(db, parent, NOW);
    expect(data.format).toBe('elite-education-export/1');
    expect(data.account).toMatchObject({ id: parent.id, email: parent.email, role: 'parent' });
    expect(data.family).toMatchObject({ id: parent.familyId });
    const children = db.students.filter((s) => s.familyId === parent.familyId).map((s) => s.id).sort();
    expect((data.students as { id: string }[]).map((s) => s.id).sort()).toEqual(children);
    expect((data.lessons as unknown[]).length).toBeGreaterThan(0);
    expect((data.invoices as { familyId: string }[]).every((i) => i.familyId === parent.familyId)).toBe(true);
    expect((data.lessonNotes as { privateNote?: string }[]).every((n) => n.privateNote === undefined)).toBe(true);
    expect(data.tutor).toBeNull();
  });

  it('gives a tutor their record, lessons and only the last four digits of their bank account', () => {
    const db = createSeed();
    const tutor = who(db, 'tutor');
    db.paymentDetails = db.paymentDetails.filter((p) => p.tutorId !== tutor.tutorId);
    db.paymentDetails.push({ tutorId: tutor.tutorId!, accountName: 'Sarah Khan', bankName: 'Emirates NBD', iban: 'AE070331234567890123456' });
    const data = exportMyData(db, tutor, NOW);
    expect(data.tutor).toMatchObject({ id: tutor.tutorId });
    expect((data.lessons as { tutorId: string }[]).every((l) => l.tutorId === tutor.tutorId)).toBe(true);
    expect(data.paymentDetails).toEqual({ accountName: 'Sarah Khan', bankName: 'Emirates NBD', ibanLast4: '3456' });
    expect(JSON.stringify(data)).not.toContain('AE070331234567890123456');
    expect(data.family).toBeNull();
    expect(data.students).toEqual([]);
  });

  it('gives a student only themselves', () => {
    const db = createSeed();
    const student = who(db, 'student');
    const data = exportMyData(db, student, NOW);
    expect((data.students as { id: string }[]).map((s) => s.id)).toEqual([student.studentId]);
    expect(data.invoices).toEqual([]);
  });

  it('gives an admin their account', () => {
    const db = createSeed();
    const data = exportMyData(db, who(db, 'admin'), NOW);
    expect(data.account).toMatchObject({ role: 'admin' });
    expect(data.family).toBeNull();
  });
});

describe('deleteMyAccount (mirrors delete-account)', () => {
  it('anonymises a family, keeps invoices and cancels future lessons', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    const familyId = parent.familyId!;
    const childIds = new Set(db.students.filter((s) => s.familyId === familyId).map((s) => s.id));
    const invoicesBefore = db.invoices.filter((i) => i.familyId === familyId).length;
    const future = db.lessons.filter((l) => l.status === 'scheduled' && l.start > NOW.toISOString() && l.studentIds.some((id) => childIds.has(id)));
    expect(future.length).toBeGreaterThan(0);

    const summary = deleteMyAccount(db, parent, NOW);

    expect(summary.invoicesRetained).toBe(invoicesBefore);
    expect(db.invoices.filter((i) => i.familyId === familyId)).toHaveLength(invoicesBefore);
    expect(summary.futureLessonsCancelled).toBe(future.length);
    for (const l of future) {
      const now = db.lessons.find((x) => x.id === l.id)!;
      expect(now.status === 'cancelled' ? now.cancelReason : 'group lesson kept').toMatch(/Account closed|group lesson kept/);
      expect(now.studentIds.some((id) => childIds.has(id))).toBe(now.status === 'cancelled');
    }
    const family = db.families.find((f) => f.id === familyId)!;
    expect(family.email).not.toBe(parent.email);
    expect(family.email).toMatch(/@deleted\.eliteeducation\.me$/);
    expect(family.status).toBe('archived');
    expect(db.students.filter((s) => childIds.has(s.id)).every((s) => s.fullName === 'Former student')).toBe(true);
    expect(db.profiles.some((p) => p.id === parent.id)).toBe(false);
    expect(db.messages.some((m) => m.familyId === familyId)).toBe(false);
    expect(db.homework.some((h) => childIds.has(h.studentId))).toBe(false);
    expect(family.deletedAt).toBeTruthy();
    expect(db.students.filter((s) => childIds.has(s.id)).every((s) => !!s.deletedAt)).toBe(true);
    // Lessons keep their date and tutor, but no address, meeting link or attendance for the children.
    const theirs = db.lessons.filter((l) => l.studentIds.some((id) => childIds.has(id)));
    expect(theirs.every((l) => l.address === undefined && l.meetingUrl === undefined)).toBe(true);
    expect(db.notes.every((n) => Object.keys(n.attendance).every((id) => !childIds.has(id)))).toBe(true);

    const requests = deletionRequests(db, who(db, 'admin'));
    expect(requests[0]).toMatchObject({ status: 'completed', targetKind: 'profile', role: 'parent', label: 'Parent account (closed)' });
    expect(requests[0].summary.invoicesRetained).toBe(invoicesBefore);
  });

  it('removes a tutor’s bank details and counts lessons needing a new tutor', () => {
    const db = createSeed();
    const tutor = who(db, 'tutor');
    const upcoming = db.lessons.filter((l) => l.tutorId === tutor.tutorId && l.status === 'scheduled' && l.start > NOW.toISOString()).length;
    const summary = deleteMyAccount(db, tutor, NOW);
    expect(summary.upcomingLessonsNeedingTutor).toBe(upcoming);
    expect(db.paymentDetails.some((p) => p.tutorId === tutor.tutorId)).toBe(false);
    expect(db.availability.some((a) => a.tutorId === tutor.tutorId)).toBe(false);
    expect(db.tutors.find((t) => t.id === tutor.tutorId)!.fullName).toBe('Former tutor');
    expect(db.tutors.find((t) => t.id === tutor.tutorId)!.deletedAt).toBeTruthy();
    expect(db.profiles.some((p) => p.id === tutor.id)).toBe(false);
  });

  it('keeps a student\'s messages in the family conversation without their name', () => {
    const db = createSeed();
    const student = who(db, 'student');
    const familyId = db.students.find((x) => x.id === student.studentId)!.familyId;
    db.messages.push({ id: 'm-test', familyId, senderId: student.id, senderName: student.fullName, senderRole: 'student', body: 'Thank you', createdAt: NOW.toISOString() });
    deleteMyAccount(db, student, NOW);
    const kept = db.messages.find((m) => m.id === 'm-test')!;
    expect(kept).toMatchObject({ senderName: 'Former student', body: 'Thank you' });
    expect(kept.senderId).toBeUndefined();
    expect(deletionRequests(db, who(db, 'admin'))[0].label).toBe('Student login (closed)');
  });

  it('refuses to delete the last administrator', () => {
    const db = createSeed();
    const admin = who(db, 'admin');
    expect(() => deleteMyAccount(db, admin, NOW)).toThrow(LAST_ADMIN_MESSAGE);
    expect(db.profiles.some((p) => p.id === admin.id)).toBe(true);
  });

  it('keeps other demo accounts working', () => {
    const db = createSeed();
    deleteMyAccount(db, who(db, 'parent'), NOW);
    expect(['admin', 'tutor'].every((role) => db.profiles.some((p) => p.role === role))).toBe(true);
  });
});

describe('admin deletion requests', () => {
  it('records, cancels and processes requests', () => {
    const db = createSeed();
    const admin = who(db, 'admin');
    const familyId = who(db, 'parent').familyId!;
    const id = recordDeletionRequest(db, admin, { familyId, reason: 'Asked by email' }, NOW);
    expect(() => recordDeletionRequest(db, admin, { familyId }, NOW)).toThrow(/already an open deletion request/);
    cancelDeletionRequest(db, admin, id);
    expect(deletionRequests(db, admin)[0].status).toBe('cancelled');

    const again = recordDeletionRequest(db, admin, { familyId }, NOW);
    const summary = processDeletionRequest(db, admin, again, NOW);
    const done = deletionRequests(db, admin).find((r) => r.id === again)!;
    expect(done.status).toBe('completed');
    expect(done.summary).toEqual(summary);
    expect(() => cancelDeletionRequest(db, admin, again)).toThrow();
  });

  it('is for admins only', () => {
    const db = createSeed();
    expect(() => recordDeletionRequest(db, who(db, 'parent'), { familyId: 'x' })).toThrow();
    expect(() => deletionRequests(db, who(db, 'tutor'))).toThrow();
  });
});

describe('logAppError and systemHealth', () => {
  it('keeps only the newest errors', () => {
    const db = createSeed();
    for (let i = 0; i < APP_ERROR_CAP + 25; i++) {
      logAppError(db, null, { message: `Error ${i}`, platform: 'web', source: 'query' }, new Date(NOW.getTime() + i * 1000));
    }
    expect(db.appErrors).toHaveLength(APP_ERROR_CAP);
    expect(db.appErrors![0].message).toBe('Error 25');
    const admin = who(db, 'admin');
    expect(appErrors(db, admin, 5).map((e) => e.message)).toEqual(['Error 224', 'Error 223', 'Error 222', 'Error 221', 'Error 220']);
  });

  it('reports eight checks, the jobs and the database version', () => {
    const db = createSeed();
    const health = systemHealth(db, who(db, 'admin'), NOW);
    expect(health.checks.map((c) => c.key)).toEqual(['notifications', 'whatsapp', 'calendar', 'autopay', 'stripe', 'server-errors', 'app-errors', 'backups']);
    expect(health.database.latest).toBe('20261020000000');
    expect(health.database.latestName).toBe('launch');
    expect(health.database.count).toBe(KNOWN_MIGRATIONS.length);
    expect(health.jobs.length).toBeGreaterThan(0);
    expect(health.checks.every((c) => c.detail.endsWith('.'))).toBe(true);
  });

  it('flags recent app errors', () => {
    const db = createSeed();
    logAppError(db, who(db, 'parent'), { message: 'Boom', platform: 'ios', source: 'boundary' }, NOW);
    const health = systemHealth(db, who(db, 'admin'), NOW);
    expect(health.checks.find((c) => c.key === 'app-errors')!.status).toBe('warning');
    expect(health.status).toBe('warning');
    expect(() => systemHealth(db, who(db, 'parent'), NOW)).toThrow();
  });
});
