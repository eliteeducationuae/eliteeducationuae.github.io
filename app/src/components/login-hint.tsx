import { Share } from 'react-native';

import { useLoginEmails } from '@/data/hooks';

import { Banner, Button } from './ui';

const APP_LINK = 'https://eliteeducation.me';

/** Explains how this person gets into the app (with a ready-made invite to send), or confirms they already can. */
export function LoginHint({ email, who, name }: { email: string; who: 'parent' | 'tutor'; name?: string }) {
  const logins = useLoginEmails();
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !logins.data) return null;
  if (logins.data.includes(trimmed)) {
    return (
      <Banner tone="success" icon="check">
        This {who} can sign in with {trimmed}.
      </Banner>
    );
  }
  const first = name?.trim().split(' ')[0];
  const invite =
    `${first ? `Dear ${first},` : 'Hello,'}\n\n${
      who === 'parent'
        ? 'You can now see lessons, lesson notes, progress and invoices in the Elite Education app.'
        : 'Your Elite Education tutor account is ready. Your schedule, lesson notes and pay are all in the app.'
    }\n\n1. Open ${APP_LINK}\n2. Select “New to Elite Education? Create an account”\n3. Sign up with ${trimmed} and enter the code we email to you.\n\nElite Education | eliteeducation.me`;
  return (
    <>
      <Banner icon="person">
        No sign-in yet. Ask them to select “Create an account” in the app and sign up with {trimmed}. They are linked
        automatically once they confirm their email address.
      </Banner>
      <Button title="Send invite" icon="share" variant="secondary" onPress={() => Share.share({ message: invite, title: 'Your Elite Education account' })} />
    </>
  );
}
