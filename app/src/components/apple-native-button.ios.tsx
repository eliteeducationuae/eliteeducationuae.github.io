import * as AppleAuthentication from 'expo-apple-authentication';

import { SOCIAL_BUTTON_HEIGHT, SOCIAL_BUTTON_RADIUS } from './social-colors';

/** On iOS, Apple's guidelines require the system "Continue with Apple" control. */
export const HAS_NATIVE_APPLE_BUTTON = true;

export function AppleNativeButton({ onPress, dark }: { onPress: () => void; dark: boolean }) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={SOCIAL_BUTTON_RADIUS}
      style={{ width: '100%', height: SOCIAL_BUTTON_HEIGHT }}
      onPress={onPress}
    />
  );
}
