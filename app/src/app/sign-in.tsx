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
  const { status, signIn, signUp } = useSession();
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (status === 'signed-in') return <Redirect href="/" />;

  async function go(e = email, p = password) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'sign-up') {
        if (p.length < 8) throw new Error('Choose a password of at least 8 characters.');
        if ((await signUp(e, p)) === 'confirm-email') {
          setMessage(`We’ve emailed a confirmation link to ${e.trim()}. Tap it, then come back and sign in.`);
          setMode('sign-in');
        }
      } else if (mode === 'reset') {
        await source.resetPassword?.(e);
        setMessage(`If ${e.trim()} has an account, a password reset link is on its way.`);
        setMode('sign-in');
      } else {
        await signIn(e, p);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const demo = source.demoAccounts?.();
  const switchMode = (m: typeof mode) => {
    setMode(m);
    setError(null);
    setMessage(null);
  };

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
            <Txt variant="h2">{mode === 'sign-up' ? 'Create your account' : mode === 'reset' ? 'Reset password' : 'Sign in'}</Txt>
            {mode === 'sign-up' ? (
              <Txt variant="muted">Use the email address you gave Elite Education, so we can link you to your family or tutor profile.</Txt>
            ) : null}
            {message ? <Banner tone="success" icon="check">{message}</Banner> : null}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            {mode !== 'reset' ? (
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'sign-up' ? 'new-password' : 'password'}
                textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
                onSubmitEditing={() => go()}
              />
            ) : null}
            <ErrorNote error={error} />
            <Button
              title={mode === 'sign-up' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
              onPress={() => go()}
              loading={busy}
              disabled={!email || (mode !== 'reset' && !password)}
            />
            {mode === 'sign-in' ? (
              <>
                <Button title="New here? Create an account" variant="ghost" onPress={() => switchMode('sign-up')} />
                <Button title="Forgot password?" variant="ghost" size="sm" onPress={() => switchMode('reset')} />
              </>
            ) : (
              <Button title="Back to sign in" variant="ghost" onPress={() => switchMode('sign-in')} />
            )}
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 16, padding: Spacing.four, gap: Spacing.two },
});
