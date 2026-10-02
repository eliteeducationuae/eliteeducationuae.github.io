import type { Palette } from '@/constants/theme';

/** Shared header styling for every stack navigator. */
export function stackOptions(palette: Palette) {
  return {
    headerStyle: { backgroundColor: palette.surface },
    headerTintColor: palette.text,
    headerShadowVisible: false,
    headerBackTitle: 'Back',
    contentStyle: { backgroundColor: palette.background },
  };
}
