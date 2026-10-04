import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { appleDisplayName } from '@/lib/social-auth';

/** iOS uses Apple's native sheet, then hands the identity token to Supabase. */
export const APPLE_NATIVE = true;

/**
 * Show the native Sign in with Apple sheet. Returns null if the person cancels.
 * Apple receives the SHA-256 of the nonce; Supabase receives the raw nonce to verify the token.
 */
export async function appleNativeSignIn(): Promise<{ identityToken: string; rawNonce: string; fullName: string | null } | null> {
  const rawNonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED') return null;
    throw err;
  }
  if (!credential.identityToken) throw new Error('Apple did not return a sign-in token. Please try again.');
  return { identityToken: credential.identityToken, rawNonce, fullName: appleDisplayName(credential.fullName) };
}
