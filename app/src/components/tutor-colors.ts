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
