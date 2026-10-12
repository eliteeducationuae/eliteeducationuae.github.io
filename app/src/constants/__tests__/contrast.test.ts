import { AvatarColors, Brand, Colors, MasteryColors, type Palette } from '../palette';

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

// 2026 redesign: every text colour on the surfaces it is used on (WCAG AA, 4.5:1).
const REDESIGN_TEXT: [keyof Palette, keyof Palette][] = [
  // Hero (sand): greeting, kicker, warm line, grey sub-lines; the info notice is gold-brown on sand.
  ['text', 'sand'],
  ['accent', 'sand'],
  ['textWarm', 'sand'],
  ['textMuted', 'sand'],
  ['textBody', 'sand'],
  // Cards: warm body text, prose, field errors, values.
  ['textWarm', 'surface'],
  ['textBody', 'surface'],
  ['textProse', 'surface'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['warning', 'surface'],
  // Notice bodies on their tints.
  ['textBody', 'warningBg'],
  ['textBody', 'successBg'],
  ['textBody', 'dangerBg'],
  // A hovered row.
  ['text', 'rowHover'],
  ['textMuted', 'rowHover'],
  ['accent', 'rowHover'],
  // Inputs: typed text and placeholders.
  ['text', 'inputFill'],
  ['textMuted', 'inputFill'],
  // Tab bar labels and message timestamps on the page.
  ['navInactive', 'background'],
  ['tabActive', 'background'],
  ['timestamp', 'background'],
  // The rail.
  ['text', 'rail'],
  ['textMuted', 'rail'],
  // The solid danger button.
  ['onDangerSolid', 'dangerSolid'],
  // Chevrons and other icons are font glyphs on the web, so they meet text contrast too.
  ['chevron', 'surface'],
  ['chevron', 'rowHover'],
  ['chevron', 'background'],
];

// Non-text parts that carry meaning (WCAG 1.4.11, 3:1): chevrons, the toggle track in both states.
const REDESIGN_UI: [keyof Palette, keyof Palette][] = [
  ['chevron', 'surface'],
  ['chevron', 'rowHover'],
  ['toggleOff', 'surface'],
  ['toggleOn', 'surface'],
];

describe('redesign tokens', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const p: Palette = Colors[scheme];
    describe(scheme, () => {
      it.each(REDESIGN_TEXT)('%s on %s reaches 4.5:1', (fg, bg) => {
        expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
      });
      it.each(REDESIGN_UI)('%s against %s reaches 3:1', (fg, bg) => {
        expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
      });
      it('keeps the white toggle knob visible on the "on" track', () => {
        expect(contrast('#FFFFFF', p.toggleOn)).toBeGreaterThanOrEqual(3);
      });
      it('defines every light token in dark mode too', () => {
        expect(Object.keys(Colors.dark).sort()).toEqual(Object.keys(Colors.light).sort());
      });
    });
  }

  it.each(AvatarColors)('white initials read on avatar colour %s', (c) => {
    expect(contrast('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5);
  });

  it('matches the handoff values in light mode', () => {
    const l = Colors.light;
    expect([l.sand, l.hairline, l.rowDivider, l.rowHover, l.inputFill, l.errorBorder, l.toggleOn]).toEqual([
      '#F3EDE1',
      '#E9E2D3',
      '#F0EADF',
      '#FBF8F2',
      '#FDFCFA',
      '#C99A93',
      '#3D6B4F',
    ]);
    expect([l.successBg, l.warningBg, l.dangerBg]).toEqual(['#EAF1EA', '#FBF1E4', '#F8E9E6']);
    expect([l.textWarm, l.textBody, l.textProse]).toEqual(['#4A463F', '#3F3B35', '#2E2B26']);
  });
});

describe('mastery colours', () => {
  // The rating pills pick ivory (onHero) or the hero tone, whichever reads better; one of them must reach AA.
  for (const scheme of ['light', 'dark'] as const) {
    const p: Palette = Colors[scheme];
    it.each(MasteryColors)(`%s carries readable text in ${scheme} mode`, (c) => {
      expect(Math.max(contrast(c, p.onHero), contrast(c, p.hero))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('stay desaturated', () => {
    for (const c of MasteryColors) expect(saturation(c)).toBeLessThanOrEqual(0.7);
  });
});
