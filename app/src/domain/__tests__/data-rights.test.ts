import {
  canConfirmDeletion,
  closesOwnLoginOnly,
  CONTACT_LOGIN_CONSEQUENCES,
  CONTACT_LOGIN_NOTE,
  deletionConsequences,
  deletionSummaryText,
  exportFileName,
  last4,
} from '../data-rights';
import type { FamilyContact } from '../types';

describe('deletionConsequences', () => {
  it('tells parents that invoices are kept without contact details', () => {
    const c = deletionConsequences('parent');
    expect(c.removed.join(' ')).toMatch(/children's profiles/);
    expect(c.removed.join(' ')).toMatch(/future lessons/i);
    expect(c.removed.join(' ')).toMatch(/children’s logins and any other parent login/);
    expect(c.kept.join(' ')).toMatch(/Lesson dates and invoices, without contact details/);
    expect(c.kept.join(' ')).toMatch(/UAE law/);
  });

  it.each(['parent', 'tutor', 'student', 'admin'] as const)('gives %s a note that adds something new', (role) => {
    const c = deletionConsequences(role);
    for (const item of c.kept) expect(c.note).not.toContain(item);
    expect(c.kept.join(' ')).not.toContain(c.note);
  });

  it('tells tutors their bank details go and upcoming lessons are reassigned', () => {
    const c = deletionConsequences('tutor');
    expect(c.removed).toContain('Your bank details');
    expect(c.kept.join(' ')).toMatch(/tax and pay records/);
    expect(c.note).toMatch(/reassign/);
  });

  it('tells students the family records stay with the parent', () => {
    const c = deletionConsequences('student');
    expect(c.kept.join(' ')).toMatch(/parent’s account/);
    expect(c.note).toMatch(/Your parent can ask us to remove/);
    expect(c.removed).toEqual(['Your login']);
    expect(c.kept.join(' ')).toMatch(/without your name/);
  });

  it('warns administrators about the last-administrator rule', () => {
    expect(deletionConsequences('admin').note).toMatch(/another administrator/);
  });
});

describe('canConfirmDeletion', () => {
  it('accepts DELETE exactly, ignoring surrounding spaces', () => {
    expect(canConfirmDeletion('DELETE')).toBe(true);
    expect(canConfirmDeletion('  DELETE ')).toBe(true);
  });
  it('is case-sensitive and rejects anything else', () => {
    expect(canConfirmDeletion('delete')).toBe(false);
    expect(canConfirmDeletion('Delete')).toBe(false);
    expect(canConfirmDeletion('DELETE ME')).toBe(false);
    expect(canConfirmDeletion('')).toBe(false);
  });
});

describe('exportFileName', () => {
  it('uses the local date', () => {
    expect(exportFileName(new Date(2026, 9, 4, 23, 30))).toBe('elite-education-data-2026-10-04.json');
    expect(exportFileName(new Date(2026, 0, 9), 'pdf')).toBe('elite-education-data-2026-01-09.pdf');
  });
});

describe('deletionSummaryText', () => {
  it('describes what was kept, cancelled and needs a tutor', () => {
    expect(deletionSummaryText({ invoicesRetained: 4, paymentsRetained: 3, futureLessonsCancelled: 2, upcomingLessonsNeedingTutor: 1 })).toBe(
      'Kept 4 invoices and 3 payments; cancelled 2 future lessons; 1 upcoming lesson needs a new tutor',
    );
  });
  it('uses the singular and says when nothing applied', () => {
    expect(deletionSummaryText({ invoicesRetained: 1, paymentsRetained: 0 })).toBe('Kept 1 invoice and 0 payments');
    expect(deletionSummaryText({})).toBe('Nothing needed to be kept or cancelled.');
    expect(deletionSummaryText(null)).toBe('');
  });
  it('names kept credit notes and refunds when there are any', () => {
    expect(deletionSummaryText({ invoicesRetained: 2, creditNotesRetained: 1, paymentsRetained: 2, refundsRetained: 1 })).toBe(
      'Kept 2 invoices, 1 credit note, 2 payments and 1 refund',
    );
    expect(deletionSummaryText({ invoicesRetained: 2, paymentsRetained: 3, refundsRetained: 2, studentsAnonymised: 1 })).toBe(
      'Kept 2 invoices, 3 payments and 2 refunds; anonymised 1 student',
    );
  });
});

describe('last4', () => {
  it('keeps only the last four characters', () => {
    expect(last4('AE07 0331 2345 6789 0123 456')).toBe('3456');
    expect(last4('')).toBeUndefined();
  });
});

describe('closesOwnLoginOnly (mirrors account_closes_own_login_only)', () => {
  const contact = (id: string, over: Partial<FamilyContact>): FamilyContact => ({
    id,
    familyId: 'f',
    name: id,
    relationship: 'parent',
    preferredChannel: 'email',
    canLogIn: true,
    receivesInvoices: true,
    receivesReports: true,
    receivesLessonNotes: true,
    receivesWhatsApp: false,
    emergencyContact: false,
    isPrimary: false,
    hasLogin: false,
    ...over,
  });
  const main = contact('main', { isPrimary: true, profileId: 'u-main', hasLogin: true });
  const driver = contact('driver', { relationship: 'driver', profileId: 'u-driver', hasLogin: true });

  it("closes only a non-main contact's own login", () => {
    expect(closesOwnLoginOnly([main, driver], 'u-driver')).toBe(true);
  });

  it('closes the family for the main contact, the last sign-in contact, or a login with no contact', () => {
    expect(closesOwnLoginOnly([main, driver], 'u-main')).toBe(false);
    expect(closesOwnLoginOnly([{ ...main, canLogIn: false, profileId: undefined }, driver], 'u-driver')).toBe(false);
    expect(closesOwnLoginOnly([main], 'u-other')).toBe(false);
  });

  it('says in plain words that the family stays with the main contact', () => {
    expect(CONTACT_LOGIN_NOTE).toBe("This closes your own sign-in only. The family's account and records stay with the main contact.");
    expect(CONTACT_LOGIN_CONSEQUENCES.kept.join(' ')).toMatch(/stay with the main contact/);
  });
});
