/** Signing out leaves nothing of the person in memory, even when the server cannot be reached. */
import { baseSource, setActiveSource } from '../index';
import { queryClient } from '../query';
import { useSession } from '../session';
import { emitSessionEnded } from '../session-events';
import type { DataSource } from '../source';

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

beforeEach(async () => {
  await useSession.getState().signIn('craig@eliteeducation.me', '');
  queryClient.setQueryData(['invoices'], [{ id: 'secret' }]);
});

describe('sign out', () => {
  it('clears the cache, the profile and the stored demo session', async () => {
    expect(mockStore.get('elite.demo.session')).toBeTruthy();
    await useSession.getState().signOut();
    expect(useSession.getState()).toMatchObject({ status: 'signed-out', profile: null, viewing: null });
    expect(queryClient.getQueryData(['invoices'])).toBeUndefined();
    expect(mockStore.get('elite.demo.session')).toBeUndefined();
  });

  it('still clears everything on this device when the server sign-out fails', async () => {
    const failing = Object.create(baseSource) as DataSource;
    failing.signOut = () => Promise.reject(new Error('Failed to fetch'));
    setActiveSource(failing);
    try {
      await expect(useSession.getState().signOut()).rejects.toThrow();
    } finally {
      setActiveSource(null);
    }
    expect(useSession.getState()).toMatchObject({ status: 'signed-out', profile: null });
    expect(queryClient.getQueryData(['invoices'])).toBeUndefined();
  });

  it('while viewing as someone, returns the admin to their own account', async () => {
    await useSession.getState().startViewAs('u-parent');
    await useSession.getState().signOut();
    expect(useSession.getState().viewing).toBeNull();
    expect(useSession.getState().profile?.role).toBe('admin');
  });

  it('follows a session that ended elsewhere (another tab, or a refused refresh)', async () => {
    await useSession.getState().startViewAs('u-parent');
    queryClient.setQueryData(['lessons'], [{ id: 'x' }]);
    emitSessionEnded();
    expect(useSession.getState()).toMatchObject({ status: 'signed-out', profile: null, viewing: null });
    expect(queryClient.getQueryData(['lessons'])).toBeUndefined();
  });
});
