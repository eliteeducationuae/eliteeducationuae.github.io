/**
 * Elite Education colour and spacing data, from the 2026 Brand Guidelines:
 * Noir Black #0A0A0A and Champagne Gold #C9A84C, with Ivory Cream #F9F8F5, Pure White and Stone Grey #888888.
 * Gold is an accent, never a large background or a text colour.
 *
 * This file is pure data (no React Native or CSS imports) so it can be unit-tested for contrast.
 * Import from '@/constants/theme' in app code; it re-exports everything here.
 */

export const Brand = {
  noir: '#0A0A0A',
  gold: '#C9A84C',
  white: '#FFFFFF',
  ivory: '#F9F8F5',
  stone: '#888888',
} as const;

export const Colors = {
  light: {
    background: Brand.ivory,
    surface: Brand.white,
    surfaceAlt: '#F2EFE7',
    border: '#E5E0D4',
    text: Brand.noir,
    // Stone Grey, deepened so body text meets WCAG AA on white and ivory.
    textMuted: '#6B6B6B',
    primary: Brand.noir,
    onPrimary: Brand.white,
    // Gold for interactive text and icons, deepened for contrast; Brand.gold is for rules and accents.
    accent: '#7E621F',
    gold: Brand.gold,
    onGold: Brand.noir,
    champagne: '#F5EEDC',
    hero: Brand.noir,
    // Hairline around noir hero panels: invisible on light, a quiet gold edge on dark.
    heroBorder: Brand.noir,
    onHero: Brand.ivory,
    // Secondary text on noir hero surfaces.
    onHeroMuted: '#B3AEA4',
    success: '#3D6B4F',
    successBg: '#EAF1EC',
    warning: '#8A5A1C',
    warningBg: '#F7EFDC',
    danger: '#8E3A33',
    dangerBg: '#F6E7E5',
    // Information: Stone Grey deepened for AA text, on an ivory-stone tint (no cool blue-grey, per the brand palette).
    info: '#5C5A55',
    infoBg: '#F1EFEA',
    tabBar: Brand.white,
    tabActive: Brand.noir,
    shadow: '#1A1408',
  },
  dark: {
    background: Brand.noir,
    surface: '#141414',
    surfaceAlt: '#1D1D1C',
    border: '#2B2925',
    text: Brand.ivory,
    textMuted: '#A6A39C',
    primary: Brand.ivory,
    onPrimary: Brand.noir,
    accent: '#D9BE72',
    gold: Brand.gold,
    onGold: Brand.noir,
    champagne: '#262014',
    hero: '#141414',
    heroBorder: '#C9A84C40',
    onHero: Brand.ivory,
    onHeroMuted: '#B3AEA4',
    success: '#8DBF9E',
    successBg: '#16231B',
    warning: '#D9B25E',
    warningBg: '#2A2212',
    danger: '#E29A92',
    dangerBg: '#2E1715',
    // Information in dark mode: light stone on warm charcoal.
    info: '#C4C1BA',
    infoBg: '#1C1B19',
    tabBar: '#0F0F0F',
    tabActive: Brand.gold,
    shadow: '#000000',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof Palette;

/** Topic mastery 1 → 5, in muted tones that sit with the palette. */
export const MasteryColors = ['#A84E44', '#C68B4E', '#C9A84C', '#86A886', '#3D6B4F'] as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Corner radii from the brand system: 12, 16 and 20. */
export const Radius = { sm: 12, md: 16, lg: 20, pill: 999, small: 12, medium: 16, large: 20 } as const;
