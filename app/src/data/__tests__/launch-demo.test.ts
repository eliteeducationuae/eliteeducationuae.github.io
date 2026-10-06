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
import { adm } from '../demo/admissions';
import { auditedWrite } from '../demo/audit';
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

describe('exportMyData: round 5 records (mirrors 20261113000800_launch_fix)', () => {
  it('gives a parent the admissions shortlist, key dates, tasks and timeline, and only shared lesson plans', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    const data = exportMyData(db, parent, NOW);
    const cases = data.admissions as { shortlist: unknown[]; keyDates: unknown[]; tasks: unknown[]; timeline: unknown[] }[];
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c) => c.shortlist.length && c.keyDates.length && c.tasks.length && c.timeline.length)).toBe(true);
    const staffOnly = (db.admissions?.events ?? []).filter((e) => !e.familyVisible).map((e) => e.title);
    expect(JSON.stringify(cases)).not.toContain(staffOnly[0] ?? '\u0000');
    for (const key of ['familyContacts', 'creditNotes', 'refunds', 'agreedPrices', 'lessonPlans']) expect(Array.isArray(data[key])).toBe(true);
    const shared = new Set((db.lessonPlans ?? []).filter((p) => p.sharedWithFamily).map((p) => p.lessonId));
    expect((data.lessonPlans as { lessonId: string }[]).every((p) => shared.has(p.lessonId))).toBe(true);
    expect(data.tutorPay).toEqual([]);
    expect(data.handovers).toEqual([]);
  });

  it('gives a tutor their pay rates, handover packs, lesson plans and vetting overrides', () => {
    const db = createSeed();
    const tutor = who(db, 'tutor');
    const data = exportMyData(db, tutor, NOW);
    const pay = db.enrolments.filter((e) => e.tutorId === tutor.tutorId && e.tutorPay !== undefined);
    expect(data.tutorPay).toHaveLength(pay.length);
    expect((data.handovers as unknown[]).length).toBe((db.handovers ?? []).filter((h) => h.toTutorId === tutor.tutorId || h.fromTutorId === tutor.tutorId).length);
    expect(Array.isArray(data.lessonPlans) && Array.isArray(data.vettingOverrides)).toBe(true);
    expect(data.agreedPrices).toEqual([]);
    expect(data.admissions).toEqual([]);
  });
});

