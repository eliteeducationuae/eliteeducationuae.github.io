import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Logo } from '@/components/logo';
import { Banner, Button, Card, ErrorNote, Field, ListItem, Screen, Txt } from '@/components/ui';
import { Radius, Spacing, elevation, font } from '@/constants/theme';
import { source } from '@/data';
import { useSession } from '@/data/session';
import type { Role } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

const ROLE_INFO: Record<Role, { label: string; icon: IconName; blurb: string }> = {
  admin: { label: 'Admin', icon: 'chart', blurb: 'The calendar, billing, tutors and families' },
  tutor: { label: 'Tutor', icon: 'school', blurb: 'Your schedule, lesson notes and pay' },
  parent: { label: 'Parent', icon: 'people', blurb: 'Lessons, progress reports and invoices' },
  student: { label: 'Student', icon: 'book', blurb: 'Your lessons, homework and progress' },
};

type Mode = 'sign-in' | 'sign-up' | 'verify' | 'reset';

export default function SignIn() {
  const theme = useTheme();
  const { status, signIn, signUp, confirmSignUp } = useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (status === 'signed-in') return <Redirect href="/" />;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setMessage(null);
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const submit = () =>
    run(async () => {
      if (mode === 'sign-in') return signIn(email, password);
      if (mode === 'reset') {
        await source.resetPassword?.(email);
        setMessage(`If ${email.trim()} has an account, a password reset link is on its way. Please check your inbox.`);
        setMode('sign-in');
        return;
      }
      if (mode === 'verify') return confirmSignUp(email, code);
      // sign-up
      if (!fullName.trim()) throw new Error('Please enter your name.');
      if (password.length < 8) throw new Error('Please choose a password of at least eight characters.');
      if ((await signUp(email, password, { fullName, phone })) === 'confirm-email') setMode('verify');
    });

  const demo = source.demoAccounts?.();
  const ready =
    mode === 'sign-in'
      ? email && password
      : mode === 'sign-up'
        ? fullName && email && password
        : mode === 'verify'
          ? /^\d{6}$/.test(code.trim())
          : email;
  const titles: Record<Mode, string> = {
    'sign-in': 'Sign in',
    'sign-up': 'Create your account',
    verify: 'Check your email',
    reset: 'Reset your password',
  };
  const actions: Record<Mode, string> = {
    'sign-in': 'Sign in',
    'sign-up': 'Create account',
    verify: 'Confirm and continue',
    reset: 'Send reset link',
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen topInset>
        <View style={styles.column}>
          <View
            style={[
              styles.hero,
              {
                backgroundColor: theme.hero,
                borderColor: theme.heroBorder,
              },
              elevation(theme, 2),
            ]}>
            <Logo tone="white" width={120} />
            <Text style={[styles.headline, font('serif', 'bold'), { color: theme.onHero }]} accessibilityRole="header">
              Private tutoring of distinction
            </Text>
            <View style={[styles.rule, { backgroundColor: theme.gold }]} />
            <Text style={[styles.essence, font('sans', 'bold'), { color: theme.onHero }]}>Excellence. Discretion. Results.</Text>
            <Text style={[styles.tagline, font('sans'), { color: theme.onHero }]}>
              Expert tutors for every subject, phase and curriculum, for families in the UAE and beyond.
            </Text>
          </View>

          {demo && mode === 'sign-in' ? (
            <View style={{ gap: Spacing.two }}>
              <Banner icon="sparkle">
                Demo mode: explore the app with realistic sample data. Choose a role to sign in. Nothing you do here is sent anywhere.
              </Banner>
              {demo.map((p) => (
                <ListItem
                  key={p.id}
                  title={`${ROLE_INFO[p.role].label} · ${p.fullName}`}
                  subtitle={ROLE_INFO[p.role].blurb}
                  left={<Icon name={ROLE_INFO[p.role].icon} size={22} color={theme.accent} />}
                  onPress={() => run(() => signIn(p.email, ''))}
                />
              ))}
              <Button title="Try signing up as a new family" variant="ghost" onPress={() => switchMode('sign-up')} />
              <ErrorNote error={error} />
            </View>
          ) : (
            <Card style={{ gap: Spacing.three }}>
              <Txt variant="h2">{titles[mode]}</Txt>
              {mode === 'sign-up' ? (
                <Txt variant="muted">
                  Create an account to arrange a complimentary consultation, message us and follow your child’s progress. If you are already
                  a client or one of our tutors, please use the email address we hold for you.
                </Txt>
              ) : null}
              {mode === 'verify' ? (
                <Txt variant="muted">
                  We have sent a six-digit code to {email.trim()}. Please enter it below, or open the link in the email.
                </Txt>
              ) : null}
              {message ? (
                <Banner tone="success" icon="check">
                  {message}
                </Banner>
              ) : null}

              {mode === 'sign-up' ? (
                <>
                  <Field
                    label="Your name"
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                  />
                  <Field
                    label="Mobile or WhatsApp number (optional)"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                  />
                </>
              ) : null}
              {mode !== 'verify' ? (
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
              ) : (
                <Field
                  label="Six-digit code"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  onSubmitEditing={submit}
                />
              )}
              {mode === 'sign-in' || mode === 'sign-up' ? (
                <Field
                  label={mode === 'sign-up' ? 'Choose a password (at least eight characters)' : 'Password'}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'password'}
                  textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
                  onSubmitEditing={submit}
                />
              ) : null}

              <ErrorNote error={error} />
              <Button
                title={actions[mode]}
                variant={mode === 'sign-up' ? 'gold' : 'primary'}
                onPress={submit}
                loading={busy}
                disabled={!ready}
              />

              {mode === 'sign-in' ? (
                <>
                  <Button title="New to Elite Education? Create an account" variant="ghost" onPress={() => switchMode('sign-up')} />
                  <Button title="Forgotten your password?" variant="ghost" size="sm" onPress={() => switchMode('reset')} />
                </>
              ) : mode === 'verify' ? (
                <>
                  <Button
                    title="Send the code again"
                    variant="ghost"
                    size="sm"
                    onPress={() =>
                      run(async () => {
                        await source.resendSignUpCode?.(email);
                        setMessage('A new code is on its way. Please check your inbox.');
                      })
                    }
                  />
                  <Button title="Already confirmed? Sign in" variant="ghost" size="sm" onPress={() => switchMode('sign-in')} />
                </>
              ) : (
                <Button title="Back to sign in" variant="ghost" onPress={() => switchMode('sign-in')} />
              )}
            </Card>
          )}

          <Card style={{ gap: Spacing.two }}>
            <Txt variant="h3">Would you like to ask a question first?</Txt>
            <Txt variant="muted">Send us an enquiry and we will be in touch within one working day. No account is needed.</Txt>
            <Button title="Send an enquiry" icon="doc" variant="secondary" onPress={() => router.push('/enquire')} />
            <Button title="Are you an experienced tutor? Teach with us" variant="ghost" size="sm" onPress={() => router.push('/teach')} />
          </Card>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  hero: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    alignItems: 'center',
  },
  headline: { fontSize: 28, lineHeight: 36, textAlign: 'center' },
  rule: { width: 32, height: 1.5 },
  essence: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    opacity: 0.9,
  },
  tagline: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    opacity: 0.8,
    maxWidth: 360,
  },
});
