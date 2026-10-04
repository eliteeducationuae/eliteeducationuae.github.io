/**
 * Apple's own sign-in control exists only on iOS (see apple-native-button.ios.tsx).
 * Elsewhere SocialSignIn draws a custom button that follows Apple's guidelines.
 */
export const HAS_NATIVE_APPLE_BUTTON = false;

export function AppleNativeButton(_: { onPress: () => void; dark: boolean }) {
  return null;
}
