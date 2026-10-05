import type { TutorCompliance, TutorDocument, VettingOverride } from '../types';
import {
  activeOverride,
  blockedReasonPhrase,
  describeDateInput,
  maskDateInput,
  canAssignTutor,
  clearanceDocument,
  daysUntil,
  documentState,
  documentTypeLabel,
  dueAlertThreshold,
  isCleared,
  isVettingBlock,
  needsAttention,
  onboardingChecklist,
  onboardingProgress,
  validateDocumentDates,
  vettingBlockMessage,
  vettingStatus,
  vettingSummary,
} from '../vetting';

const TODAY = new Date(2026, 9, 4, 12, 0); // Sun 4 Oct 2026, midday

let n = 0;
function doc(patch: Partial<TutorDocument>): TutorDocument {
  n += 1;
  return {
    id: `d${n}`,
    tutorId: 't1',
    type: 'police_clearance',
    filePath: `tutors/t1/${n}.pdf`,
    status: 'verified',
    createdAt: new Date(2026, 0, n).toISOString(),
    ...patch,
  };
}

function comp(patch: Partial<TutorCompliance> = {}): TutorCompliance {
  return {
    tutorId: 't1',
    vettingStatus: 'cleared',
    clearanceExpiry: '2026-11-03',
    documentsPending: 0,
    bankDetails: true,
    availabilitySet: true,
    calendarConnected: false,
    whatsappOptIn: false,
    enforced: true,
    ...patch,
  };
}

describe('daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-10-04', TODAY)).toBe(0);
    expect(daysUntil('2026-10-05', TODAY)).toBe(1);
    expect(daysUntil('2026-10-03', TODAY)).toBe(-1);
    expect(daysUntil('2026-12-03', TODAY)).toBe(60);
  });
});

describe('vettingStatus', () => {
  it('is missing with no documents, or only rejected ones', () => {
    expect(vettingStatus([], TODAY)).toBe('missing');
    expect(vettingStatus([doc({ status: 'rejected', reviewNote: 'Unreadable' })], TODAY)).toBe('missing');
  });
  it('is pending while a clearance awaits review', () => {
    expect(vettingStatus([doc({ status: 'pending' })], TODAY)).toBe('pending');
  });
  it('is cleared with a verified clearance more than 60 days from expiry', () => {
    expect(vettingStatus([doc({ expiryDate: '2026-12-04' })], TODAY)).toBe('cleared'); // 61 days
    expect(vettingStatus([doc({ expiryDate: '2027-06-01' })], TODAY)).toBe('cleared');
  });
  it('is expiring at exactly 60 days and on the expiry day itself', () => {
    expect(vettingStatus([doc({ expiryDate: '2026-12-03' })], TODAY)).toBe('expiring');
    expect(vettingStatus([doc({ expiryDate: '2026-10-04' })], TODAY)).toBe('expiring');
  });
  it('is expired the day after expiry', () => {
    expect(vettingStatus([doc({ expiryDate: '2026-10-03' })], TODAY)).toBe('expired');
  });
  it('does not let a pending renewal downgrade a cleared tutor', () => {
    expect(vettingStatus([doc({ expiryDate: '2027-06-01' }), doc({ status: 'pending' })], TODAY)).toBe('cleared');
    expect(vettingStatus([doc({ expiryDate: '2026-10-03' }), doc({ status: 'pending' })], TODAY)).toBe('pending');
  });
  it('ignores other document types', () => {
    expect(vettingStatus([doc({ type: 'passport_id', expiryDate: '2030-01-01' })], TODAY)).toBe('missing');
    expect(vettingStatus([doc({ type: 'qualification', status: 'pending' })], TODAY)).toBe('missing');
  });
  it('picks the verified clearance with the latest expiry', () => {
    const later = doc({ expiryDate: '2027-08-01' });
    expect(clearanceDocument([doc({ expiryDate: '2027-01-01' }), later, doc({ status: 'pending' })], TODAY)).toBe(later);
  });
  it('treats cleared and expiring as cleared', () => {
    expect(isCleared('cleared')).toBe(true);
    expect(isCleared('expiring')).toBe(true);
    expect(isCleared('pending')).toBe(false);
    expect(isCleared('expired')).toBe(false);
    expect(isCleared('missing')).toBe(false);
  });
});

describe('documentState', () => {
  it('describes each document', () => {
    expect(documentState(doc({ status: 'pending' }), TODAY)).toBe('pending');
    expect(documentState(doc({ status: 'rejected' }), TODAY)).toBe('rejected');
    expect(documentState(doc({ expiryDate: '2027-06-01' }), TODAY)).toBe('verified');
    expect(documentState(doc({ type: 'qualification' }), TODAY)).toBe('verified');
    expect(documentState(doc({ expiryDate: '2026-10-29' }), TODAY)).toBe('expiring');
    expect(documentState(doc({ expiryDate: '2026-10-04' }), TODAY)).toBe('expiring');
    expect(documentState(doc({ expiryDate: '2026-10-03' }), TODAY)).toBe('expired');
  });
  it('labels document types', () => {
    expect(documentTypeLabel('police_clearance')).toBe('Police clearance certificate');
    expect(documentTypeLabel('passport_id')).toBe('Passport or Emirates ID');
  });
});

