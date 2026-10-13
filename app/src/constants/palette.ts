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
    successBg: '#EAF1EA',
    warning: '#8A5A1C',
    warningBg: '#FBF1E4',
    danger: '#8E3A33',
    dangerBg: '#F8E9E6',
    // Information: Stone Grey deepened for AA text, on an ivory-stone tint (no cool blue-grey, per the brand palette).
    info: '#5C5A55',
    infoBg: '#F1EFEA',
    tabBar: Brand.white,
    tabActive: Brand.noir,
    shadow: '#1A1408',
    // ---- 2026 redesign tokens (see the design handoff README) ----
    // Sand: the home hero, the desktop rail, icon circles, date chips and the info notice.
    sand: '#F3EDE1',
    // Hairline around white cards and figures; row dividers inside a group; the row hover wash.
    hairline: '#E9E2D3',
    rowDivider: '#F0EADF',
    rowHover: '#FBF8F2',
    // Text inputs: a barely-warm fill, and the border shown with an error message.
    inputFill: '#FDFCFA',
    // Field borders reach 3:1 against the fill (WCAG 1.4.11): warm grey, and a deep red with an error.
    inputBorder: '#8F8A80',
    errorBorder: '#8E3A33',
    // Toggle track: green when on, a warm grey (3:1 against white, so the off state is still visible) when off.
    toggleOn: '#3D6B4F',
    toggleOff: '#8F8A80',
    // Warm body text: hero lines, notice and expanded-row bodies, prose paragraphs.
    textWarm: '#4A463F',
    textBody: '#3F3B35',
    textProse: '#2E2B26',
    // Row chevrons, inactive tab labels and message timestamps. Icons are font glyphs on the web, so the chevron is
    // held to text contrast (4.5:1) too: a little deeper than the prototypes' #8A857B.
    chevron: '#726D64',
    navInactive: '#6B6B6B',
    timestamp: '#6E6A62',
    // Phone tab bar: translucent paper with a hairline; desktop rail: sand with a gold-tinted active row.
    tabBarPaper: 'rgba(249,248,245,0.96)',
    rail: '#F3EDE1',
    railActive: 'rgba(201,168,76,0.16)',
    railHover: 'rgba(201,168,76,0.12)',
    // Solid danger button: ivory text on a deep red.
    dangerSolid: '#8E3A33',
    onDangerSolid: Brand.ivory,
    // Message composer send button with nothing to send.
    sendDisabled: '#CFC8B8',
    // Primary button pressed or hovered.
    primaryHover: '#262421',
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
    sand: '#1A1814',
    hairline: '#2B2925',
    rowDivider: '#22201C',
    rowHover: '#1B1A18',
    inputFill: '#101010',
    inputBorder: '#6B665E',
    errorBorder: '#C0665C',
    toggleOn: '#4E8462',
    toggleOff: '#77726A',
    textWarm: '#D6D1C7',
    textBody: '#CFCAC0',
    textProse: '#E4E0D8',
    chevron: '#8A857B',
    navInactive: '#A6A39C',
    timestamp: '#A6A39C',
    tabBarPaper: 'rgba(15,15,15,0.96)',
    rail: '#1A1814',
    railActive: 'rgba(201,168,76,0.16)',
    railHover: 'rgba(201,168,76,0.10)',
    dangerSolid: '#A8473F',
    onDangerSolid: Brand.ivory,
    sendDisabled: '#3A372F',
    primaryHover: '#E9E4D8',
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

/**
 * Corner radii. The original brand set (12, 16, 20) plus the 2026 redesign's: cards and groups 18, the home hero
 * 26 on desktop and 28 (bottom corners only) on phones, inputs and date chips 12, the toast 14.
 */
export const Radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
  small: 12,
  medium: 16,
  large: 20,
  card: 18,
  hero: 26,
  heroPhone: 28,
  input: 12,
  toast: 14,
  chip: 12,
} as const;

/**
 * Initials avatars cycle through these (white initials pass AA on every one). Pick one with avatarColor(name).
 */
export const AvatarColors = ['#7E621F', '#2F5F7A', '#3D6B4F', '#6E5A8A', '#8A5A1C'] as const;

/** A stable avatar colour for a name. */
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AvatarColors[h % AvatarColors.length];
}

/**
 * Page layout from the redesign. Phones: 18 side padding, 20 between blocks. Desktop (window at least wideMin):
 * 40 / 44 padding, 26 between blocks, content at most 1080 wide; "half" blocks sit two-up from 400 wide.
 */
export const Layout = {
  wideMin: 1024,
  phonePadX: 18,
  phonePadTop: 8,
  phonePadBottom: 40,
  phoneGap: 20,
  desktopPadTop: 40,
  desktopPadX: 44,
  desktopPadBottom: 64,
  desktopGap: 26,
  maxWidth: 1080,
  halfBasis: 400,
  halfGap: 22,
  tabBarHeight: 84,
  railWidth: 248,
  railWidthNoir: 232,
} as const;
