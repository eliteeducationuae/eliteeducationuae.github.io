import { Image, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

/** The brand guidelines never allow the logo narrower than this (in points/pixels). */
export const LOGO_MIN_WIDTH = 100;

const LOGO_WHITE = require('../../assets/images/logo-white.png');
const LOGO_BLACK = require('../../assets/images/logo-black.png');
const LOGO_WHITE_WIDE = require('../../assets/images/logo-white-wide.png');
const LOGO_BLACK_WIDE = require('../../assets/images/logo-black-wide.png');

/**
 * The approved Elite Education logo. Black on light surfaces, white on dark ones.
 * Never tinted, shadowed or distorted; always given clear space and at least 100 wide.
 * Use tone="white" on noir hero surfaces in both schemes.
 */
export function Logo({
  tone = 'auto',
  width = 120,
  style,
  accessibilityLabel = 'Elite Education',
  wide = false,
}: {
  tone?: 'auto' | 'black' | 'white';
  width?: number;
  /** The wide lock-up (mark above the wordmark, 8:3) used in the rail and on invoices. No padding is added. */
  wide?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const scheme = useColorScheme();
  const resolved = tone === 'auto' ? (scheme === 'dark' ? 'white' : 'black') : tone;
  const size = Math.max(LOGO_MIN_WIDTH, width);
  if (wide) {
    return (
      <View style={style}>
        <Image
          source={resolved === 'white' ? LOGO_WHITE_WIDE : LOGO_BLACK_WIDE}
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          resizeMode="contain"
          style={{ width: size, height: (size * 3) / 8 }}
        />
      </View>
    );
  }
  return (
    <View style={[{ padding: Math.round(size * 0.1), alignSelf: 'center' }, style]}>
      <Image
        source={resolved === 'white' ? LOGO_WHITE : LOGO_BLACK}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        resizeMode="contain"
        style={{ width: size, height: size, aspectRatio: 1 }}
      />
    </View>
  );
}
