import { isVettingBlock } from '@/domain/vetting';
import type { Profile } from '@/domain/types';

import { AccessError, cmd, enr } from '../demo/db';
import { eq } from '../demo/engagement';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';
import { vet } from '../demo/vetting';
import type { NewLesson } from '../source';

const NOW = new Date(2026, 9, 4, 12, 0);
const LATER = new Date(2026, 9, 5, 12, 0);
type DB = ReturnType<typeof createSeed>;
const who = (db: DB, role: string) => db.profiles.find((p) => p.role === role)!;
const james: Profile = { id: 'u-james', role: 'tutor', fullName: 'James Wilson', email: 'james@eliteeducation.me', tutorId: 't-james' };
const lesson = (tutorId: string): NewLesson => ({
  tutorId, studentIds: ['s-omar'], serviceId: 'svc-ib', subject: 'Maths', start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T11:00:00.000Z', location: 'online',
});
const statusOf = (db: DB, tutorId: string, now = NOW) => vet.compliance(db, who(db, 'admin'), now).find((c) => c.tutorId === tutorId)?.vettingStatus;

describe('seeded vetting', () => {
  it('has Craig and Nour cleared, Sarah expiring and James missing', () => {
    const db = createSeed(NOW);
    expect(statusOf(db, 't-craig')).toBe('cleared');
    expect(statusOf(db, 't-nour')).toBe('cleared');
    expect(statusOf(db, 't-sarah')).toBe('expiring');
    expect(statusOf(db, 't-james')).toBe('missing');
    expect(vet.enforced(db)).toBe(true);
    const sarah = vet.compliance(db, who(db, 'tutor'), NOW);
    expect(sarah).toHaveLength(1);
    expect(sarah[0]).toMatchObject({ tutorId: 't-sarah', bankDetails: true, calendarConnected: true, handbookVersion: 1 });
    expect(sarah[0].handbookAcknowledgedVersion).toBeUndefined();
  });
});

describe('enforcement (mirrors the database guard)', () => {
  it('blocks new lessons for James but not Sarah', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    expect(() => cmd.createLessons(db, admin, [lesson('t-james')], NOW)).toThrow(
      'Police clearance required: James Wilson cannot be assigned new lessons',
    );
    expect(cmd.createLessons(db, admin, [lesson('t-sarah')], NOW)).toHaveLength(1);
  });

  it('never blocks rescheduling an existing lesson', () => {
    const db = createSeed(NOW);
    const existing = db.lessons.find((l) => l.tutorId === 't-james' && l.status === 'scheduled')!;
    cmd.rescheduleLesson(db, who(db, 'admin'), existing.id, '2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z');
    expect(db.lessons.find((l) => l.id === existing.id)?.start).toBe('2026-11-01T10:00:00.000Z');
  });

  it('blocks awarding a role, a new student and a reassigned lesson to James', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const bid = db.bids.find((b) => b.tutorId === 't-james' && b.status === 'pending')!;
    let error: unknown;
    try {
      ops.awardOpportunity(db, admin, bid.id, NOW);
    } catch (e) {
      error = e;
    }
    expect(isVettingBlock(error)).toBe(true);
    expect((error as Error).message).toContain('cannot be awarded roles');
    expect(() => enr.saveEnrolment(db, admin, { studentId: 's-omar', subject: 'Physics', curriculum: 'IB DP', tutorId: 't-james', active: true }, NOW)).toThrow(
      'cannot be given new students',
    );
    const sarahLesson = db.lessons.find((l) => l.tutorId === 't-sarah' && l.status === 'scheduled' && l.start > NOW.toISOString())!;
    expect(() => eq.reassignLesson(db, admin, sarahLesson.id, 't-james', NOW)).toThrow('Police clearance required');
  });

  it('lets an override through until it is revoked', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    expect(() => vet.grantOverride(db, admin, 't-james', 'Soon', 14, NOW)).toThrow('at least 10 characters');
    expect(() => vet.grantOverride(db, who(db, 'tutor'), 't-james', 'Certificate is in the post', 14, NOW)).toThrow(AccessError);
    const id = vet.grantOverride(db, admin, 't-james', 'Certificate is in the post', 14, NOW);
    expect(db.outbox.at(-1)?.subject).toBe('Clearance override recorded for James Wilson');
    expect(vet.overrides(db, admin)[0].expiresAt).toBe(new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
    expect(vet.compliance(db, admin, NOW).find((c) => c.tutorId === 't-james')?.override).toMatchObject({ id, reason: 'Certificate is in the post' });
    expect(cmd.createLessons(db, admin, [lesson('t-james')], NOW)).toHaveLength(1);
    vet.revokeOverride(db, admin, id, NOW);
    expect(() => vet.revokeOverride(db, admin, id, NOW)).toThrow('That override has already ended');
    expect(() => cmd.createLessons(db, admin, [lesson('t-james')], NOW)).toThrow('Police clearance required');
    expect(vet.overrides(db, admin, { tutorId: 't-james' })[0].revokedByName).toBe("Craig O'Brien");
  });

  it('allows everything when enforcement is off', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    expect(() => vet.setEnforced(db, who(db, 'tutor'), false)).toThrow(AccessError);
    vet.setEnforced(db, admin, false);
    expect(cmd.createLessons(db, admin, [lesson('t-james')], NOW)).toHaveLength(1);
    expect(vet.compliance(db, admin, NOW).every((c) => !c.enforced)).toBe(true);
  });
});

