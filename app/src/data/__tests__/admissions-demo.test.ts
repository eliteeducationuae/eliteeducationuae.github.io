import { invoicesForCase } from '@/domain/admissions';
import type { Profile } from '@/domain/types';

import { adm, seedAdmissions } from '../demo/admissions';
import { AccessError, visibleStudentIds, type DemoDB } from '../demo/db';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 4, 12, 0);
const UCAS = 'adm-omar-ucas';
const BOARDING = 'adm-layla-boarding';
const who = (db: DemoDB, id: string) => db.profiles.find((p) => p.id === id)!;
const otherParent: Profile = { id: 'u-haddad', role: 'parent', fullName: 'Rami Haddad', email: 'rami@example.com', familyId: 'f-haddad' };
const nour: Profile = { id: 'u-nour', role: 'tutor', fullName: 'Nour', email: 'nour@eliteeducation.me', tutorId: 't-nour' };

function fresh(): DemoDB {
  const db = createSeed(NOW);
  db.admissions = seedAdmissions(db, NOW);
  return db;
}

describe('seeded admissions', () => {
  it('seeds lazily when a saved database has none', () => {
    const db = createSeed(NOW);
    delete db.admissions;
    expect(adm.cases(db, who(db, 'u-admin')).map((c) => c.id).sort()).toEqual([BOARDING, UCAS]);
    expect(db.admissions).toBeDefined();
  });

  it('links Omar’s prep course to his Maths enrolment', () => {
    const db = fresh();
    const test = adm.dates(db, who(db, 'u-admin'), { caseId: UCAS }).find((d) => d.kind === 'test')!;
    expect(db.enrolments.find((e) => e.id === test.enrolmentId)).toMatchObject({ studentId: 's-omar', subject: 'Maths' });
  });

  it('filters key dates by range', () => {
    const db = fresh();
    const all = adm.dates(db, who(db, 'u-admin'));
    const soon = adm.dates(db, who(db, 'u-admin'), { from: '2026-10-04', to: '2026-10-13' });
    expect(soon.length).toBeGreaterThan(0);
    expect(soon.length).toBeLessThan(all.length);
    expect(soon.every((d) => d.dueOn >= '2026-10-04' && d.dueOn <= '2026-10-13')).toBe(true);
  });
});

describe('admissions visibility', () => {
  it('shows the parent both Mansoori cases and another family none', () => {
    const db = fresh();
    expect(adm.cases(db, who(db, 'u-parent')).map((c) => c.id).sort()).toEqual([BOARDING, UCAS]);
    expect(adm.cases(db, otherParent)).toEqual([]);
    expect(adm.getCase(db, otherParent, UCAS)).toBeNull();
    expect(adm.targets(db, otherParent)).toEqual([]);
  });

  it('shows the student only their own case', () => {
    const db = fresh();
    expect(adm.cases(db, who(db, 'u-student')).map((c) => c.id)).toEqual([UCAS]);
  });

  it('shows the adviser only her case, even though she teaches Layla', () => {
    const db = fresh();
    const sarah = who(db, 'u-tutor');
    expect(visibleStudentIds(db, sarah).has('s-layla')).toBe(true);
    expect(adm.cases(db, sarah).map((c) => c.id)).toEqual([UCAS]);
    expect(adm.getCase(db, sarah, BOARDING)).toBeNull();
    expect(adm.targets(db, sarah, { caseId: BOARDING })).toEqual([]);
    expect(() => adm.saveTarget(db, sarah, { caseId: BOARDING, institution: 'Roedean', status: 'researching' })).toThrow('not found');
    const added = adm.saveTarget(db, sarah, { caseId: UCAS, institution: 'University of Bristol', programme: 'Economics', status: 'researching' }, NOW);
    expect(added.sort).toBe(5);
    expect(adm.events(db, sarah, { caseId: UCAS })[0].title).toBe('University of Bristol added to the shortlist');
    adm.saveTarget(db, sarah, { id: added.id, caseId: UCAS, institution: 'University of Bristol', status: 'submitted' }, NOW);
    expect(adm.events(db, sarah, { caseId: UCAS }).some((e) => e.title === 'Application submitted to University of Bristol')).toBe(true);
  });

  it('gives a teaching tutor who is not the adviser nothing', () => {
    const db = fresh();
    expect(visibleStudentIds(db, nour).has('s-omar')).toBe(true);
    expect(adm.cases(db, nour)).toEqual([]);
    expect(adm.events(db, nour)).toEqual([]);
  });

  it('hides unshared documents and unsent updates from the family', () => {
    const db = fresh();
    const parent = who(db, 'u-parent');
    const docs = adm.documents(db, parent, { caseId: UCAS }).map((d) => d.name);
    expect(docs).toContain('Year 11 IGCSE results.pdf');
    expect(docs).not.toContain('Draft reference notes.pdf');
    expect(adm.documents(db, who(db, 'u-tutor'), { caseId: UCAS }).map((d) => d.name)).toContain('Draft reference notes.pdf');
    const updates = adm.updates(db, parent, { caseId: UCAS });
    expect(updates.every((u) => u.status === 'published')).toBe(true);
    expect(updates).toHaveLength(1);
    expect(adm.updates(db, who(db, 'u-tutor'), { caseId: UCAS }).some((u) => u.status === 'submitted')).toBe(true);
    expect(adm.events(db, parent, { caseId: UCAS }).every((e) => e.familyVisible)).toBe(true);
    expect(adm.events(db, parent, { caseId: UCAS }).some((e) => e.title.includes('reference'))).toBe(false);
  });
});

