import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type TextStyle } from 'react-native';

import { Spacing, font } from '@/constants/theme';
import { useSession, type SocialProvider } from '@/data/session';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { AppleNativeButton, HAS_NATIVE_APPLE_BUTTON } from './apple-native-button';
import { SOCIAL_BUTTON_HEIGHT, SOCIAL_BUTTON_RADIUS, socialButtonColors, type SocialButtonColours } from './social-colors';

const APPLE_LOGO = require('../../assets/images/social/apple-logo.png');
const GOOGLE_G = require('../../assets/images/social/google-g.png');
const LOGO_SIZE = 18;

/** Apple asks custom "Continue with Apple" buttons to use the system font. */
const APPLE_FONT = Platform.OS === 'web' ? '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif' : undefined;

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
          style={inactive && { opacity: 0.5 }}>
          <AppleNativeButton dark={scheme === 'dark'} onPress={() => start('apple')} />
        </View>
      ) : (
        <ProviderButton
          title="Continue with Apple"
          logo={APPLE_LOGO}
          tint
          colours={colours.apple}
          textStyle={{ fontFamily: APPLE_FONT, fontWeight: '600' }}
          busy={busy === 'apple'}
          disabled={inactive}
          onPress={() => start('apple')}
        />
      )}
      <ProviderButton
        title="Continue with Google"
        logo={GOOGLE_G}
        colours={colours.google}
        textStyle={font('sans', 'bold')}
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
});
