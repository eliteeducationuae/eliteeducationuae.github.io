import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';

import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { flagViewError } from '@/data/view-as';
import { notify } from '@/lib/confirm';
import { saveDataExport, shareDataSummaryPdf } from '@/lib/data-export';
import { reportError } from '@/lib/error-reporting';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Button, Card, Section, Txt } from './ui';

async function openLink(url: string) {
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
}

/** "Your data and privacy" on every Account screen: download, policies and account deletion. */
export function DataPrivacyCard() {
  const theme = useTheme();
  const [busy, setBusy] = useState<'json' | 'pdf' | null>(null);

  async function download(kind: 'json' | 'pdf') {
    setBusy(kind);
    try {
      const data = await source.exportMyData();
      if (kind === 'json') await saveDataExport(data);
      else await shareDataSummaryPdf(data);
    } catch (err) {
      // While an admin is viewing as someone, the refusal is shown as the calm view-only notice instead.
      if (flagViewError(err)) return;
      reportError(err, { source: 'manual', route: 'data-export' });
      notify(
        'We could not prepare your data',
        `Please try again in a moment. If the problem continues, please email ${SUPPORT_EMAIL}.`,
      );
    } finally {
      setBusy(null);
    }
  }

  const link = (label: string, url: string) => (
    <Pressable
      key={label}
      onPress={() => openLink(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 }, pressed && { opacity: 0.7 }]}>
      <Icon name="link" size={16} color={theme.accent} />
      <Txt style={{ color: theme.accent, textDecorationLine: 'underline' }}>{label}</Txt>
    </Pressable>
  );

  return (
    <Section title="Your data and privacy">
      <Card style={{ gap: Spacing.three }}>
        <Txt variant="muted">
          You may download a copy of everything we hold about you at any time. Elite Education treats your information with complete discretion.
        </Txt>
        <View style={{ gap: Spacing.two }}>
          <Button title="Download my data" variant="outline" icon="share" loading={busy === 'json'} disabled={!!busy} onPress={() => download('json')} />
          <Button title="Download a summary (PDF)" variant="secondary" icon="doc" loading={busy === 'pdf'} disabled={!!busy} onPress={() => download('pdf')} />
        </View>
        <View>
          {link('Privacy policy', PRIVACY_URL)}
          {link('Terms of service', TERMS_URL)}
        </View>
        <Pressable
          onPress={() => router.push('/account-delete')}
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
          hitSlop={6}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, paddingTop: Spacing.two, borderTopWidth: 1, borderTopColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}>
          <Txt style={{ color: theme.danger, flex: 1 }}>Delete my account</Txt>
          <Icon name="chevron" size={16} color={theme.danger} />
        </Pressable>
      </Card>
    </Section>
  );
}
