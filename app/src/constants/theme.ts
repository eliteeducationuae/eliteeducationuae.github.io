/**
 * Elite Education brand tokens, from the 2026 Brand Guidelines.
 * Colour data lives in ./palette (pure, unit-tested for WCAG AA); this module adds fonts and platform styles.
 * Gold is an accent — never a large background. Georgia for headings, Calibri for body text.
 */

import '@/global.css';

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import type { Palette } from './palette';

export { Brand, Colors, MasteryColors, Radius, Spacing } from './palette';
export type { Palette, ThemeColor } from './palette';

/**
 * Georgia (headings) and Calibri (body). Where they aren't installed we bundle their metric-compatible twins:
 * Gelasio for Georgia (Android) and Carlito for Calibri (everywhere — Calibri can't be shipped in an app).
 */
type Weight = 'regular' | 'bold';
const families = {
  serif: {
    regular: Platform.select({ ios: 'Georgia', web: 'Georgia, Gelasio_400Regular, serif', default: 'Gelasio_400Regular' }),
    bold: Platform.select({ ios: 'Georgia-Bold', web: 'Georgia, Gelasio_700Bold, serif', default: 'Gelasio_700Bold' }),
  },
  sans: {
    regular: Platform.select({ web: 'Calibri, Carlito_400Regular, "Segoe UI", sans-serif', default: 'Carlito_400Regular' }),
    bold: Platform.select({ web: 'Calibri, Carlito_700Bold, "Segoe UI", sans-serif', default: 'Carlito_700Bold' }),
  },
};

export function font(kind: 'serif' | 'sans', weight: Weight = 'regular'): TextStyle {
  // On the web the stack falls back to a regular face, so the weight still needs stating.
  return { fontFamily: families[kind][weight], ...(Platform.OS === 'web' && weight === 'bold' ? { fontWeight: '700' } : null) };
}

export const Fonts = {
  sans: families.sans.regular,
  serif: families.serif.regular,
  mono: Platform.select({ ios: 'ui-monospace', web: 'var(--font-mono)', default: 'monospace' }),
};


/** Soft, low-contrast lift for cards (never applied to the logo). */
export function elevation(palette: Palette, level: 1 | 2 = 1): ViewStyle {
  const y = level === 1 ? 2 : 8;
  const blur = level === 1 ? 10 : 24;
  const opacity = level === 1 ? 0.06 : 0.1;
  return Platform.OS === 'web'
    ? ({ boxShadow: `0 ${y}px ${blur}px rgba(26, 20, 8, ${opacity})` } as ViewStyle)
    : { shadowColor: palette.shadow, shadowOpacity: opacity, shadowRadius: blur / 2, shadowOffset: { width: 0, height: y }, elevation: level * 2 };
}

export const MaxContentWidth = 860;