describe('admissions family actions', () => {
  it('lets the parent complete a family task but not an adviser task', () => {
    const db = fresh();
    const parent = who(db, 'u-parent');
    adm.setTaskDone(db, parent, 'atk-report', true, NOW);
    const task = adm.tasks(db, parent, { caseId: UCAS }).find((t) => t.id === 'atk-report')!;
    expect(task).toMatchObject({ doneByName: 'Fatima Al Mansoori' });
    expect(adm.events(db, parent, { caseId: UCAS })[0].title).toBe('Completed: Send the latest school report to your adviser');
    expect(() => adm.setTaskDone(db, parent, 'atk-reading', true, NOW)).toThrow(AccessError);
    expect(() => adm.saveTask(db, parent, { caseId: UCAS, title: 'Mine', owner: 'family' })).toThrow(AccessError);
  });

  it('shares family uploads and records them', () => {
    const db = fresh();
    const parent = who(db, 'u-parent');
    const doc = adm.addDocument(db, parent, { caseId: UCAS, category: 'identity', name: 'Passport.pdf', path: `cases/${UCAS}/passport.pdf`, familyVisible: false }, NOW);
    expect(doc.familyVisible).toBe(true);
    expect(adm.events(db, parent, { caseId: UCAS })[0]).toMatchObject({ title: 'Document added: Passport.pdf', familyVisible: true });
    expect(() => adm.addDocument(db, parent, { caseId: UCAS, category: 'other', name: 'Elsewhere.pdf', path: 'cases/other/x.pdf' })).toThrow('could not be accepted');
    expect(() => adm.deleteDocument(db, parent, 'adc-igcse')).not.toThrow();
    expect(() => adm.deleteDocument(db, parent, 'adc-layla-report')).toThrow(AccessError);
    expect(() => adm.deleteDocument(db, parent, 'adc-reference')).toThrow('not found');
    expect(adm.deleteDocument(db, parent, doc.id)).toBe(`cases/${UCAS}/passport.pdf`);
  });

  it('keeps staff-only documents out of the family timeline', () => {
    const db = fresh();
    const sarah = who(db, 'u-tutor');
    adm.addDocument(db, sarah, { caseId: UCAS, category: 'reference', name: 'Reference v2.pdf', path: `cases/${UCAS}/ref2.pdf`, familyVisible: false }, NOW);
    expect(adm.events(db, sarah, { caseId: UCAS })[0]).toMatchObject({ title: 'Document added: Reference v2.pdf', familyVisible: false });
    expect(adm.events(db, who(db, 'u-parent'), { caseId: UCAS }).some((e) => e.title.includes('Reference v2'))).toBe(false);
  });

  it('refuses a second document for a file already listed, so a confidential file stays confidential', () => {
    const db = fresh();
    const parent = who(db, 'u-parent');
    const ref = adm.documents(db, who(db, 'u-tutor'), { caseId: UCAS }).find((d) => d.id === 'adc-reference')!;
    expect(ref.familyVisible).toBe(false);
    expect(() => adm.addDocument(db, parent, { caseId: UCAS, category: 'other', name: 'x', path: ref.path, familyVisible: true })).toThrow(
      'could not be accepted',
    );
    expect(adm.documents(db, parent, { caseId: UCAS }).some((d) => d.path === ref.path)).toBe(false);
  });
});

