/**
 * Colours for the "Continue with Apple" and "Continue with Google" buttons.
 * These follow each provider's own branding rules rather than the Elite palette:
 * Apple's HIG asks for a black button on light backgrounds and a white one on dark,
 * and Google's sign-in guidelines give a neutral light and dark scheme.
 *
 * Pure data (no React Native imports) so it can be unit-tested for contrast.
 */

export type SocialScheme = 'light' | 'dark';

export interface SocialButtonColours {
  bg: string;
  fg: string;
  /** Present when the button needs an outline to stand off the page. */
  border?: string;
}

/** Both buttons share one size, matching the app's pill-shaped Button. */
export const SOCIAL_BUTTON_HEIGHT = 48;
export const SOCIAL_BUTTON_RADIUS = SOCIAL_BUTTON_HEIGHT / 2;

export function socialButtonColors(scheme: SocialScheme): { apple: SocialButtonColours; google: SocialButtonColours } {
  return scheme === 'dark'
    ? {
        apple: { bg: '#FFFFFF', fg: '#000000' },
        google: { bg: '#131314', border: '#8E918F', fg: '#E3E3E3' },
      }
    : {
        apple: { bg: '#000000', fg: '#FFFFFF' },
        google: { bg: '#FFFFFF', border: '#747775', fg: '#1F1F1F' },
      };
}
