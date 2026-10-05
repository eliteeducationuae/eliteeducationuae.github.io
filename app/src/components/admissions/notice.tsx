import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from '../icon';
import { Txt } from '../ui';

/** A quiet information note in the brand's ivory and stone, with a champagne-gold rule. */
export function Notice({ children, icon = 'sparkle' }: { children: ReactNode; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.surfaceAlt, borderLeftColor: theme.gold }]}>
      <Icon name={icon} size={18} color={theme.accent} />
      <Txt variant="muted" style={{ flex: 1, color: theme.text }}>
        {children}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, borderLeftWidth: 3, alignItems: 'flex-start' },
});
