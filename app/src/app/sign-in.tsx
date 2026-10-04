import { Redirect, router } from 'expo-router';
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
        setMessage(`If ${email.trim()} has an account, a password reset link is on its way.`);
        setMode('sign-in');
        return;
      }
      if (mode === 'verify') return confirmSignUp(email, code);
      // sign-up
      if (!fullName.trim()) throw new Error('Please enter your name.');
      if (password.length < 8) throw new Error('Choose a password of at least 8 characters.');
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
    reset: 'Reset password',
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
        <View style={[styles.hero, { backgroundColor: theme.primary }]}>
          <Txt variant="title" style={{ color: '#fff' }}>
            Elite <Txt variant="title" style={{ color: theme.gold }}>Education</Txt>
          </Txt>
          <Txt style={{ color: '#ffffffcc' }}>Expert IB, IGCSE &amp; A-Level maths tutoring in the UAE</Txt>
        </View>

        {demo && mode === 'sign-in' ? (
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
                onPress={() => run(() => signIn(p.email, ''))}
              />
            ))}
            <Button title="Try signing up as a new parent" variant="ghost" onPress={() => switchMode('sign-up')} />
            <ErrorNote error={error} />
          </View>
        ) : (
          <Card style={{ gap: Spacing.three }}>
            <Txt variant="h2">{titles[mode]}</Txt>
            {mode === 'sign-up' ? (
              <Txt variant="muted">
                New to Elite Education? Create an account to book a free consultation, message us and follow your child’s
                progress. Existing families and tutors: use the email address Elite Education has for you.
              </Txt>
            ) : null}
            {mode === 'verify' ? (
              <Txt variant="muted">We’ve sent a 6-digit code to {email.trim()}. Enter it below (or tap the link in the email).</Txt>
            ) : null}
            {message ? (
              <Banner tone="success" icon="check">
                {message}
              </Banner>
            ) : null}

            {mode === 'sign-up' ? (
              <>
                <Field label="Your name" value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" textContentType="name" />
                <Field label="Mobile / WhatsApp (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
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
                label="6-digit code"
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
                label={mode === 'sign-up' ? 'Choose a password (8+ characters)' : 'Password'}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'sign-up' ? 'new-password' : 'password'}
                textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
                onSubmitEditing={submit}
              />
            ) : null}

            <ErrorNote error={error} />
            <Button title={actions[mode]} variant={mode === 'sign-up' ? 'gold' : 'primary'} onPress={submit} loading={busy} disabled={!ready} />

            {mode === 'sign-in' ? (
              <>
                <Button title="New here? Create an account" variant="ghost" onPress={() => switchMode('sign-up')} />
                <Button title="Forgot password?" variant="ghost" size="sm" onPress={() => switchMode('reset')} />
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
                      setMessage('A new code is on its way.');
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
          <Txt variant="h3">Just want to ask a question?</Txt>
          <Txt variant="muted">Send us an enquiry and we’ll get back to you within one working day. No account needed.</Txt>
          <Button title="Send an enquiry" icon="doc" variant="secondary" onPress={() => router.push('/enquire')} />
          <Button title="Are you a maths teacher? Teach with us" variant="ghost" size="sm" onPress={() => router.push('/teach')} />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 16, padding: Spacing.four, gap: Spacing.two },
});
