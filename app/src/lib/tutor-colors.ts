/**
 * Tutor calendar colours: deep, desaturated tones that sit with Noir Black and Champagne Gold.
 * White text reads on every one of them at WCAG AA (4.5:1 or better); see __tests__/tutor-colors.test.ts.
 */
export const TUTOR_COLORS = [
  '#3F4A56', // slate
  '#7A5C1E', // bronze
  '#3D6B4F', // forest
  '#5E4660', // plum
  '#8A4B3C', // terracotta
  '#2F5D62', // teal
  '#4A4A4A', // graphite
  '#2C3440', // noir blue
] as const;

/** A stable colour for a new tutor, chosen from their name. */
export function tutorColorFor(name: string): string {
  return TUTOR_COLORS[name.length % TUTOR_COLORS.length];
}

/**
 * The bright colours the tutor picker offered before the 2026 rebrand (and the old column default, #2b6cb0).
 * Live tutors may still carry one of these, so they are mapped onto the brand palette when read.
 */
export const LEGACY_TUTOR_COLORS: readonly string[] = ['2b6cb0', 'c05621', '2f855a', '6b46c1', 'b83280', '2c7a7b', '975a16', '1a365d'].map(
  (h) => `#${h}`,
);

/**
 * A tutor's colour as the app should draw it: palette colours pass through, legacy colours map by position
 * and anything else (a hand-entered value, or nothing) falls back to a stable palette colour.
 */
export function brandTutorColor(color: string | null | undefined, seed = ''): string {
  const c = (color ?? '').trim().toUpperCase();
  const own = TUTOR_COLORS.find((t) => t === c);
  if (own) return own;
  const legacy = LEGACY_TUTOR_COLORS.findIndex((l) => l.toUpperCase() === c);
  if (legacy >= 0) return TUTOR_COLORS[legacy];
  const key = c || seed;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TUTOR_COLORS[h % TUTOR_COLORS.length];
}
