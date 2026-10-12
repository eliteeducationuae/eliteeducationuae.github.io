import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { SUPPORT_EMAIL } from '@/config';
import { source } from '@/data';
import { queryClient } from '@/data/query';
import { useFamilyContacts } from '@/data/hooks';
import { flagViewError } from '@/data/view-as';
import { useSession } from '@/data/session';
import {
  canConfirmDeletion,
  closesOwnLoginOnly,
  CONTACT_LOGIN_CONSEQUENCES,
  CONTACT_LOGIN_NOTE,
  deletionConsequences,
  DELETE_CONFIRM_WORD,
} from '@/domain/data-rights';
import { confirm, notify } from '@/lib/confirm';
import { saveDataExport } from '@/lib/data-export';

import { Actions, Button, Columns, Field, FieldsCard, Group, GroupRow, Notice, PageHeader, Screen } from './ui';

/** Delete my account: what happens, a chance to download first, and a typed confirmation. */
export function DeleteAccountScreen() {
  const profile = useSession((s) => s.profile);
  const signOut = useSession((s) => s.signOut);
  // Kept from the first render: the profile disappears once the account has been deleted.
  const [role] = useState(() => profile?.role ?? 'parent');
  const [me] = useState(() => (profile?.role === 'parent' ? { id: profile.id, familyId: profile.familyId } : undefined));
  // A family contact who is not the main contact closes only their own sign-in (account_closes_own_login_only).
  const contacts = useFamilyContacts(me?.familyId);
  const ownLoginOnly = !!me && closesOwnLoginOnly(contacts.data ?? [], me.id);
  const [typed, setTyped] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const consequences = ownLoginOnly ? CONTACT_LOGIN_CONSEQUENCES : deletionConsequences(role);
  const confirmed = canConfirmDeletion(typed);

  async function downloadFirst() {
    setDownloading(true);
    try {
      await saveDataExport(await source.exportMyData());
    } catch (err) {
      if (flagViewError(err)) return;
      notify('We could not prepare your data', `Please try again in a moment, or email ${SUPPORT_EMAIL}.`);
    } finally {
      setDownloading(false);
    }
  }

  async function deleteNow() {
    setDeleting(true);
    try {
      await source.deleteMyAccount();
    } catch (err) {
      setDeleting(false);
      if (flagViewError(err)) return;
      notify('Your account has not been deleted', err instanceof Error ? err.message : 'Please try again in a moment.');
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
    notify('Your account has been deleted', 'Thank you for learning with Elite Education. Your personal details have been removed.');
  }

  return (
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false, title: 'Delete my account' }} />
      <PageHeader back={{ fallback: '/' }} kicker="Account" title="Delete your account" />
      <Notice tone="danger" title="This cannot be undone">
        {`Deleting your account is permanent. We are sorry to see you leave, and we would be glad to help with anything first: please write to ${SUPPORT_EMAIL}.`}
      </Notice>
      {ownLoginOnly ? <Notice tone="info">{CONTACT_LOGIN_NOTE}</Notice> : null}
      <Columns>
        <Group title="What will be removed">
          {consequences.removed.map((item) => (
            <GroupRow key={item} icon="close" tone="bad" title={item} titleWeight="regular" />
          ))}
        </Group>
        <Group title="What we keep" note={consequences.note}>
          {consequences.kept.map((item) => (
            <GroupRow key={item} icon="check" title={item} titleWeight="regular" />
          ))}
        </Group>
      </Columns>
      <Group title="Download my data first">
        <GroupRow
          icon="download"
          title="Download my data"
          note="We recommend keeping a copy of your records. The file opens in any text editor."
          action={{ label: downloading ? 'Preparing…' : 'Download', onPress: () => void downloadFirst(), disabled: downloading }}
        />
      </Group>
      <FieldsCard title="Confirm">
        <Field
          label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={DELETE_CONFIRM_WORD}
        />
      </FieldsCard>
      <Actions>
        <Button
          title="Delete my account permanently"
          variant="danger"
          icon="delete"
          disabled={!confirmed}
          loading={deleting}
          onPress={() =>
            confirm(
              'Delete your account?',
              ownLoginOnly
                ? "This cannot be undone. Your login and personal details will be removed straight away; the family's account stays with the main contact."
                : 'This cannot be undone. Your login and personal details will be removed straight away.',
              deleteNow,
              'Delete',
            )
          }
        />
      </Actions>
    </Screen>
  );
}
