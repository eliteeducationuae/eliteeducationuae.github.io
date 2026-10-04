import { brandTutorColor, LEGACY_TUTOR_COLORS, TUTOR_COLORS, tutorColorFor } from '../tutor-colors';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('TUTOR_COLORS', () => {
  it('has eight valid, distinct colours', () => {
    expect(TUTOR_COLORS).toHaveLength(8);
    for (const c of TUTOR_COLORS) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(TUTOR_COLORS.map((c) => c.toUpperCase())).size).toBe(TUTOR_COLORS.length);
  });

  it.each(TUTOR_COLORS)('%s carries white and ivory text at WCAG AA', (c) => {
    expect(contrast(c, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c, '#F9F8F5')).toBeGreaterThanOrEqual(4.5);
  });

  it('avoids saturated colours', () => {
    for (const c of TUTOR_COLORS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      expect(s).toBeLessThanOrEqual(0.65);
    }
  });

  it('picks a palette colour for a new tutor', () => {
    expect(TUTOR_COLORS).toContain(tutorColorFor('Sarah Khan'));
  });
});

describe('brandTutorColor', () => {
  it('passes palette colours through, whatever their case', () => {
    for (const c of TUTOR_COLORS) {
      expect(brandTutorColor(c)).toBe(c);
      expect(brandTutorColor(c.toLowerCase())).toBe(c);
    }
  });

  it('maps every legacy colour to the palette colour at the same position', () => {
    expect(LEGACY_TUTOR_COLORS).toHaveLength(TUTOR_COLORS.length);
    LEGACY_TUTOR_COLORS.forEach((c, i) => {
      expect(brandTutorColor(c)).toBe(TUTOR_COLORS[i]);
      expect(brandTutorColor(c.toUpperCase())).toBe(TUTOR_COLORS[i]);
    });
    // The old column default.
    expect(brandTutorColor('#2b6cb0')).toBe('#3F4A56');
  });

  it('gives unknown or missing colours a stable palette colour', () => {
    const odd = brandTutorColor('#ff00ff');
    expect(TUTOR_COLORS).toContain(odd);
    expect(brandTutorColor('#ff00ff')).toBe(odd);
    expect(TUTOR_COLORS).toContain(brandTutorColor(null, 'tutor-1'));
    expect(brandTutorColor(undefined, 'tutor-1')).toBe(brandTutorColor(null, 'tutor-1'));
    expect(TUTOR_COLORS).toContain(brandTutorColor(''));
  });
});
