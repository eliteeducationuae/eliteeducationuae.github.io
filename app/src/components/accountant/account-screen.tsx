import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { Actions, Button, Columns, Group, GroupRow, Notice, PageHeader, Screen } from '@/components/ui';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config';
import { source } from '@/data';
import { queryClient } from '@/data/query';
import { useMe, useSession } from '@/data/session';
import { flagViewError } from '@/data/view-as';
import { confirm, notify } from '@/lib/confirm';
import { saveDataExport, shareDataSummaryPdf } from '@/lib/data-export';
import { reportError } from '@/lib/error-reporting';

async function openLink(url: string) {
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
}

/** The accountant's Account: who they are, what read-only access means, their data, closing the login and signing out. */
export function AccountantAccountScreen() {
  const me = useMe();
  const signOut = useSession((s) => s.signOut);
  const viewing = useSession((s) => !!s.viewing);
  const exitViewAs = useSession((s) => s.exitViewAs);
  const [busy, setBusy] = useState<'json' | 'pdf' | 'reset' | null>(null);

  async function download(kind: 'json' | 'pdf') {
    setBusy(kind);
    try {
      const data = await source.exportMyData();
      if (kind === 'json') await saveDataExport(data);
      else await shareDataSummaryPdf(data);
    } catch (err) {
      if (flagViewError(err)) return;
      reportError(err, { source: 'manual', route: 'data-export' });
      notify('We could not prepare your data', `Please try again in a moment. If the problem continues, please email ${SUPPORT_EMAIL}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen topInset>
      <PageHeader kicker="Account" title={me.fullName} sub={me.email} />
      <Notice tone="info" icon="visibility" title="Read-only access">
        You can read and download the books. Students, lessons and messages are not shared with you.
      </Notice>
      <Columns>
        <Group title="Data and privacy">
          <GroupRow icon="lock" title="How your data is used" note="Your name and email are used to sign you in" />
          <GroupRow
            icon="download"
            title="Download my data"
            note="Everything we hold about you, as a file"
            action={viewing ? undefined : { label: busy === 'json' ? 'Preparing…' : 'Download', onPress: () => void download('json'), disabled: !!busy, accessibilityLabel: 'Download my data' }}
          />
          <GroupRow
            icon="picture_as_pdf"
            title="Download a summary"
            note="The same, as a PDF"
            action={viewing ? undefined : { label: busy === 'pdf' ? 'Preparing…' : 'Download', onPress: () => void download('pdf'), disabled: !!busy, accessibilityLabel: 'Download a summary (PDF)' }}
          />
          <GroupRow icon="verified_user" title="Privacy policy" onPress={() => void openLink(PRIVACY_URL)} />
          <GroupRow icon="description" title="Terms of service" onPress={() => void openLink(TERMS_URL)} />
          {viewing ? null : (
            <GroupRow
              icon="person_remove"
              tone="bad"
              title="Close my login"
              note="The books are not affected"
              onPress={() => router.push('/account-delete')}
            />
          )}
        </Group>
        {source.kind === 'demo' && source.resetDemo && !viewing ? (
          <Group title="Demo">
            <GroupRow
              icon="refresh"
              title="Reset demo data"
              note="Restores the original sample lessons, notes and invoices"
              action={{
                label: 'Reset',
                disabled: busy === 'reset',
                onPress: () =>
                  confirm('Reset demo data?', 'This restores the original sample lessons, notes and invoices.', async () => {
                    setBusy('reset');
                    await source.resetDemo!();
                    await queryClient.invalidateQueries();
                    setBusy(null);
                  }),
              }}
            />
          </Group>
        ) : null}
      </Columns>
      <Actions>
        {viewing ? (
          <Button
            title="Exit view"
            variant="secondary"
            icon="eye"
            onPress={async () => {
              await exitViewAs();
              router.replace('/admin');
            }}
          />
        ) : (
          <Button title="Sign out" variant="secondary" icon="logout" onPress={() => signOut()} />
        )}
      </Actions>
    </Screen>
  );
}
