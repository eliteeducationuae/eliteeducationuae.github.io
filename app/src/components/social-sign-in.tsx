import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type TextStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useSession, type SocialProvider } from '@/data/session';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { AppleNativeButton, HAS_NATIVE_APPLE_BUTTON } from './apple-native-button';
import { SOCIAL_BUTTON_HEIGHT, SOCIAL_BUTTON_RADIUS, socialButtonColors, type SocialButtonColours } from './social-colors';

const APPLE_LOGO = require('../../assets/images/social/apple-logo.png');
const GOOGLE_G = require('../../assets/images/social/google-g.png');
const LOGO_SIZE = 18;

/**
 * Both provider labels share one system sans-serif, so they match each other and stay outside the Elite
 * typeface pair (they are the providers' marks, not ours). Apple asks for the system font on its buttons.
 */
const PROVIDER_LABEL: TextStyle = {
  fontFamily:
    Platform.OS === 'web' ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' : undefined,
  fontWeight: '600',
};

/**
 * "Continue with Apple" and "Continue with Google", equal in size, Apple first.
 * Each follows its provider's own branding, so neither is restyled in the Elite palette.
 */
export function SocialSignIn({
  disabled,
  onError,
  onStart,
}: {
  disabled?: boolean;
  onError(err: unknown): void;
  onStart?(): void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colours = socialButtonColors(scheme);
  const { signInWithProvider, clearAuthNotice } = useSession();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const inactive = !!disabled || busy !== null;

  async function start(provider: SocialProvider) {
    if (inactive) return;
    onStart?.();
    clearAuthNotice();
    setBusy(provider);
    try {
      const result = await signInWithProvider(provider);
      // On the web the page is about to navigate to the provider, so the spinner stays.
      if (result !== 'redirecting') setBusy(null);
    } catch (err) {
      setBusy(null);
      onError(err);
    }
  }

  return (
    <View style={styles.column}>
      {HAS_NATIVE_APPLE_BUTTON ? (
        <View
          pointerEvents={inactive ? 'none' : 'auto'}
          accessibilityState={{ disabled: inactive, busy: busy === 'apple' }}
          style={inactive && busy !== 'apple' && { opacity: 0.5 }}>
          <AppleNativeButton dark={scheme === 'dark'} onPress={() => start('apple')} />
          {busy === 'apple' ? (
            <View style={[styles.busyOverlay, { backgroundColor: colours.apple.bg }]} accessibilityLabel="Signing you in">
              <ActivityIndicator size="small" color={colours.apple.fg} />
            </View>
          ) : null}
        </View>
      ) : (
        <ProviderButton
          title="Continue with Apple"
          logo={APPLE_LOGO}
          tint
          colours={colours.apple}
          textStyle={PROVIDER_LABEL}
          busy={busy === 'apple'}
          disabled={inactive}
          onPress={() => start('apple')}
        />
      )}
      <ProviderButton
        title="Continue with Google"
        logo={GOOGLE_G}
        colours={colours.google}
        textStyle={PROVIDER_LABEL}
        busy={busy === 'google'}
        disabled={inactive}
        onPress={() => start('google')}
      />
    </View>
  );
}

function ProviderButton({
  title,
  logo,
  tint,
  colours,
  textStyle,
  busy,
  disabled,
  onPress,
}: {
  title: string;
  logo: ImageSourcePropType;
  /** Single-colour logos take the text colour; Google's G must stay in its own colours. */
  tint?: boolean;
  colours: SocialButtonColours;
  textStyle: TextStyle;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colours.bg, borderColor: colours.border ?? colours.bg },
        pressed && { opacity: 0.85 },
        disabled && !busy && { opacity: 0.5 },
      ]}>
      <View style={styles.logoSlot}>
        {busy ? (
          <ActivityIndicator size="small" color={colours.fg} />
        ) : (
          <Image
            source={logo}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.logo, tint && { tintColor: colours.fg }]}
          />
        )}
      </View>
      <Text style={[styles.label, textStyle, { color: colours.fg }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', gap: Spacing.two },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two + 2,
    height: SOCIAL_BUTTON_HEIGHT,
    paddingHorizontal: Spacing.four,
    borderRadius: SOCIAL_BUTTON_RADIUS,
    borderWidth: 1,
  },
  logoSlot: { width: LOGO_SIZE, height: LOGO_SIZE, alignItems: 'center', justifyContent: 'center' },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  label: { fontSize: 16, lineHeight: 20 },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SOCIAL_BUTTON_RADIUS,
  },
});
