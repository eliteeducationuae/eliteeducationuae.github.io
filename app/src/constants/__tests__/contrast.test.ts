import { Brand, Colors, type Palette } from '../palette';

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL saturation (0–1), used to keep the palette desaturated. */
function saturation(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

const PAIRS: [keyof Palette, keyof Palette][] = [
  ['text', 'surface'],
  ['text', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'background'],
  ['onPrimary', 'primary'],
  ['onHero', 'hero'],
  ['onHeroMuted', 'hero'],
  ['accent', 'surface'],
  ['success', 'successBg'],
  ['warning', 'warningBg'],
  ['danger', 'dangerBg'],
  ['info', 'infoBg'],
  ['onGold', 'gold'],
];

describe('brand palette contrast (WCAG AA, 4.5:1)', () => {
  it('computes known ratios', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  for (const scheme of ['light', 'dark'] as const) {
    const p: Palette = Colors[scheme];
    describe(scheme, () => {
      it.each(PAIRS)('%s on %s', (fg, bg) => {
        expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
      });

      it('accent and muted text also pass on the alternate surface and champagne wash', () => {
        for (const fg of ['text', 'textMuted', 'accent'] as const) {
          for (const bg of ['surfaceAlt', 'champagne'] as const) {
            expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('never uses Champagne Gold as a text colour token', () => {
        const textTokens: (keyof Palette)[] = ['text', 'textMuted', 'onPrimary', 'onHero', 'onGold', 'accent'];
        for (const t of textTokens) expect(p[t].toUpperCase()).not.toBe(Brand.gold);
        expect(p.onGold).toBe(Brand.noir);
      });

      it('keeps status colours desaturated', () => {
        for (const key of ['success', 'warning', 'danger', 'info', 'accent'] as const) {
          expect(saturation(p[key])).toBeLessThanOrEqual(0.7);
        }
      });
    });
  }
});
