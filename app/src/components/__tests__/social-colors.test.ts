import { Colors } from '@/constants/palette';

import { socialButtonColors, type SocialScheme } from '../social-colors';

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SCHEMES: SocialScheme[] = ['light', 'dark'];

describe('socialButtonColors', () => {
  it.each(SCHEMES)('gives readable text on every button in the %s scheme (WCAG AA, 4.5:1)', (scheme) => {
    const { apple, google } = socialButtonColors(scheme);
    expect(contrast(apple.fg, apple.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(google.fg, google.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)('outlines the Google button clearly against the %s page (3:1)', (scheme) => {
    const { google } = socialButtonColors(scheme);
    expect(google.border).toBeDefined();
    expect(contrast(google.border!, Colors[scheme].background)).toBeGreaterThanOrEqual(3);
  });

  it.each(SCHEMES)('keeps the Apple button visible against the %s page (3:1)', (scheme) => {
    const { apple } = socialButtonColors(scheme);
    expect(contrast(apple.bg, Colors[scheme].background)).toBeGreaterThanOrEqual(3);
  });

  it('follows Apple: black on light backgrounds, white on dark', () => {
    expect(socialButtonColors('light').apple).toEqual({ bg: '#000000', fg: '#FFFFFF' });
    expect(socialButtonColors('dark').apple).toEqual({ bg: '#FFFFFF', fg: '#000000' });
  });
});
