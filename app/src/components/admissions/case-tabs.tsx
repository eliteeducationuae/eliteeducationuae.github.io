import { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { font, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { CASE_TAB_LABELS, CASE_TABS, type CaseTab } from './format';

/** What a tab's count means, for screen readers ("Tasks, 2 open"). */
const COUNT_LABELS: Partial<Record<CaseTab, string>> = { dates: 'overdue', tasks: 'open', updates: 'awaiting review' };
const FADE_STEPS = 8;
const FADE_WIDTH = 32;
/** The narrower fade on the left: it covers only the gap and padding before a tab, never its label. */
const LEFT_FADE_WIDTH = 12;

/**
 * The case page's sections as a quiet, horizontally scrolling tab row: tracked labels with a
 * champagne-gold underline on the current tab. Seven tabs do not fit a phone as a segmented control, so the row
 * scrolls the current tab into view (including when a notification opens a later tab) and fades at the edge
 * while more tabs are hidden. It always scrolls to the start of a tab, so the left-hand tab is never cut in half.
 */
export function CaseTabs({ value, onChange, counts }: { value: CaseTab; onChange: (t: CaseTab) => void; counts?: Partial<Record<CaseTab, number>> }) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Partial<Record<CaseTab, { x: number; width: number }>>>({});
  const view = useRef({ width: 0, content: 0, offset: 0 });
  const [moreRight, setMoreRight] = useState(false);
  const [moreLeft, setMoreLeft] = useState(false);
  // Space after the last tab, so the row can scroll far enough to start at a whole tab.
  const [tail, setTail] = useState(0);

  function updateFades() {
    const { width, content, offset } = view.current;
    setMoreRight(content - width - offset > 4);
    setMoreLeft(offset > 4);
  }

  /** The scroll offset that shows `tab` in full with a whole tab at the left edge. */
  function snapFor(tab: CaseTab): number | null {
    const p = positions.current[tab];
    const { width } = view.current;
    if (!p || !width) return null;
    const last = tab === CASE_TABS[CASE_TABS.length - 1];
    const room = width - (last ? Spacing.one : FADE_WIDTH);
    for (const t of CASE_TABS) {
      const q = positions.current[t];
      if (!q) return null;
      const start = Math.max(0, q.x - Spacing.one);
      if (q.x <= p.x && p.x + p.width <= start + room) return start;
    }
    return Math.max(0, p.x - Spacing.one);
  }

  function updateTail() {
    const last = CASE_TABS[CASE_TABS.length - 1];
    const p = positions.current[last];
    const target = snapFor(last);
    if (!p || target === null) return;
    const end = p.x + p.width + Spacing.one;
    setTail(target > 0 ? Math.max(0, Math.ceil(target + view.current.width - end)) : 0);
  }

  function reveal(tab: CaseTab, animated: boolean) {
    const p = positions.current[tab];
    const { width, offset } = view.current;
    if (!p || !width) return;
    const last = tab === CASE_TABS[CASE_TABS.length - 1];
    // A tab cut at the left edge (say after the tail arrived, or a free scroll) is snapped too.
    const aligned = offset < 1 || CASE_TABS.some((t) => Math.abs((positions.current[t]?.x ?? -99) - Spacing.one - offset) < 2);
    if (aligned && p.x >= offset && p.x + p.width <= offset + width - (last ? 0 : FADE_WIDTH)) return;
    const x = snapFor(tab);
    if (x !== null) scrollRef.current?.scrollTo({ x, animated });
  }

  useEffect(() => {
    // reveal reads only refs; re-run when the active tab changes.
    reveal(value, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    // The row can only scroll to the snapped place once the tail is laid out.
    if (tail) reveal(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail]);

  function onTabLayout(t: CaseTab, e: LayoutChangeEvent) {
    positions.current[t] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
    updateTail();
    reveal(value, false);
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
          updateTail();
          updateFades();
          reveal(value, false);
        }}
        onContentSizeChange={(w) => {
          view.current.content = w;
          updateFades();
          reveal(value, false);
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
        {tail ? <View style={{ width: tail }} /> : null}
      </ScrollView>
      {moreLeft ? <EdgeFade side="left" color={theme.background} /> : null}
      {moreRight ? <EdgeFade side="right" color={theme.background} /> : null}
    </View>
  );
}

/** A soft fade in the page colour, built from stacked strips so it needs no gradient library. */
function EdgeFade({ side, color }: { side: 'left' | 'right'; color: string }) {
  const width = side === 'left' ? LEFT_FADE_WIDTH : FADE_WIDTH;
  const strip = width / FADE_STEPS;
  return (
    <View pointerEvents="none" style={[styles.fade, { width }, side === 'right' ? { right: 0 } : { left: 0, flexDirection: 'row-reverse' }]}>
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
  fade: { position: 'absolute', top: 0, bottom: 1, flexDirection: 'row' },
});