describe('dueAlertThreshold', () => {
  it('sends each reminder once, at the nearest threshold', () => {
    expect(dueAlertThreshold(61, [])).toBeNull();
    expect(dueAlertThreshold(60, [])).toBe(60);
    expect(dueAlertThreshold(25, [])).toBe(30);
    expect(dueAlertThreshold(25, [60, 30])).toBeNull();
    expect(dueAlertThreshold(6, [60, 30])).toBe(7);
    expect(dueAlertThreshold(5, [])).toBe(7);
    expect(dueAlertThreshold(0, [60, 30, 7])).toBe(0);
    expect(dueAlertThreshold(-3, [60, 30, 7])).toBe(0);
    expect(dueAlertThreshold(-3, [60, 30, 7, 0])).toBeNull();
  });
});

describe('overrides', () => {
  const now = new Date('2026-10-04T08:00:00Z');
  const o = (patch: Partial<VettingOverride>): VettingOverride => ({
    id: 'o', tutorId: 't1', reason: 'Certificate in the post', createdAt: '2026-10-01T08:00:00Z', expiresAt: '2026-10-15T08:00:00Z', ...patch,
  });
  it('finds the active override, ignoring revoked, expired and other tutors', () => {
    const active = o({ id: 'a', expiresAt: '2026-10-10T08:00:00Z' });
    const list = [
      o({ id: 'r', revokedAt: '2026-10-02T08:00:00Z', expiresAt: '2026-12-01T00:00:00Z' }),
      o({ id: 'x', expiresAt: '2026-10-04T07:00:00Z' }),
      o({ id: 'other', tutorId: 't2' }),
      active,
    ];
    expect(activeOverride(list, 't1', now)).toBe(active);
    expect(activeOverride(list, 't3', now)).toBeUndefined();
  });
  it('decides whether a tutor can be assigned work', () => {
    expect(canAssignTutor(undefined, now)).toEqual({ allowed: true, overridden: false });
    expect(canAssignTutor(comp({ vettingStatus: 'missing', enforced: false }), now).allowed).toBe(true);
    expect(canAssignTutor(comp({ vettingStatus: 'expiring' }), now).allowed).toBe(true);
    expect(canAssignTutor(comp({ vettingStatus: 'missing' }), now)).toEqual({
      allowed: false, overridden: false, reason: 'Police clearance not yet uploaded',
    });
    expect(canAssignTutor(comp({ vettingStatus: 'pending' }), now).reason).toBe('Police clearance awaiting review');
    expect(canAssignTutor(comp({ vettingStatus: 'expired' }), now).reason).toBe('Police clearance expired');
    const overridden = comp({ vettingStatus: 'missing', override: { id: 'o', reason: 'Certificate in the post', until: '2026-10-15T08:00:00Z' } });
    expect(canAssignTutor(overridden, now)).toMatchObject({ allowed: true, overridden: true });
    expect(canAssignTutor(overridden, new Date('2026-10-16T00:00:00Z')).allowed).toBe(false);
  });
});

describe('onboarding checklist', () => {
  it('lists the steps in order with details', () => {
    const items = onboardingChecklist(comp({ handbookVersion: 2, handbookAcknowledgedVersion: 1 }), TODAY);
    expect(items.map((i) => i.label)).toEqual([
      'Police clearance uploaded and verified',
      'Bank details added',
      'Availability set',
      'Google Calendar connected',
      'WhatsApp updates switched on',
      'Tutor handbook acknowledged',
    ]);
    expect(items[0]).toMatchObject({ done: true, detail: 'Expires 3 November 2026' });
    expect(items[5]).toMatchObject({ done: false, detail: 'Version 2 to acknowledge' });
    expect(items.filter((i) => i.optional).map((i) => i.key)).toEqual(['calendar', 'whatsapp']);
    expect(onboardingProgress(items)).toEqual({ done: 3, total: 4, complete: false });
  });
  it('is complete once required steps are done, whatever the optional ones', () => {
    const items = onboardingChecklist(comp({ handbookVersion: 1, handbookAcknowledgedVersion: 1 }), TODAY);
    expect(onboardingProgress(items)).toEqual({ done: 4, total: 4, complete: true });
    expect(onboardingChecklist(comp(), TODAY)[5].done).toBe(true); // no handbook published
  });
  it('describes the clearance step for each status', () => {
    const detail = (s: TutorCompliance['vettingStatus']) => onboardingChecklist(comp({ vettingStatus: s }), TODAY)[0].detail;
    expect(detail('pending')).toBe('Awaiting review');
    expect(detail('expired')).toBe('Expired');
    expect(detail('missing')).toBe('Not yet uploaded');
  });
});

