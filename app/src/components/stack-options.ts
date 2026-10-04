import { StyleSheet } from 'react-native';

import { font, type Palette } from '@/constants/theme';

/** Shared header styling for every stack navigator: white surface, hairline rule, Georgia titles. */
export function stackOptions(palette: Palette) {
  return {
    headerStyle: { backgroundColor: palette.surface, borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
    headerTitleStyle: { ...font('serif'), fontSize: 19, color: palette.text },
    headerTintColor: palette.text,
    headerShadowVisible: false,
    headerBackTitle: 'Back',
    headerBackTitleStyle: font('sans'),
    contentStyle: { backgroundColor: palette.background },
  };
}
