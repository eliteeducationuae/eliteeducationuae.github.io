import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { SUPPORT_EMAIL } from '@/config';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { canConfirmDeletion, deletionConsequences, DELETE_CONFIRM_WORD } from '@/domain/data-rights';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';
import { saveDataExport } from '@/lib/data-export';

import { Icon, type IconName } from './icon';
import { Button, Card, Field, Row, Screen, Section, Txt } from './ui';

function Bullets({ items, icon, color }: { items: string[]; icon: IconName; color: string }) {
  return (
    <View style={{ gap: Spacing.two }}>
      {items.map((item) => (
        <Row key={item} gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 3 }}>
            <Icon name={icon} size={16} color={color} />
          </View>
          <Txt style={{ flex: 1 }}>{item}</Txt>
        </Row>
      ))}
    </View>
  );
}

/** Delete my account: what happens, a chance to download first, and a typed confirmation. */
export function DeleteAccountScreen() {
  const theme = useTheme();
  const profile = useSession((s) => s.profile);
  const signOut = useSession((s) => s.signOut);
  // Kept from the first render: the profile disappears once the account has been deleted.
  const [role] = useState(() => profile?.role ?? 'parent');
  const [typed, setTyped] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const consequences = deletionConsequences(role);
  const confirmed = canConfirmDeletion(typed);

  async function downloadFirst() {
    setDownloading(true);
    try {
      await saveDataExport(await source.exportMyData());
    } catch {
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
    <Screen>
      <Card style={{ gap: Spacing.three }}>
        <Txt variant="h2">Before you go</Txt>
        <View style={{ width: 28, height: 2, backgroundColor: theme.gold }} />
        <Txt>
          Deleting your account is permanent. We are sorry to see you leave, and we would be glad to help with anything first: please write to{' '}
          {SUPPORT_EMAIL}.
        </Txt>
      </Card>

      <Section title="What will be removed">
        <Card>
          <Bullets items={consequences.removed} icon="close" color={theme.danger} />
        </Card>
      </Section>

      <Section title="What we keep">
        <Card>
          <Bullets items={consequences.kept} icon="check" color={theme.accent} />
          <Txt variant="muted">{consequences.note}</Txt>
        </Card>
      </Section>

      <Section title="Download my data first">
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="muted">We recommend keeping a copy of your records. The file opens in any text editor.</Txt>
          <Button title="Download my data" variant="outline" icon="share" loading={downloading} onPress={downloadFirst} />
        </Card>
      </Section>

      <Section title="Confirm">
        <Card style={{ gap: Spacing.three }}>
          <Field
            label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={DELETE_CONFIRM_WORD}
          />
          <Button
            title="Delete my account permanently"
            variant="danger"
            icon="alert"
            disabled={!confirmed}
            loading={deleting}
            onPress={() =>
              confirm(
                'Delete your account?',
                'This cannot be undone. Your login and personal details will be removed straight away.',
                deleteNow,
                'Delete',
              )
            }
          />
        </Card>
      </Section>
    </Screen>
  );
}
