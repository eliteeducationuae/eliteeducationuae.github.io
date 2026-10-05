import { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { CASE_TAB_LABELS, CASE_TABS, type CaseTab } from './format';

/** What a tab's count means, for screen readers ("Tasks, 2 open"). */
const COUNT_LABELS: Partial<Record<CaseTab, string>> = { dates: 'overdue', tasks: 'open', updates: 'awaiting review' };
const FADE_STEPS = 8;
const FADE_WIDTH = 32;

/**
 * The case page's sections as a quiet, horizontally scrolling tab row: tracked labels with a
 * champagne-gold underline on the current tab. Seven tabs do not fit a phone as a segmented control, so the row
 * scrolls the current tab into view (including when a notification opens a later tab) and fades at the edge
 * while more tabs are hidden.
 */
export function CaseTabs({ value, onChange, counts }: { value: CaseTab; onChange: (t: CaseTab) => void; counts?: Partial<Record<CaseTab, number>> }) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Partial<Record<CaseTab, { x: number; width: number }>>>({});
  const view = useRef({ width: 0, content: 0, offset: 0 });
  const [moreRight, setMoreRight] = useState(false);
  const [moreLeft, setMoreLeft] = useState(false);

  function updateFades() {
    const { width, content, offset } = view.current;
    setMoreRight(content - width - offset > 4);
    setMoreLeft(offset > 4);
  }

  function reveal(tab: CaseTab, animated: boolean) {
    const p = positions.current[tab];
    const { width, offset } = view.current;
    if (!p || !width) return;
    if (p.x < offset + FADE_WIDTH || p.x + p.width > offset + width - FADE_WIDTH) {
      scrollRef.current?.scrollTo({ x: Math.max(0, p.x - FADE_WIDTH), animated });
    }
  }

  useEffect(() => {
    // reveal reads only refs; re-run when the active tab changes.
    reveal(value, true);
  }, [value]);

  function onTabLayout(t: CaseTab, e: LayoutChangeEvent) {
    positions.current[t] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
    if (t === value) reveal(t, false);
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    view.current.offset = e.nativeEvent.contentOffset.x;
    updateFades();
  }

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.border }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
        scrollEventThrottle={32}
        onScroll={onScroll}
        onLayout={(e) => {
          view.current.width = e.nativeEvent.layout.width;
          updateFades();
          reveal(value, false);
        }}
        onContentSizeChange={(w) => {
          view.current.content = w;
          updateFades();
        }}>
        {CASE_TABS.map((t) => {
          const active = t === value;
          const n = counts?.[t];
          return (
            <Pressable
              key={t}
              onPress={() => onChange(t)}
              onLayout={(e) => onTabLayout(t, e)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-selected={active}
              accessibilityLabel={n ? `${CASE_TAB_LABELS[t]}, ${n} ${COUNT_LABELS[t] ?? ''}`.trim() : CASE_TAB_LABELS[t]}
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
      {moreLeft ? <EdgeFade side="left" color={theme.background} /> : null}
      {moreRight ? <EdgeFade side="right" color={theme.background} /> : null}
    </View>
  );
}

/** A soft fade in the page colour, built from stacked strips so it needs no gradient library. */
function EdgeFade({ side, color }: { side: 'left' | 'right'; color: string }) {
  const strip = FADE_WIDTH / FADE_STEPS;
  return (
    <View pointerEvents="none" style={[styles.fade, side === 'right' ? { right: 0 } : { left: 0, flexDirection: 'row-reverse' }]}>
      {Array.from({ length: FADE_STEPS }, (_, i) => (
        <View key={i} style={{ width: strip, backgroundColor: color, opacity: (i + 1) / FADE_STEPS }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.one },
  row: { gap: Spacing.one, paddingHorizontal: Spacing.one },
  tab: { paddingHorizontal: Spacing.two + 2, paddingTop: Spacing.two + 2, alignItems: 'center' },
  label: { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  marker: { height: 2, alignSelf: 'stretch', marginTop: Spacing.two, borderRadius: 1 },
  fade: { position: 'absolute', top: 0, bottom: 1, width: FADE_WIDTH, flexDirection: 'row' },
});