describe('advisory updates', () => {
  it('runs adviser submit, admin publish, family read', () => {
    const db = fresh();
    const sarah = who(db, 'u-tutor');
    const admin = who(db, 'u-admin');
    const parent = who(db, 'u-parent');
    const draft = adm.saveUpdate(db, sarah, { caseId: UCAS, kind: 'ad-hoc', title: 'Interview preparation', body: 'Omar has been invited to interview.' }, NOW);
    expect(draft).toMatchObject({ status: 'draft', authorName: 'Sarah Khan' });
    adm.setUpdateStatus(db, sarah, draft.id, 'submitted', NOW);
    expect(() => adm.setUpdateStatus(db, sarah, draft.id, 'published', NOW)).toThrow(AccessError);
    expect(adm.updates(db, parent, { caseId: UCAS }).some((u) => u.id === draft.id)).toBe(false);
    adm.setUpdateStatus(db, admin, draft.id, 'published', NOW);
    expect(adm.updates(db, parent, { caseId: UCAS }).find((u) => u.id === draft.id)).toMatchObject({ status: 'published' });
    expect(adm.events(db, parent, { caseId: UCAS }).some((e) => e.title === 'Advisory update sent: Interview preparation')).toBe(true);
    expect(() => adm.setUpdateStatus(db, admin, draft.id, 'draft', NOW)).toThrow('cannot be withdrawn');
    expect(() => adm.saveUpdate(db, admin, { id: draft.id, caseId: UCAS, kind: 'ad-hoc', title: 'x', body: 'y' })).toThrow('cannot be changed');
  });

  it('lets the admin publish the seeded submitted update', () => {
    const db = fresh();
    adm.setUpdateStatus(db, who(db, 'u-admin'), 'aup-omar-current', 'published', NOW);
    expect(adm.updates(db, who(db, 'u-parent'), { caseId: UCAS })).toHaveLength(2);
  });

  it('refuses to publish an empty update', () => {
    const db = fresh();
    const admin = who(db, 'u-admin');
    const empty = adm.saveUpdate(db, admin, { caseId: BOARDING, kind: 'ad-hoc', title: 'Placeholder', body: '   ' }, NOW);
    expect(() => adm.setUpdateStatus(db, admin, empty.id, 'published', NOW)).toThrow('write the update');
  });
});

describe('cases and fees', () => {
  it('lets only the admin open a case and the adviser change summary and status only', () => {
    const db = fresh();
    const admin = who(db, 'u-admin');
    const sarah = who(db, 'u-tutor');
    expect(() => adm.saveCase(db, sarah, { studentId: 's-omar', kind: 'us-university', title: 'US', status: 'active' })).toThrow(AccessError);
    const created = adm.saveCase(db, admin, { studentId: 's-omar', kind: 'us-university', title: 'US universities', status: 'active', adviserTutorId: 't-sarah' }, NOW);
    expect(created.familyId).toBe('f-mansoori');
    expect(adm.events(db, sarah, { caseId: created.id })[0].title).toBe('Admissions advisory opened: US universities');
    const ucas = adm.getCase(db, sarah, UCAS)!;
    const base = { id: UCAS, studentId: ucas.studentId, kind: ucas.kind, title: ucas.title, entryYear: ucas.entryYear, status: ucas.status, adviserTutorId: ucas.adviserTutorId };
    expect(adm.saveCase(db, sarah, { ...base, status: 'on-hold', summary: 'Paused for exams.' }, NOW)).toMatchObject({ status: 'on-hold', summary: 'Paused for exams.' });
    // Other fields from the adviser are ignored, as on the server.
    expect(adm.saveCase(db, sarah, { ...base, adviserTutorId: null, title: 'Renamed' }, NOW)).toMatchObject({ adviserTutorId: 't-sarah', title: ucas.title });
  });

  it('bills fees for the admin only, as a sent invoice linked to the case', () => {
    const db = fresh();
    const before = db.settings.nextInvoiceNumber;
    expect(() => adm.billFee(db, who(db, 'u-tutor'), { caseId: UCAS, description: 'Package', quantity: 1, unitPrice: 5000 })).toThrow(AccessError);
    expect(() => adm.billFee(db, who(db, 'u-admin'), { caseId: UCAS, description: 'Package', quantity: 0, unitPrice: 5000 })).toThrow('quantity');
    const invoice = adm.billFee(db, who(db, 'u-admin'), { caseId: UCAS, description: 'Admissions advisory package — UCAS', quantity: 1, unitPrice: 5000 }, NOW);
    expect(invoice).toMatchObject({ status: 'sent', familyId: 'f-mansoori' });
    expect(db.settings.nextInvoiceNumber).toBe(before + 1);
    expect(invoicesForCase(db.invoices, UCAS).map((i) => i.id)).toEqual([invoice.id]);
  });
});
