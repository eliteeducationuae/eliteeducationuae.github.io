import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { type IconName } from '@/components/icon';
import { Logo } from '@/components/logo';
import { SocialSignIn, useSocialProviders } from '@/components/social-sign-in';
import { Button, ErrorNote, Field, FieldsCard, FILL_IN, Group, GroupRow, Notice, Screen, Txt } from '@/components/ui';
import { font } from '@/constants/theme';
import { source } from '@/data';
import { useSession } from '@/data/session';
import type { Role } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

const ROLE_INFO: Record<Role, { label: string; icon: IconName; blurb: string }> = {
  admin: { label: 'Admin', icon: 'dashboard', blurb: 'The calendar, billing, tutors and families' },
  tutor: { label: 'Tutor', icon: 'school', blurb: 'Your schedule, lesson notes and pay' },
  parent: { label: 'Parent', icon: 'family_restroom', blurb: 'Lessons, progress reports and invoices' },
  student: { label: 'Student', icon: 'menu_book', blurb: 'Your lessons, homework and progress' },
  accountant: { label: 'Accountant', icon: 'account_balance', blurb: 'Invoices, VAT returns and exports, read only' },
};

type Mode = 'sign-in' | 'sign-up' | 'verify' | 'reset';

const PASSWORD_SHORT = 'Please choose a password of at least eight characters.';
const CODE_WRONG = 'Please enter the six digits from the email.';

/** The noir panel at the top of every sign-in page: white logo, the promise and the house line. */
function AuthHero() {
  const theme = useTheme();
  return (
    <View style={[styles.hero, { backgroundColor: theme.hero, borderColor: theme.heroBorder }]}>
      <Logo wide tone="white" width={140} />
      <Text style={[styles.headline, font('serif'), { color: theme.onHero }]} accessibilityRole="header">
        Private tutoring of distinction
      </Text>
      <View style={[styles.rule, { backgroundColor: theme.gold }]} />
      <Text style={[styles.essence, font('sans', 'bold'), { color: theme.onHero }]}>Excellence. Discretion. Results.</Text>
      <Text style={[styles.tagline, font('sans'), { color: theme.onHero }]}>
        Expert tutors for every subject, phase and curriculum, for families in the UAE and beyond.
      </Text>
    </View>
  );
}

