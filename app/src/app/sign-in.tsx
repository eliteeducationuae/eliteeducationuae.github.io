import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Banner, Button, Card, ErrorNote, Field, ListItem, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useSession } from '@/data/session';
import type { Role } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

const ROLE_INFO: Record<Role, { label: string; icon: IconName; blurb: string }> = {
  admin: { label: 'Admin', icon: 'chart', blurb: 'Run the business: calendar, billing, tutors' },
  tutor: { label: 'Tutor', icon: 'school', blurb: 'Your schedule, lesson notes and pay' },
  parent: { label: 'Parent', icon: 'people', blurb: 'Lessons, progress reports and invoices' },
  student: { label: 'Student', icon: 'book', blurb: 'Your lessons, homework and progress' },
};

export default function SignIn() {
  const theme = useTheme();
  const { status, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (status === 'signed-in') return <Redirect href="/" />;

  async function go(e = email, p = password) {
    setBusy(true);
    setError(null);
    try {
      await signIn(e, p);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const demo = source.demoAccounts?.();

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen topInset>
        <View style={[styles.hero, { backgroundColor: theme.primary }]}>
          <Txt variant="title" style={{ color: '#fff' }}>
            Elite <Txt variant="title" style={{ color: theme.gold }}>Education</Txt>
          </Txt>
          <Txt style={{ color: '#ffffffcc' }}>Expert IB, IGCSE &amp; A-Level maths tutoring in the UAE</Txt>
        </View>

        {demo ? (
          <View style={{ gap: Spacing.two }}>
            <Banner icon="sparkle">
              Demo mode: explore with realistic sample data. Pick a role to sign in, and nothing you do here is sent anywhere.
            </Banner>
            {demo.map((p) => (
              <ListItem
                key={p.id}
                title={`${ROLE_INFO[p.role].label} · ${p.fullName}`}
                subtitle={ROLE_INFO[p.role].blurb}
                left={<Icon name={ROLE_INFO[p.role].icon} size={22} color={theme.accent} />}
                onPress={() => go(p.email, '')}
              />
            ))}
            <ErrorNote error={error} />
          </View>
        ) : (
          <Card style={{ gap: Spacing.three }}>
            <Txt variant="h2">Sign in</Txt>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              onSubmitEditing={() => go()}
            />
            <ErrorNote error={error} />
            <Button title="Sign in" onPress={() => go()} loading={busy} disabled={!email || !password} />
            <Txt variant="small" style={{ textAlign: 'center' }}>
              Accounts are created by Elite Education. Contact us if you need access.
            </Txt>
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 16, padding: Spacing.four, gap: Spacing.two },
});
