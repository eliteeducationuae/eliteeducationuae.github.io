import { create } from 'zustand';

import type { Profile } from '@/domain/types';

import { baseSource, setActiveSource, source } from './index';
import { AuthNotice, NOT_LINKED } from './messages';
import { queryClient } from './query';
import type { SignUpDetails, SocialProvider, WhatsAppPrefs } from './source';
import { useViewNotice, ViewOnlyError, type ViewingState } from './view-as';

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

/** Ends the current "View as" on the server. Kept outside the store: it is not state the UI renders. */
let endView: (() => Promise<void>) | null = null;

/** Drop any view in progress (without waiting for the server) and use the base source again. */
function dropView() {
  const end = endView;
  endView = null;
  setActiveSource(null);
  if (end) end().catch(() => undefined);
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
  /** A parent saves their own name; the signed-in profile is refreshed. */
  setMyName(fullName: string): Promise<void>;
  /** Save the signed-in person's WhatsApp opt-in and number; the signed-in profile is refreshed. */
  setWhatsApp(prefs: WhatsAppPrefs): Promise<void>;
  /** Give the signed-in person a new calendar feed link; the old one stops working. Refused while viewing. */
  resetMyIcsToken(): Promise<void>;
  /**
   * Admin "View as": while set, `profile` is the person being viewed and every change is refused. Never
   * persisted, so a reload returns the admin to their own account.
   */
  viewing: ViewingState | null;
  /** Admin only: see the app as this person, read-only. */
  startViewAs(profileId: string): Promise<void>;
  /** Return to the admin's own account. */
  exitViewAs(): Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  profile: null,
  authNotice: null,
  viewing: null,
  clearAuthNotice() {
    set({ authNotice: null });
  },
  async restore() {
    dropView();
    set({ viewing: null });
    try {
      const profile = await source.restoreSession();
      set({ profile, status: profile ? 'signed-in' : 'signed-out' });
    } catch (err) {
      set({ profile: null, status: 'signed-out', authNotice: err instanceof AuthNotice ? err.message : null });
    }
  },
  async startViewAs(profileId) {
    const { profile: admin, viewing } = get();
    if (!admin || admin.role !== 'admin') throw new Error('Only an admin can view the app as someone else.');
    if (viewing) throw new Error('Please return to your own account before viewing as someone else.');
    if (!baseSource.startViewAs) throw new Error('Viewing as someone else is not available.');
    const view = await baseSource.startViewAs(profileId);
    endView = view.end;
    setActiveSource(view.source);
    queryClient.clear();
    set({
      profile: view.profile,
      viewing: { viewId: view.viewId, profile: view.profile, admin, expiresAt: view.expiresAt },
    });
  },
  async exitViewAs() {
    const { viewing } = get();
    if (!viewing) return;
    const end = endView;
    endView = null;
    setActiveSource(null);
    try {
      await end?.();
    } catch {
      // Ending is best effort; the view also expires on the server.
    }
    queryClient.clear();
    set({ profile: viewing.admin, viewing: null });
    useViewNotice.getState().clear();
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
  async setMyName(fullName) {
    if (get().viewing) throw new ViewOnlyError();
    if (!source.setMyName) throw new Error('Saving your name is not available.');
    const profile = await source.setMyName(fullName);
    set({ profile });
    queryClient.invalidateQueries();
  },
  async setWhatsApp(prefs) {
    if (get().viewing) throw new ViewOnlyError();
    if (!source.setWhatsApp) throw new Error('WhatsApp settings are not available.');
    const profile = await source.setWhatsApp(prefs);
    set({ profile });
  },
  async resetMyIcsToken() {
    if (get().viewing) throw new ViewOnlyError();
    if (!source.resetIcsToken) throw new Error('Resetting the calendar link is not available.');
    const icsToken = await source.resetIcsToken();
    const profile = get().profile;
    if (profile) set({ profile: { ...profile, icsToken } });
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
    // While viewing, "sign out" returns the admin to their own account.
    if (get().viewing) return get().exitViewAs();
    await source.signOut();
    queryClient.clear();
    set({ profile: null, status: 'signed-out' });
  },
}));

/** The "View as" in progress, or null. */
export const useViewing = () => useSession((s) => s.viewing);

/** The signed-in profile. Only call inside screens that are behind the sign-in gate. */
export function useMe(): Profile {
  const profile = useSession((s) => s.profile);
  if (!profile) throw new Error('Not signed in');
  return profile;
}
