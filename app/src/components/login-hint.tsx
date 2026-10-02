import { useLoginEmails } from '@/data/hooks';

import { Banner } from './ui';

/** Explains how this person gets into the app, or confirms that they already can. */
export function LoginHint({ email, who }: { email: string; who: 'parent' | 'tutor' }) {
  const logins = useLoginEmails();
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !logins.data) return null;
  if (logins.data.includes(trimmed)) {
    return (
      <Banner tone="success" icon="check">
        This {who} can log in with {trimmed}.
      </Banner>
    );
  }
  return (
    <Banner icon="person">
      To give this {who} access, ask them to open the app, tap “Create an account” and sign up with {trimmed}. They’ll be linked
      automatically once they confirm their email.
    </Banner>
  );
}
