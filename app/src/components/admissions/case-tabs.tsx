import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { CASE_TAB_LABELS, CASE_TABS, type CaseTab } from './format';

/**
 * The case page's sections as a quiet, horizontally scrolling tab row: tracked labels with a
 * champagne-gold underline on the current tab. Seven tabs do not fit a phone as a segmented control.
 */
export function CaseTabs({ value, onChange, counts }: { value: CaseTab; onChange: (t: CaseTab) => void; counts?: Partial<Record<CaseTab, number>> }) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, { borderBottomColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist">
        {CASE_TABS.map((t) => {
          const active = t === value;
          const n = counts?.[t];
          return (
            <Pressable
              key={t}
              onPress={() => onChange(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-selected={active}
              accessibilityLabel={CASE_TAB_LABELS[t]}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}>
              <Text
                style={[
                  font('sans', 'bold'),
                  styles.label,
                  { color: active ? theme.text : theme.textMuted },
                ]}>
                {CASE_TAB_LABELS[t]}
                {n ? <Text style={{ color: theme.accent }}>{`  ${n}`}</Text> : null}
              </Text>
              <View style={[styles.marker, { backgroundColor: active ? theme.gold : 'transparent' }]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.one },
  row: { gap: Spacing.one, paddingHorizontal: Spacing.one },
  tab: { paddingHorizontal: Spacing.two + 2, paddingTop: Spacing.two + 2, alignItems: 'center' },
  label: { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  marker: { height: 2, alignSelf: 'stretch', marginTop: Spacing.two, borderRadius: 1 },
});
