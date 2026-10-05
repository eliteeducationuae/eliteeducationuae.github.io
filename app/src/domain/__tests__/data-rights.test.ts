import { canConfirmDeletion, deletionConsequences, deletionSummaryText, exportFileName, last4 } from '../data-rights';

describe('deletionConsequences', () => {
  it('tells parents that invoices are kept without contact details', () => {
    const c = deletionConsequences('parent');
    expect(c.removed.join(' ')).toMatch(/children's profiles/);
    expect(c.removed.join(' ')).toMatch(/future lessons/i);
    expect(c.kept.join(' ')).toMatch(/Invoices and payment records/);
    expect(c.note).toMatch(/UAE law/);
  });

  it('tells tutors their bank details go and upcoming lessons are reassigned', () => {
    const c = deletionConsequences('tutor');
    expect(c.removed).toContain('Your bank details');
    expect(c.kept.join(' ')).toMatch(/tax and pay records/);
    expect(c.note).toMatch(/reassigned/);
  });

  it('tells students the family records stay with the parent', () => {
    expect(deletionConsequences('student').note).toMatch(/parent's account/);
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
});

describe('last4', () => {
  it('keeps only the last four characters', () => {
    expect(last4('AE07 0331 2345 6789 0123 456')).toBe('3456');
    expect(last4('')).toBeUndefined();
  });
});
