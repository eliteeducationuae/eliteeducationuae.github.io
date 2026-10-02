/**
 * Elite Education brand tokens — navy and gold, matching eliteeducationuae.github.io.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    background: '#f4f6fb',
    surface: '#ffffff',
    surfaceAlt: '#eef2f8',
    border: '#e2e8f0',
    text: '#1a202c',
    textMuted: '#64748b',
    primary: '#1a365d',
    onPrimary: '#ffffff',
    accent: '#2b6cb0',
    gold: '#d69e2e',
    onGold: '#1a365d',
    success: '#2f855a',
    successBg: '#e6f4ea',
    warning: '#b7791f',
    warningBg: '#fdf3e1',
    danger: '#c53030',
    dangerBg: '#fde8e8',
    info: '#2b6cb0',
    infoBg: '#ebf4ff',
    tabBar: '#ffffff',
    tabActive: '#1a365d',
  },
  dark: {
    background: '#0b1220',
    surface: '#131c2e',
    surfaceAlt: '#1b263b',
    border: '#26324a',
    text: '#e7edf7',
    textMuted: '#94a3b8',
    primary: '#3b82c4',
    onPrimary: '#ffffff',
    accent: '#63b3ed',
    gold: '#ecc94b',
    onGold: '#1a365d',
    success: '#68d391',
    successBg: '#163323',
    warning: '#f6c35b',
    warningBg: '#3a2c10',
    danger: '#fc8181',
    dangerBg: '#3b1717',
    info: '#90cdf4',
    infoBg: '#14263f',
    tabBar: '#0f1729',
    tabActive: '#63b3ed',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof Palette;

/** Topic mastery 1 (red) → 5 (green). */
export const MasteryColors = ['#e53e3e', '#ed8936', '#ecc94b', '#68b36b', '#2f855a'] as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  web: { sans: 'var(--font-display)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const MaxContentWidth = 860;
