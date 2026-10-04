import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDemoSource } from '../demo';
import type { DataSource } from '../source';
import {
  isViewEndedError,
  isViewOnlyError,
  minutesLeft,
  readOnlySource,
  SOURCE_ACCESS,
  VIEW_ENDED_MESSAGE,
  VIEW_ONLY_MESSAGE,
  ViewOnlyError,
  viewTargetsFor,
  type ViewTarget,
} from '../view-as';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    removeItem: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

const ALL = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };

beforeEach(() => mockStore.clear());

async function parentSource(): Promise<DataSource> {
  const base = createDemoSource();
  await base.signIn('fatima@example.com', '');
  return base;
}

describe('readOnlySource', () => {
  it('passes reads through', async () => {
    const ro = readOnlySource(await parentSource());
    expect(ro.kind).toBe('demo');
    const invoices = await ro.listInvoices();
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices.every((i) => i.familyId === 'f-mansoori')).toBe(true);
    expect((await ro.listLessons(ALL)).length).toBeGreaterThan(0);
    expect((await ro.restoreSession())?.id).toBe('u-parent');
  });

  it('refuses writes with ViewOnlyError', async () => {
    const ro = readOnlySource(await parentSource());
    const before = mockStore.get('elite.demo.db');
    await expect(ro.sendMessage('f-mansoori', 'Hello')).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(ro.addMyChild({ fullName: 'New Child', subjects: [{ subject: 'Maths' }] })).rejects.toThrow(VIEW_ONLY_MESSAGE);
    await expect(ro.setWhatsApp!({ optIn: true, number: '+971501234567' })).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(ro.signOut()).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(ro.resetDemo!()).rejects.toBeInstanceOf(ViewOnlyError);
    expect(mockStore.get('elite.demo.db')).toBe(before);
    expect(mockStore.get('elite.demo.session')).toBe('u-parent');
  });

  it('turns automatic background writes into quiet no-ops', async () => {
    const base = await parentSource();
    const ro = readOnlySource(base);
    const before = await base.listThreads();
    await expect(ro.markThreadRead('f-mansoori')).resolves.toBeUndefined();
    expect(await base.listThreads()).toEqual(before);
    expect(mockStore.has('elite.demo.db')).toBe(false);

    // The inner method is never called.
    const savePushToken = jest.fn(async () => undefined);
    const withPush = readOnlySource(Object.assign(createDemoSource(), { savePushToken }));
    await expect(withPush.savePushToken!('ExponentPushToken[x]')).resolves.toBeUndefined();
    expect(savePushToken).not.toHaveBeenCalled();
  });

  it('keeps optional members the inner source lacks undefined', async () => {
    const ro = readOnlySource(await parentSource());
    expect(ro.openBillingPortal).toBeUndefined();
    expect(ro.aiAssist).toBeUndefined();
    expect(typeof ro.signUp).toBe('function');
  });

  it('fails closed for a member it does not know', async () => {
    const inner = Object.assign(await parentSource(), { somethingNew: async () => 'changed' });
    const ro = readOnlySource(inner) as DataSource & { somethingNew(): Promise<string> };
    await expect(ro.somethingNew()).rejects.toBeInstanceOf(ViewOnlyError);
  });

  it('never looks like a promise', () => {
    const ro = readOnlySource(createDemoSource()) as unknown as { then?: unknown };
    expect(ro.then).toBeUndefined();
  });

  it('classifies only members the demo source has, or optional ones, as reads', () => {
    const demo = createDemoSource() as unknown as Record<string, unknown>;
    // The optional read members of DataSource; any other read must exist on the demo source.
    const optionalReads = new Set(['demoAccounts', 'loginEmails', 'listViewTargets', 'fileUrl', 'listBusyBlocks', 'getCalendarConnection']);
    const reads = Object.entries(SOURCE_ACCESS).filter(([, a]) => a === 'read').map(([k]) => k);
    expect(reads.length).toBeGreaterThan(40);
    for (const key of reads) {
      if (demo[key] === undefined) expect(optionalReads.has(key)).toBe(true);
    }
  });

  it('classifies the background writes as silent and sign-in changes as writes', () => {
    expect(SOURCE_ACCESS.markThreadRead).toBe('silent');
    expect(SOURCE_ACCESS.savePushToken).toBe('silent');
    for (const k of ['signIn', 'signOut', 'signUp', 'setMyName', 'setWhatsApp', 'startViewAs', 'aiAssist', 'startCardPayment', 'buyPackageOffer', 'uploadFile', 'resetDemo'] as const) {
      expect(SOURCE_ACCESS[k]).toBe('write');
    }
  });
});

