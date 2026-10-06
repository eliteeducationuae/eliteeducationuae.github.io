/** Admin "View as" through the session store, on the demo source. */
import { baseSource, source } from '../index';
import { useSession } from '../session';
import { useViewNotice, VIEW_ONLY_MESSAGE, ViewOnlyError } from '../view-as';

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
// The Supabase source pulls in React Native modules; the demo never uses it.
jest.mock('../supabase', () => ({ createSupabaseSource: jest.fn() }));

const ALL = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };
const FAMILY_STUDENTS = ['s-omar', 's-layla'];

async function signInAs(email: string) {
  if (useSession.getState().viewing) await useSession.getState().exitViewAs();
  await useSession.getState().signIn(email, '');
}

beforeEach(async () => {
  await signInAs('craig@eliteeducation.me');
  // Save the database once, so "unchanged" below compares a stored copy.
  await baseSource.saveSettings({});
});

describe('startViewAs (demo)', () => {
  it('shows the app as the parent, read-only, and returns to the admin', async () => {
    const admin = useSession.getState().profile!;
    expect(admin.role).toBe('admin');
    const adminLessons = await source.listLessons(ALL);
    const adminInvoices = await source.listInvoices();
    const dbBefore = mockStore.get('elite.demo.db');
    const sessionBefore = mockStore.get('elite.demo.session');

    await useSession.getState().startViewAs('u-parent');
    const { profile, viewing } = useSession.getState();
    expect(profile?.fullName).toBe('Fatima Al Mansoori');
    expect(viewing?.profile.id).toBe('u-parent');
    expect(viewing?.admin.id).toBe(admin.id);
    expect(Date.parse(viewing!.expiresAt)).toBeGreaterThan(Date.now());
    expect(source).not.toBe(baseSource);

    const invoices = await source.listInvoices();
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices.length).toBeLessThan(adminInvoices.length);
    expect(invoices.every((i) => i.familyId === 'f-mansoori')).toBe(true);
    const lessons = await source.listLessons(ALL);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.length).toBeLessThan(adminLessons.length);
    expect(lessons.every((l) => l.studentIds.some((id) => FAMILY_STUDENTS.includes(id)))).toBe(true);

    await expect(source.sendMessage('f-mansoori', 'Hello')).rejects.toThrow(VIEW_ONLY_MESSAGE);
    await expect(source.saveFamily({ name: 'X', parentName: 'X', email: 'x@example.com' } as never)).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(useSession.getState().setWhatsApp({ optIn: true, number: '+971501234567' })).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(useSession.getState().setMyName('Someone')).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(source.markThreadRead('f-mansoori')).resolves.toBeUndefined();

    expect(mockStore.get('elite.demo.db')).toBe(dbBefore);
    expect(mockStore.get('elite.demo.session')).toBe(sessionBefore);

    useViewNotice.getState().flag('view-only');
    await useSession.getState().exitViewAs();
    expect(useSession.getState().profile?.id).toBe(admin.id);
    expect(useSession.getState().viewing).toBeNull();
    expect(useViewNotice.getState().notice).toBeNull();
    expect((await source.listInvoices()).length).toBe(adminInvoices.length);
    expect(mockStore.get('elite.demo.session')).toBe(sessionBefore);
  });

  it('lets only an admin start a view', async () => {
    await signInAs('fatima@example.com');
    await expect(useSession.getState().startViewAs('u-student')).rejects.toThrow('Only an admin');
    expect(useSession.getState().viewing).toBeNull();
    // Nor through the source directly.
    await expect(baseSource.startViewAs!('u-student')).rejects.toThrow('Only an admin can do that.');
  });

  it('refuses to view an admin or yourself, or someone unknown', async () => {
    await expect(useSession.getState().startViewAs('u-admin')).rejects.toThrow();
    await expect(useSession.getState().startViewAs('u-nobody')).rejects.toThrow();
    await expect(useSession.getState().startViewAs('u-accountant')).rejects.toThrow('This person cannot be viewed.');
    expect(useSession.getState().viewing).toBeNull();
    expect(useSession.getState().profile?.id).toBe('u-admin');
  });

  it('refuses a second view while one is open', async () => {
    await useSession.getState().startViewAs('u-parent');
    await expect(useSession.getState().startViewAs('u-tutor')).rejects.toThrow();
    expect(useSession.getState().viewing?.profile.id).toBe('u-parent');
  });

  it('returns to the admin on sign-out while viewing', async () => {
    await useSession.getState().startViewAs('u-student');
    await useSession.getState().signOut();
    expect(useSession.getState().status).toBe('signed-in');
    expect(useSession.getState().profile?.id).toBe('u-admin');
    expect(useSession.getState().viewing).toBeNull();
    expect(mockStore.get('elite.demo.session')).toBe('u-admin');
  });

  it('shows a tutor only their own lessons', async () => {
    await useSession.getState().startViewAs('u-tutor');
    const lessons = await source.listLessons(ALL);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.every((l) => l.tutorId === 't-sarah')).toBe(true);
  });

  it('forgets the view on restore, returning to the admin', async () => {
    await useSession.getState().startViewAs('u-parent');
    await useSession.getState().restore();
    expect(useSession.getState().viewing).toBeNull();
    expect(useSession.getState().profile?.id).toBe('u-admin');
    expect((await source.listInvoices()).some((i) => i.familyId !== 'f-mansoori')).toBe(true);
  });

  it('lists the people an admin can view as', async () => {
    const targets = await source.listViewTargets!();
    expect(targets.map((t) => t.profileId).sort()).toEqual(['u-parent', 'u-parent2', 'u-student', 'u-tutor']);
    await signInAs('fatima@example.com');
    await expect(source.listViewTargets!()).rejects.toThrow();
  });
});
