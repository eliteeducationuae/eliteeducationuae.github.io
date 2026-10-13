import { Redirect, router, Stack } from 'expo-router';
import { useState } from 'react';

import { Actions, Button, FieldsCard, PageHeader, Prose, Screen, Toggle } from '@/components/ui';
import { source } from '@/data';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { flagViewError } from '@/data/view-as';
import { confirm, notify } from '@/lib/confirm';

/**
 * The accountant's "Close my access": the account-delete flow (source.deleteMyAccount, then sign out) with a plain
 * explanation and an "I understand" switch instead of a typed word. The books are business records and stay.
 */
export function CloseLoginScreen() {
  const signOut = useSession((s) => s.signOut);
  const viewing = useSession((s) => !!s.viewing);
  const [sure, setSure] = useState(false);
  const [closing, setClosing] = useState(false);

  if (viewing) return <Redirect href="/accountant/account" />;

  async function closeNow() {
    setClosing(true);
    try {
      await source.deleteMyAccount();
    } catch (err) {
      setClosing(false);
      if (flagViewError(err)) return;
      notify('Your access has not been closed', err instanceof Error ? err.message : 'Please try again in a moment.');
      return;
    }
    queryClient.clear();
    try {
      await signOut();
    } catch {
      // The login no longer exists, so signing out on the server can fail; this device is signed out regardless.
      useSession.setState({ profile: null, status: 'signed-out' });
    }
    router.replace('/sign-in');
    notify('Your access has been closed', 'Thank you for your help with the Elite Education books.');
  }

  return (
    <Screen topInset narrow>
      <Stack.Screen options={{ headerShown: false, title: 'Close my access' }} />
      <PageHeader back={{ fallback: '/accountant/account' }} kicker="Data and privacy" title="Close my access" />
      <Prose
        paragraphs={[
          'Your access is removed and you can no longer see the books. Elite Education keeps its own records, including every invoice, credit note and VAT return, as UAE law requires.',
          'The office can invite you again at any time.',
        ]}
      />
      <FieldsCard>
        <Toggle title="I understand" note="I will lose access straight away" value={sure} onValueChange={setSure} />
      </FieldsCard>
      <Actions>
        <Button
          title="Close my access"
          icon="person_remove"
          variant="danger"
          disabled={!sure}
          loading={closing}
          onPress={() => confirm('Close your access?', 'This cannot be undone. You will be signed out straight away.', closeNow, 'Close my access')}
        />
      </Actions>
    </Screen>
  );
}