describe('isViewOnlyError and isViewEndedError', () => {
  it('match the class and the server message', () => {
    expect(isViewOnlyError(new ViewOnlyError())).toBe(true);
    expect(isViewOnlyError(new Error(VIEW_ONLY_MESSAGE))).toBe(true);
    expect(isViewOnlyError(new Error(`ERROR: ${VIEW_ONLY_MESSAGE}`))).toBe(true);
    expect(isViewOnlyError({ message: VIEW_ONLY_MESSAGE })).toBe(true);
    expect(isViewOnlyError(new Error('Something else'))).toBe(false);
    expect(isViewOnlyError(null)).toBe(false);
    expect(new ViewOnlyError().name).toBe('ViewOnlyError');
    expect(new ViewOnlyError()).toBeInstanceOf(Error);

    expect(isViewEndedError(new Error(VIEW_ENDED_MESSAGE))).toBe(true);
    expect(isViewEndedError(new ViewOnlyError())).toBe(false);
    expect(isViewEndedError(undefined)).toBe(false);
  });
});

describe('viewTargetsFor', () => {
  const t = (profileId: string, role: ViewTarget['role'], fullName: string, ids: Partial<ViewTarget> = {}): ViewTarget => ({
    profileId,
    role,
    fullName,
    email: `${profileId}@example.com`,
    ...ids,
  });
  const targets = [
    t('p2', 'parent', 'Zara Haddad', { familyId: 'f1' }),
    t('p1', 'parent', 'Ahmed Haddad', { familyId: 'f1' }),
    t('p3', 'parent', 'Other Parent', { familyId: 'f2' }),
    t('s1', 'student', 'Karim Haddad', { studentId: 'st1' }),
    t('tu1', 'tutor', 'Sarah Khan', { tutorId: 't1' }),
  ];

  it('lists a family’s parents, sorted by name', () => {
    expect(viewTargetsFor(targets, { familyId: 'f1' }).map((x) => x.profileId)).toEqual(['p1', 'p2']);
  });
  it('lists a student’s login', () => {
    expect(viewTargetsFor(targets, { studentId: 'st1' }).map((x) => x.profileId)).toEqual(['s1']);
  });
  it('lists a tutor’s login', () => {
    expect(viewTargetsFor(targets, { tutorId: 't1' }).map((x) => x.profileId)).toEqual(['tu1']);
  });
  it('returns nothing without a match or a reference', () => {
    expect(viewTargetsFor(targets, { familyId: 'f9' })).toEqual([]);
    expect(viewTargetsFor(targets, {})).toEqual([]);
    // A student id never matches a parent or tutor.
    expect(viewTargetsFor(targets, { studentId: 'f1' })).toEqual([]);
  });
});

describe('minutesLeft', () => {
  const now = Date.parse('2026-10-04T10:00:00.000Z');
  it('rounds up to whole minutes', () => {
    expect(minutesLeft('2026-10-04T11:00:00.000Z', now)).toBe(60);
    expect(minutesLeft('2026-10-04T10:00:30.000Z', now)).toBe(1);
    expect(minutesLeft('2026-10-04T10:05:00.000Z', now)).toBe(5);
  });
  it('never goes below 0', () => {
    expect(minutesLeft('2026-10-04T10:00:00.000Z', now)).toBe(0);
    expect(minutesLeft('2026-10-04T09:00:00.000Z', now)).toBe(0);
    expect(minutesLeft('not a date', now)).toBe(0);
  });
});

// Keep the AsyncStorage import used, so the mock above is the module the demo source sees.
void AsyncStorage;