describe('documents', () => {
  it('lets James upload, the office verify, and then assigns him lessons', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const input = { tutorId: 't-james', type: 'police_clearance' as const, filePath: 'tutors/t-james/f1-clearance.pdf', fileName: 'clearance.pdf' };
    expect(() => vet.submitDocument(db, james, { ...input, tutorId: 't-sarah', filePath: 'tutors/t-sarah/x.pdf' }, NOW)).toThrow(AccessError);
    const doc = vet.submitDocument(db, james, input, NOW);
    expect(doc.status).toBe('pending');
    expect(db.outbox.at(-1)).toMatchObject({ subject: 'Document to review: James Wilson', url: '/manage/vetting/t-james' });
    expect(db.outbox.at(-1)?.body).toContain('A new police clearance certificate has been uploaded for James Wilson.');
    expect(statusOf(db, 't-james')).toBe('pending');
    expect(() => vet.reviewDocument(db, james, doc.id, { approve: true, expiryDate: '2027-10-01' }, NOW)).toThrow(AccessError);
    expect(() => vet.reviewDocument(db, admin, doc.id, { approve: true }, NOW)).toThrow('Please enter the expiry date');
    expect(() => vet.reviewDocument(db, admin, doc.id, { approve: true, expiryDate: '2026-10-01' }, NOW)).toThrow('This certificate has already expired');
    expect(() => vet.reviewDocument(db, admin, doc.id, { approve: false }, NOW)).toThrow('Please give a reason');
    vet.reviewDocument(db, admin, doc.id, { approve: true, issueDate: '2026-09-20', expiryDate: '2027-09-20' }, NOW);
    expect(vet.documents(db, james)[0]).toMatchObject({ status: 'verified', verifiedByName: "Craig O'Brien", expiryDate: '2027-09-20' });
    expect(statusOf(db, 't-james')).toBe('cleared');
    expect(cmd.createLessons(db, admin, [lesson('t-james')], NOW)).toHaveLength(1);
    // A verified document can be reviewed again to correct its dates.
    vet.reviewDocument(db, admin, doc.id, { approve: true, expiryDate: '2027-09-21' }, NOW);
    expect(vet.documents(db, admin, { tutorId: 't-james' })[0].expiryDate).toBe('2027-09-21');
    expect(() => vet.submitDocument(db, james, { ...input, filePath: 'tutors/t-sarah/x.pdf' }, NOW)).toThrow('not uploaded to the right place');
  });

  it('keeps documents private to the tutor and the office', () => {
    const db = createSeed(NOW);
    expect(vet.documents(db, who(db, 'tutor')).every((d) => d.tutorId === 't-sarah')).toBe(true);
    expect(vet.documents(db, who(db, 'tutor'), { tutorId: 't-craig' })).toEqual([]);
    expect(vet.documents(db, who(db, 'parent'))).toEqual([]);
    expect(vet.documents(db, who(db, 'student'))).toEqual([]);
    expect(vet.compliance(db, who(db, 'parent'), NOW)).toEqual([]);
    expect(vet.overrides(db, who(db, 'parent'))).toEqual([]);
    expect(vet.documents(db, who(db, 'admin')).length).toBe(4);
    expect(() => vet.submitDocument(db, who(db, 'parent'), { tutorId: 't-sarah', type: 'other', filePath: 'tutors/t-sarah/x.pdf' }, NOW)).toThrow(AccessError);
  });

  it('lets tutors remove their own unverified documents only', () => {
    const db = createSeed(NOW);
    const tutor = who(db, 'tutor');
    expect(() => vet.deleteDocument(db, tutor, 'doc-sarah-police')).toThrow(AccessError);
    expect(() => vet.deleteDocument(db, tutor, 'doc-craig-police')).toThrow('Document not found');
    const doc = vet.submitDocument(db, tutor, { tutorId: 't-sarah', type: 'police_clearance', filePath: 'tutors/t-sarah/renewal.pdf' }, NOW);
    expect(statusOf(db, 't-sarah')).toBe('expiring');
    expect(vet.deleteDocument(db, tutor, doc.id)).toBe('tutors/t-sarah/renewal.pdf');
    expect(vet.deleteDocument(db, who(db, 'admin'), 'doc-sarah-police')).toBe('tutors/t-sarah/police-clearance.pdf');
    expect(statusOf(db, 't-sarah')).toBe('missing');
  });
});