/** Sign in, create an account, confirm the email code or reset the password: one page for every role. */
export default function SignIn() {
  const { status, signIn, signUp, confirmSignUp, authNotice, clearAuthNotice } = useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const providers = useSocialProviders();
  const anySocial = !!providers && (providers.apple || providers.google);

  if (status === 'signed-in') return <Redirect href="/" />;

  const switchMode = (m: Mode) => {
    setMode(m);
    setTried(false);
    setError(null);
    setMessage(null);
    clearAuthNotice();
  };

  const clearFeedback = () => {
    setError(null);
    setMessage(null);
  };

  // Apple and Google appear only once the live project confirms they are switched on (see useSocialProviders).
  const social = !anySocial ? null : (
    <View style={{ gap: 10 }}>
      <SocialSignIn providers={providers ?? undefined} disabled={busy} onStart={clearFeedback} onError={setError} />
      <Txt variant="note" style={{ textAlign: 'center' }}>
        We use only your name and email address.
      </Txt>
    </View>
  );

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

  const missing = {
    name: mode === 'sign-up' && !fullName.trim(),
    email: mode !== 'verify' && !email.trim(),
    password: mode === 'sign-in' ? !password : mode === 'sign-up' ? password.length < 8 : false,
    code: mode === 'verify' && !/^\d{6}$/.test(code.trim()),
  };
  const valid = !Object.values(missing).some(Boolean);

  const submit = () => {
    setTried(true);
    if (!valid || busy) return;
    void run(async () => {
      if (mode === 'sign-in') return signIn(email, password);
      if (mode === 'reset') {
        await source.resetPassword?.(email);
        // Neutral: the reply never says whether the address has an account.
        setMode('sign-in');
        setTried(false);
        setMessage(`If ${email.trim()} has an account, a password reset link is on its way. Please check your inbox.`);
        return;
      }
      if (mode === 'verify') return confirmSignUp(email, code);
      if ((await signUp(email, password, { fullName, phone })) === 'confirm-email') {
        setMode('verify');
        setTried(false);
      }
    });
  };

  const demo = source.demoAccounts?.();
  const titles: Record<Mode, string> = {
    'sign-in': 'Sign in',
    'sign-up': 'Create your account',
    verify: 'Check your email',
    reset: 'Reset your password',
  };
  const actions: Record<Mode, { title: string; icon: IconName }> = {
    'sign-in': { title: 'Sign in', icon: 'login' },
    'sign-up': { title: 'Create account', icon: 'person_add' },
    verify: { title: 'Confirm and continue', icon: 'checkmark' },
    reset: { title: 'Send reset link', icon: 'send' },
  };
  const err = (bad: boolean, text: string | true = true) => (tried && bad ? text : undefined);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen topInset narrow>
        <AuthHero />

        {authNotice ? (
          <Notice tone="warn" icon="alert">
            {authNotice}
          </Notice>
        ) : null}
        {message ? <Notice tone="good">{message}</Notice> : null}

        {demo && mode === 'sign-in' ? (
          <>
            <Notice tone="info" icon="auto_awesome">
              Demo mode: explore the app with realistic sample data. Continue with Apple or Google to sign in as the sample parent, or choose a role
              below. Nothing you do here is sent anywhere.
            </Notice>
            {social}
            <Group title="Or choose a role">
              {demo.map((p) => (
                <GroupRow
                  key={p.id}
                  icon={ROLE_INFO[p.role].icon}
                  title={`${ROLE_INFO[p.role].label} · ${p.fullName}`}
                  note={ROLE_INFO[p.role].blurb}
                  onPress={() => run(() => signIn(p.email, ''))}
                />
              ))}
            </Group>
            <ErrorNote error={error} />
            <Group>
              <GroupRow icon="person_add" title="Try signing up as a new family" onPress={() => switchMode('sign-up')} />
            </Group>
          </>
        ) : (
          <>
            <FieldsCard title={titles[mode]}>
              {mode === 'verify' ? (
                <Field
                  label="Six-digit code"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  placeholder="000000"
                  hint={`We have sent a six-digit code to ${email.trim()}. Please enter it below, or open the link in the email.`}
                  error={err(missing.code, CODE_WRONG)}
                  onSubmitEditing={submit}
                />
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
                    placeholder="e.g. Fatima Hassan"
                    error={err(missing.name)}
                  />
                  <Field
                    label="Mobile or WhatsApp number (optional)"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    placeholder="+971"
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
                  placeholder="you@example.com"
                  error={err(missing.email)}
                  onSubmitEditing={mode === 'reset' ? submit : undefined}
                />
              ) : null}
              {mode === 'sign-in' || mode === 'sign-up' ? (
                <Field
                  label={mode === 'sign-up' ? 'Choose a password (at least eight characters)' : 'Password'}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'password'}
                  textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
                  error={err(missing.password, mode === 'sign-up' ? PASSWORD_SHORT : FILL_IN)}
                  onSubmitEditing={submit}
                />
              ) : null}
            </FieldsCard>

            {mode === 'sign-up' ? (
              <Notice tone="info">
                Create an account to arrange a complimentary consultation, message us and follow your child’s progress. If you are already a client or
                one of our tutors, please use the email address we hold for you.
              </Notice>
            ) : null}

            <ErrorNote error={error} />
            <View style={{ gap: 10 }}>
              <Button title={actions[mode].title} icon={actions[mode].icon} onPress={submit} loading={busy} />
              {mode === 'sign-in' || mode === 'sign-up' ? social : null}
            </View>

            {mode === 'sign-in' ? (
              <Group>
                <GroupRow icon="person_add" title="New to Elite Education? Create an account" onPress={() => switchMode('sign-up')} />
                <GroupRow icon="key" title="Forgotten your password?" onPress={() => switchMode('reset')} />
                <GroupRow
                  icon="mark_email_read"
                  title="Invited by Elite Education?"
                  titleWeight="regular"
                  note="Open the link in your invitation email to set your password"
                />
              </Group>
            ) : mode === 'verify' ? (
              <Group>
                <GroupRow
                  icon="refresh"
                  title="Send the code again"
                  onPress={() =>
                    run(async () => {
                      await source.resendSignUpCode?.(email);
                      setMessage('A new code is on its way. Please check your inbox.');
                    })
                  }
                />
                <GroupRow icon="arrow_back" title="Already confirmed? Sign in" onPress={() => switchMode('sign-in')} />
              </Group>
            ) : (
              <Group>
                <GroupRow icon="arrow_back" title="Back to sign in" onPress={() => switchMode('sign-in')} />
              </Group>
            )}
          </>
        )}

        <Group title="Would you like to ask a question first?" note="Send us an enquiry and we will be in touch within one working day.">
          <GroupRow icon="description" title="Send an enquiry" note="No account is needed" onPress={() => router.push('/enquire')} />
          <GroupRow icon="school" title="Are you an experienced tutor? Teach with us" note="Apply online" onPress={() => router.push('/teach')} />
        </Group>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 30,
    paddingHorizontal: 28,
    paddingBottom: 34,
    gap: 14,
    alignItems: 'center',
  },
  headline: { fontSize: 28, lineHeight: 35, textAlign: 'center' },
  rule: { width: 32, height: 2 },
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
