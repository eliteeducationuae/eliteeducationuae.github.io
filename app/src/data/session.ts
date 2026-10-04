import { create } from 'zustand';

import type { Profile } from '@/domain/types';

import { source } from './index';
import { AuthNotice, NOT_LINKED } from './messages';
import { queryClient } from './query';
import type { SignUpDetails, SocialProvider } from './source';

export type { SocialProvider, SocialSignInResult } from './source';

/** After sign-up: load the profile the database created (or explain why there isn't one). */
async function finishSignIn(set: (s: Partial<SessionState>) => void) {
  const profile = await source.restoreSession();
  if (!profile) {
    await source.signOut();
    throw new Error(NOT_LINKED);
  }
  queryClient.clear();
  set({ profile, status: 'signed-in' });
}

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  profile: Profile | null;
  /** A message for the sign-in screen, e.g. why a web sign-in redirect could not finish. */
  authNotice: string | null;
  clearAuthNotice(): void;
  restore(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Create a parent login; signs straight in when no email confirmation is required. */
  signUp(email: string, password: string, details: SignUpDetails): Promise<'signed-in' | 'confirm-email'>;
  /** Finish sign-up with the emailed code, then sign in. */
  confirmSignUp(email: string, code: string): Promise<void>;
  /** Sign in with Apple or Google. On the web this leaves the page ('redirecting'). */
  signInWithProvider(provider: SocialProvider): Promise<'signed-in' | 'redirecting' | 'cancelled'>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  profile: null,
  authNotice: null,
  clearAuthNotice() {
    set({ authNotice: null });
  },
  async restore() {
    try {
      const profile = await source.restoreSession();
      set({ profile, status: profile ? 'signed-in' : 'signed-out' });
    } catch (err) {
      set({ profile: null, status: 'signed-out', authNotice: err instanceof AuthNotice ? err.message : null });
    }
  },
  async signInWithProvider(provider) {
    if (!source.signInWithProvider) throw new Error('Sign-in with this provider is not available.');
    const result = await source.signInWithProvider(provider);
    if (result.status === 'signed-in') {
      queryClient.clear();
      set({ profile: result.profile, status: 'signed-in', authNotice: null });
    }
    return result.status;
  },
  async signIn(email, password) {
    const profile = await source.signIn(email, password);
    queryClient.clear();
    set({ profile, status: 'signed-in' });
  },
  async signUp(email, password, details) {
    if (!source.signUp) throw new Error('Sign-up is not available');
    const result = await source.signUp(email, password, details);
    if (result === 'signed-in') await finishSignIn(set);
    return result;
  },
  async confirmSignUp(email, code) {
    if (!source.verifySignUpCode) throw new Error('Sign-up is not available');
    await source.verifySignUpCode(email, code);
    await finishSignIn(set);
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