describe('vetting blocks', () => {
  it('uses the agreed wording', () => {
    expect(vettingBlockMessage('James Wilson', 'lesson')).toBe(
      'Police clearance required: James Wilson cannot be assigned new lessons until their police clearance has been verified. An administrator can record an override with a reason.',
    );
    expect(vettingBlockMessage('James Wilson', 'enrolment')).toContain('cannot be given new students');
    expect(vettingBlockMessage('James Wilson', 'role')).toContain('cannot be awarded roles');
  });
  it('recognises blocks from errors and strings', () => {
    expect(isVettingBlock(new Error(vettingBlockMessage('A B', 'role')))).toBe(true);
    expect(isVettingBlock(vettingBlockMessage('A B', 'lesson'))).toBe(true);
    expect(isVettingBlock({ message: 'Police clearance required: x' })).toBe(true);
    expect(isVettingBlock(new Error('Lesson not found'))).toBe(false);
    expect(isVettingBlock(undefined)).toBe(false);
  });
});

describe('validateDocumentDates', () => {
  const v = (type: TutorDocument['type'], issueDate?: string, expiryDate?: string) => validateDocumentDates({ type, issueDate, expiryDate }, TODAY);
  it('checks format and order', () => {
    expect(v('police_clearance', '2026-1-4', '2027-01-04')).toBe('Please enter dates as YYYY-MM-DD');
    expect(v('police_clearance', '2026-02-30', '2027-01-04')).toBe('Please enter dates as YYYY-MM-DD');
    expect(v('police_clearance', '2026-01-04')).toBe('Please enter the expiry date of the police clearance certificate');
    expect(v('police_clearance', '2026-10-05', '2027-10-05')).toBe('The issue date cannot be in the future');
    expect(v('passport_id', '2026-01-04', '2025-01-04')).toBe('The expiry date cannot be before the issue date');
    expect(v('police_clearance', '2025-01-04', '2026-10-03')).toBe('This certificate has already expired');
  });
  it('accepts valid dates, expiry today and optional expiry for other types', () => {
    expect(v('police_clearance', '2026-01-04', '2027-01-04')).toBeNull();
    expect(v('police_clearance', undefined, '2026-10-04')).toBeNull();
    expect(v('qualification')).toBeNull();
    expect(v('passport_id', '2020-05-01')).toBeNull();
  });
});

describe('summaries', () => {
  it('describes each status in a line', () => {
    expect(vettingSummary(comp(), TODAY)).toBe('Cleared until 3 November 2026');
    expect(vettingSummary(comp({ vettingStatus: 'expiring', clearanceExpiry: '2026-10-29' }), TODAY)).toBe('Expires in 25 days');
    expect(vettingSummary(comp({ vettingStatus: 'expiring', clearanceExpiry: '2026-10-04' }), TODAY)).toBe('Expires today');
    expect(vettingSummary(comp({ vettingStatus: 'pending', clearanceExpiry: undefined }), TODAY)).toBe('Awaiting review');
    expect(vettingSummary(comp({ vettingStatus: 'expired', clearanceExpiry: '2026-09-30' }), TODAY)).toBe('Expired on 30 September 2026');
    expect(
      vettingSummary(comp({ vettingStatus: 'missing', override: { id: 'o', reason: 'In the post', until: new Date(2026, 9, 18, 9).toISOString() } }), TODAY),
    ).toBe('Police clearance missing · Override until 18 October 2026');
  });
  it('lists tutors needing attention', () => {
    const list = [
      comp({ tutorId: 'a' }),
      comp({ tutorId: 'b', documentsPending: 1 }),
      comp({ tutorId: 'c', vettingStatus: 'expiring' }),
      comp({ tutorId: 'd', vettingStatus: 'missing' }),
    ];
    expect(needsAttention(list).map((c) => c.tutorId)).toEqual(['b', 'c', 'd']);
  });
});

describe('sentence-safe vetting copy and date entry', () => {
  const base: TutorCompliance = {
    tutorId: 't1',
    vettingStatus: 'missing',
    documentsPending: 0,
    bankDetails: false,
    availabilitySet: false,
    calendarConnected: false,
    whatsappOptIn: false,
    enforced: true,
  };
  it('phrases each blocked state for use mid-sentence, keeping month names capitalised', () => {
    expect(blockedReasonPhrase(base)).toBe('no certificate has been uploaded');
    expect(blockedReasonPhrase({ ...base, vettingStatus: 'pending' })).toBe('their certificate is awaiting review');
    expect(blockedReasonPhrase({ ...base, vettingStatus: 'expired', clearanceExpiry: '2026-09-01' })).toBe('their certificate expired on 1 September 2026');
    expect(blockedReasonPhrase({ ...base, vettingStatus: 'expired' })).toBe('their certificate has expired');
  });
  it('masks typed digits into YYYY-MM-DD', () => {
    expect(maskDateInput('2027')).toBe('2027');
    expect(maskDateInput('20271')).toBe('2027-1');
    expect(maskDateInput('2027100')).toBe('2027-10-0');
    expect(maskDateInput('2027-10-05')).toBe('2027-10-05');
    expect(maskDateInput('20271005999')).toBe('2027-10-05');
  });
  it('describes a complete date in words and nothing else', () => {
    expect(describeDateInput('2027-10-05')).toBe('5 October 2027');
    expect(describeDateInput('2027-10-0')).toBeNull();
    expect(describeDateInput('2027-02-30')).toBeNull();
  });
});
