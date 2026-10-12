import { useWindowDimensions } from 'react-native';

import { Layout } from '@/constants/theme';

/** True on a desktop-width window (the left rail replaces the bottom tabs and the desktop type scale applies). */
export function useWide(): boolean {
  return useWindowDimensions().width >= Layout.wideMin;
}
