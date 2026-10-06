/** "Reset calendar link": the demo mirrors public.reset_ics_token, and the session refuses it while viewing. */
import { resetIcsToken } from '../demo/ics';
import { createSeed } from '../demo/seed';
import { baseSource, source } from '../index';
import { useSession } from '../session';
import { ViewOnlyError } from '../view-as';

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
jest.mock('@/config', () => ({ DEMO_MODE: true, SUPABASE_URL: 'http://localhost', SUPABASE_PUBLISHABLE_KEY: 'test' }));
jest.mock('../supabase', () => ({ createSupabaseSource: jest.fn() }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const who = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;

describe('resetIcsToken (mirrors reset_ics_token)', () => {
  it('gives the caller a new random token each time', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    parent.icsToken = 'old-token';
    const first = resetIcsToken(db, parent);
    expect(first).toMatch(UUID);
    expect(first).not.toBe('old-token');
    expect(who(db, 'parent').icsToken).toBe(first);
    const second = resetIcsToken(db, parent);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it('lets an admin reset a tutor’s link', () => {
    const db = createSeed();
    const tutor = who(db, 'tutor');
    const token = resetIcsToken(db, who(db, 'admin'), tutor.id);
    expect(db.profiles.find((p) => p.id === tutor.id)!.icsToken).toBe(token);
  });

  it('refuses anyone else’s link for a non-admin, and an unknown person', () => {
    const db = createSeed();
    const tutor = who(db, 'tutor');
    const before = tutor.icsToken;
    expect(() => resetIcsToken(db, who(db, 'parent'), tutor.id)).toThrow("Only an administrator can reset someone else's calendar link.");
    expect(tutor.icsToken).toBe(before);
    expect(() => resetIcsToken(db, who(db, 'admin'), 'u-nobody')).toThrow('This person was not found.');
  });
});

describe('resetMyIcsToken (session, demo source)', () => {
  beforeEach(async () => {
    if (useSession.getState().viewing) await useSession.getState().exitViewAs();
    await useSession.getState().signIn('craig@eliteeducation.me', '');
  });

  it('updates the signed-in profile with the new token', async () => {
    const before = useSession.getState().profile!.icsToken;
    await useSession.getState().resetMyIcsToken();
    const after = useSession.getState().profile!.icsToken;
    expect(after).toMatch(UUID);
    expect(after).not.toBe(before);
    // The stored database has it too, so it survives a restore.
    expect(await baseSource.restoreSession()).toMatchObject({ icsToken: after });
  });

  it('is refused while viewing as someone else, leaving their link alone', async () => {
    await useSession.getState().startViewAs('u-parent');
    const viewed = useSession.getState().profile!.icsToken;
    await expect(useSession.getState().resetMyIcsToken()).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(source.resetIcsToken!()).rejects.toBeInstanceOf(ViewOnlyError);
    expect(useSession.getState().profile!.icsToken).toBe(viewed);
    await useSession.getState().exitViewAs();
  });
});
