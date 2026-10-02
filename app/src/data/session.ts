import { create } from 'zustand';

import type { Profile } from '@/domain/types';

import { source } from './index';
import { queryClient } from './query';

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  profile: Profile | null;
  restore(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  profile: null,
  async restore() {
    try {
      const profile = await source.restoreSession();
      set({ profile, status: profile ? 'signed-in' : 'signed-out' });
    } catch {
      set({ profile: null, status: 'signed-out' });
    }
  },
  async signIn(email, password) {
    const profile = await source.signIn(email, password);
    queryClient.clear();
    set({ profile, status: 'signed-in' });
  },
  async signOut() {
    await source.signOut();
    queryClient.clear();
    set({ profile: null, status: 'signed-out' });
  },
}));

/** The signed-in profile. Only call inside screens that are behind the sign-in gate. */
export function useMe(): Profile {
  const profile = useSession((s) => s.profile);
  if (!profile) throw new Error('Not signed in');
  return profile;
}