describe('deleteMyAccount (mirrors delete-account)', () => {
  it('keeps credit notes and refunds, and erases the family from the audit log', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    const familyId = parent.familyId!;
    const children = db.students.filter((s) => s.familyId === familyId).map((s) => s.fullName);
    const invoice = db.invoices.find((i) => i.familyId === familyId)!;
    db.creditNotes = [{ id: 'cn-1', number: 'CN-1', invoiceId: invoice.id, familyId, reason: 'Lesson cancelled' } as unknown as NonNullable<DB['creditNotes']>[number]];
    db.refunds = [{ id: 'rf-1', invoiceId: invoice.id, familyId, amount: 105, reason: 'Lesson cancelled' } as unknown as NonNullable<DB['refunds']>[number]];
    // A change to the family first, so the audit log holds its details.
    auditedWrite(db, parent, () => {
      db.families.find((f) => f.id === familyId)!.phone = '+971 50 123 4567';
    }, NOW);

    const summary = auditedWrite(db, parent, () => deleteMyAccount(db, parent, NOW), NOW);

    expect(summary).toMatchObject({ creditNotesRetained: 1, refundsRetained: 1 });
    expect(db.creditNotes).toHaveLength(1);
    expect(db.refunds).toHaveLength(1);
    const trail = JSON.stringify(db.audit ?? []);
    for (const personal of [parent.fullName, parent.email, '+971 50 123 4567', ...children]) expect(trail).not.toContain(personal);
    expect((db.audit ?? []).some((e) => e.familyIds.includes(familyId))).toBe(true);
  });

  it('replaces a closed tutor’s name beside the admissions documents they added', () => {
    const db = createSeed();
    const tutor = who(db, 'tutor');
    const docs = adm.store(db).documents.filter((d) => d.uploadedBy === tutor.id);
    expect(docs.length).toBeGreaterThan(0);
    deleteMyAccount(db, tutor, NOW);
    expect(docs.every((d) => d.uploadedByName === 'Former tutor')).toBe(true);
    expect(JSON.stringify(adm.store(db))).not.toContain(tutor.fullName);
  });

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

  it('closes only the login of a contact who is not the main contact (mirrors account_closes_own_login_only)', () => {
    const db = createSeed();
    const khalid = db.profiles.find((p) => p.id === 'u-parent2')!;
    const familyId = khalid.familyId!;
    const studentsBefore = db.students.filter((s) => s.familyId === familyId).map((s) => s.fullName);
    const otherLogins = db.profiles.filter((p) => p.id !== khalid.id && p.familyId === familyId).map((p) => p.id);
    expect(otherLogins.length).toBeGreaterThan(0);

    const summary = deleteMyAccount(db, khalid, NOW);

    expect(summary).toMatchObject({ loginOnly: true, familyAnonymised: false, role: 'parent' });
    const family = db.families.find((f) => f.id === familyId)!;
    expect(family.deletedAt).toBeFalsy();
    expect(family.status).not.toBe('archived');
    expect(db.students.filter((s) => s.familyId === familyId).map((s) => s.fullName)).toEqual(studentsBefore);
    expect(otherLogins.every((id) => db.profiles.some((p) => p.id === id && p.familyId === familyId))).toBe(true);
    expect(db.profiles.some((p) => p.id === khalid.id)).toBe(false);
    expect((db.familyContacts ?? []).some((c) => c.id === 'fc-khalid')).toBe(false);
    expect((db.familyContacts ?? []).some((c) => c.familyId === familyId && c.isPrimary)).toBe(true);
    expect(deletionRequests(db, who(db, 'admin'))[0]).toMatchObject({ label: 'Family contact login (closed)', familyId: undefined });

    // The main contact still closes the whole family.
    expect(deleteMyAccount(db, who(db, 'parent'), NOW).familyAnonymised).toBe(true);
    expect(db.families.find((f) => f.id === familyId)!.deletedAt).toBeTruthy();
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

  it('removes a closed administrator\'s name from advisory updates, admissions tasks and handbook versions', () => {
    const db = createSeed();
    const bea = { id: 'u-bea', role: 'admin' as const, fullName: 'Bea Adviser', email: 'bea@x' };
    db.profiles.push(bea);
    db.admissions = {
      cases: [], targets: [], dates: [], documents: [], events: [],
      updates: [{ id: 'aup-1', caseId: 'c-1', kind: 'ad-hoc', title: 'Statement', body: '', status: 'draft', aiAssisted: false, authorName: 'Bea Adviser', createdAt: NOW.toISOString() }],
      tasks: [{ id: 'at-1', caseId: 'c-1', title: 'Shortlist', owner: 'adviser', doneAt: NOW.toISOString(), doneByName: 'Bea Adviser' }],
    } as unknown as NonNullable<DB['admissions']>;
    (db.handbookVersions ??= []).push({ id: 'hb-9', version: 9, title: 'Handbook', body: 'Be on time.', publishedAt: NOW.toISOString(), publishedByName: 'Bea Adviser' });
    deleteMyAccount(db, bea, NOW);
    expect(db.admissions!.updates[0].authorName).toBe('Elite Education');
    expect(db.admissions!.tasks[0].doneByName).toBe('Elite Education');
    expect(db.handbookVersions!.find((h) => h.id === 'hb-9')!.publishedByName).toBe('Elite Education');
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
    expect(health.database.latest).toBe('20261114000200');
    expect(health.database.latestName).toBe('sec_db');
    expect(health.database.count).toBe(KNOWN_MIGRATIONS.length);
    expect(health.jobs.length).toBeGreaterThan(0);
    expect(health.checks.every((c) => c.detail.endsWith('.'))).toBe(true);
  });

  it('lists every migration file in supabase/migrations, in order', () => {
    // The app has no Node types, so the two calls the test needs are typed here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as { readdirSync: (dir: string) => string[] };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as { resolve: (...parts: string[]) => string };
    const files = fs
      .readdirSync(path.resolve('supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => ({ version: f.slice(0, 14), name: f.slice(15, -4) }));
    expect(KNOWN_MIGRATIONS).toEqual(files);
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
