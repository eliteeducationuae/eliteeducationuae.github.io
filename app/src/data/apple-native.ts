/**
 * Native Sign in with Apple is iOS only (see apple-native.ios.ts). Everywhere else Apple sign-in goes
 * through the browser, so this stub keeps the native module out of the web and Android bundles.
 */
export const APPLE_NATIVE = false;

export async function appleNativeSignIn(): Promise<{ identityToken: string; rawNonce: string; fullName: string | null } | null> {
  throw new Error('Apple sign-in on this device uses the browser.');
}