describe('handbook', () => {
  it('publishes new versions and records acknowledgements of the current one', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const sarah = who(db, 'tutor');
    expect(vet.handbookVersions(db, sarah).map((h) => h.version)).toEqual([1]);
    expect(vet.handbookVersions(db, who(db, 'parent'))).toEqual([]);
    expect(() => vet.publishHandbook(db, sarah, 'Handbook', 'Body', NOW)).toThrow(AccessError);
    const v2 = vet.publishHandbook(db, admin, 'Elite Education Tutor Handbook', '# Updated', LATER);
    expect(v2).toMatchObject({ version: 2, publishedByName: "Craig O'Brien" });
    expect(vet.handbookVersions(db, admin).map((h) => h.version)).toEqual([2, 1]);
    expect(() => vet.acknowledgeHandbook(db, sarah, 1, LATER)).toThrow('current version');
    vet.acknowledgeHandbook(db, sarah, 2, LATER);
    vet.acknowledgeHandbook(db, sarah, 2, LATER);
    expect(vet.handbookAcks(db, sarah)).toEqual([{ tutorId: 't-sarah', version: 2, acknowledgedAt: LATER.toISOString() }]);
    expect(vet.handbookAcks(db, admin).length).toBe(3);
    expect(vet.compliance(db, sarah, LATER)[0]).toMatchObject({ handbookVersion: 2, handbookAcknowledgedVersion: 2 });
    expect(vet.compliance(db, admin, LATER).find((c) => c.tutorId === 't-craig')).toMatchObject({ handbookVersion: 2, handbookAcknowledgedVersion: 1 });
    expect(() => vet.acknowledgeHandbook(db, who(db, 'parent'), 2, LATER)).toThrow(AccessError);
  });
});

describe('onboarding', () => {
  it('starts when an application is marked hired', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    ops.submitApplication(db, { fullName: 'Hannah Reid', email: 'hannah@example.com', curricula: ['IB DP'] }, NOW);
    const app = db.applications.at(-1)!;
    db.tutors.push({ ...db.tutors.find((t) => t.id === 't-james')!, id: 't-hannah', fullName: 'Hannah Reid', email: 'hannah@example.com' });
    ops.updateApplication(db, admin, app.id, { status: 'hired', tutorId: 't-hannah' }, NOW);
    ops.updateApplication(db, admin, app.id, { notes: 'Welcome pack sent' }, LATER);
    const row = vet.compliance(db, admin, NOW).find((c) => c.tutorId === 't-hannah')!;
    expect(row).toMatchObject({ onboardingStartedAt: NOW.toISOString(), vettingStatus: 'missing', bankDetails: false });
  });
});

describe('tutor notifications in the demo (mirrors notify_tutor)', () => {
  it('publishing the handbook notifies every tutor but the publisher, and an admin who tutors can acknowledge it', () => {
    const db = createSeed(NOW);
    const craig = who(db, 'admin');
    expect(craig.tutorId).toBe('t-craig');
    const v = vet.publishHandbook(db, craig, 'Elite Education Tutor Handbook', '# Handbook\n\nUpdated.', NOW);
    const sent = db.outbox.filter((o) => o.audience === 'tutor' && o.subject === 'Updated tutor handbook');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((o) => o.url === '/handbook' && o.body.includes(`version ${v.version}`))).toBe(true);
    expect(sent.some((o) => o.tutorId === 't-craig')).toBe(false);
    expect(sent.find((o) => o.tutorId === 't-sarah')?.body).toMatch(/^Dear Sarah,/);

    const craigRow = () => vet.compliance(db, craig, NOW).find((c) => c.tutorId === 't-craig')!;
    expect(craigRow().handbookAcknowledgedVersion ?? 0).toBeLessThan(v.version);
    vet.acknowledgeHandbook(db, craig, v.version, NOW);
    expect(craigRow()).toMatchObject({ handbookVersion: v.version, handbookAcknowledgedVersion: v.version });
  });

  it('verifying or rejecting a document tells a tutor with a login, without the file path', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const sarah = who(db, 'tutor');
    const doc = vet.submitDocument(db, sarah, { tutorId: 't-sarah', type: 'police_clearance', filePath: 'tutors/t-sarah/pcc.pdf', fileName: 'pcc.pdf', expiryDate: '2027-10-05' }, NOW);
    vet.reviewDocument(db, admin, doc.id, { approve: true }, NOW);
    const verified = db.outbox.filter((o) => o.audience === 'tutor' && o.tutorId === 't-sarah').at(-1)!;
    expect(verified).toMatchObject({ subject: 'Your police clearance has been verified', url: '/checks' });
    expect(verified.body).toContain('valid until 5 October 2027');
    const other = vet.submitDocument(db, sarah, { tutorId: 't-sarah', type: 'passport_id', filePath: 'tutors/t-sarah/id.pdf', fileName: 'id.pdf' }, NOW);
    vet.reviewDocument(db, admin, other.id, { approve: false, note: 'The photo is too blurred to read.' }, NOW);
    const rejected = db.outbox.filter((o) => o.audience === 'tutor' && o.tutorId === 't-sarah').at(-1)!;
    expect(rejected.subject).toBe('Please upload a new passport or Emirates ID');
    expect(rejected.body).toContain('The photo is too blurred to read.');
    expect(db.outbox.some((o) => o.body.includes('tutors/') || o.subject.includes('tutors/'))).toBe(false);
  });
});
