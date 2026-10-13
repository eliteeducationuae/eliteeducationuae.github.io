import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font, Radius, tabular } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Txt } from '../ui';

/**
 * Small building blocks shared by the admin operations pages (enquiries, admissions, settings, services,
 * closures, lessons). Composed from the design system; nothing here changes data.
 */

/** Hides the native stack header: the page draws its own PageHeader. */
export function NoHeader() {
  return <Stack.Screen options={{ headerShown: false }} />;
}

/** A coloured dot and an uppercase stage label, e.g. "• NEW". */
export function StageLabel({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.stage} accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[font('sans', 'bold'), styles.stageText, { color }]}>{label}</Text>
    </View>
  );
}

export interface SummaryLine {
  k: string;
  v: string;
}

/**
 * The side card on a form ("When the case opens", "The offer", "Preview"): a kicker, a Georgia title, key/value
 * lines, an optional total and a closing note. Children go at the bottom (e.g. the submit button).
 */
export function SummaryCard({
  kicker,
  title,
  lines,
  total,
  note,
  children,
}: {
  kicker?: string;
  title?: string;
  lines?: SummaryLine[];
  total?: SummaryLine;
  note?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      {kicker ? <Txt variant="kicker">{kicker}</Txt> : null}
      {title ? (
        <Txt variant="groupTitle" accessibilityRole="header">
          {title}
        </Txt>
      ) : null}
      {lines?.length ? (
        <View>
          {lines.map((l, i) => (
            <View key={`${l.k}-${i}`} style={[styles.line, i > 0 && { borderTopWidth: 1, borderTopColor: theme.rowDivider }]}>
              <Txt variant="note" style={{ flex: 1 }}>
                {l.k}
              </Txt>
              <Text style={[font('sans', 'bold'), tabular, styles.lineValue, { color: theme.text }]}>{l.v}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {total ? (
        <View style={[styles.line, { borderTopWidth: 1, borderTopColor: theme.text }]}>
          <Txt style={{ flex: 1, fontWeight: '700' }}>{total.k}</Txt>
          <Txt variant="figure" style={{ fontSize: 22, lineHeight: 26 }}>
            {total.v}
          </Txt>
        </View>
      ) : null}
      {note ? typeof note === 'string' ? <Txt variant="note">{note}</Txt> : note : null}
      {children}
    </View>
  );
}

/** A numbered step heading inside a long form, e.g. "1  Student". */
export function StepLabel({ n, title }: { n: number; title: string }) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNum, { backgroundColor: theme.sand }]}>
        <Text style={[font('sans', 'bold'), { fontSize: 12, color: theme.accent }]}>{n}</Text>
      </View>
      <Txt variant="label" accessibilityRole="header">
        {title}
      </Txt>
    </View>
  );
}

/**
 * A row of steps with a gold bar up to the current one (the enquiry stage). Each step is a 44px button.
 * `current` is the index of the reached step, or -1 when none is (e.g. lost).
 */
export function Stepper({
  steps,
  current,
  onPick,
  disabled,
  accessibilityLabel,
}: {
  steps: string[];
  current: number;
  onPick?: (index: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepper} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {steps.map((s, i) => {
        const reached = current >= 0 && i <= current;
        const here = i === current;
        return (
          <Pressable
            key={s}
            onPress={onPick && !disabled ? () => onPick(i) : undefined}
            disabled={!onPick || disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: here, disabled: !onPick || disabled }}
            aria-checked={here}
            accessibilityLabel={s}
            style={({ pressed }) => [styles.stepItem, pressed && { opacity: 0.7 }]}>
            <View style={[styles.stepBar, { backgroundColor: reached ? theme.gold : theme.border }]} />
            <Text
              numberOfLines={2}
              style={[font('sans', here ? 'bold' : 'regular'), { fontSize: 13.5, lineHeight: 18, color: here ? theme.text : theme.textMuted }]}>
              {s}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Key and value lines in a white card (the facts on the enquiry and lesson pages): grey key, bold value. */
export function Facts({ rows }: { rows: { k: string; v?: string | null; tone?: 'warn' | 'good' | 'muted' }[] }) {
  const theme = useTheme();
  return (
    <View style={[styles.facts, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      {rows.map((r, i) => (
        <View
          key={r.k}
          style={[styles.fact, i > 0 && { borderTopWidth: 1, borderTopColor: theme.rowDivider }]}
          accessible
          accessibilityLabel={`${r.k}: ${r.v || 'not given'}`}>
          <Txt variant="note" style={{ fontSize: 14.5 }}>
            {r.k}
          </Txt>
          <Text
            style={[
              font('sans', 'bold'),
              styles.factValue,
              { color: !r.v || r.tone === 'muted' ? theme.textMuted : r.tone === 'warn' ? theme.warning : r.tone === 'good' ? theme.success : theme.text },
            ]}>
            {r.v || '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A quoted message in Georgia italic, as on the enquiry page. */
export function Quote({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={[font('serif'), styles.quote, { color: theme.text }]} accessibilityLabel={`Message: ${children}`}>
      “{children}”
    </Text>
  );
}

const styles = StyleSheet.create({
  stage: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  stageText: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  card: { borderWidth: 1, borderRadius: Radius.card, padding: 20, gap: 14 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  lineValue: { fontSize: 14.5, textAlign: 'right', flexShrink: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', gap: 6 },
  stepItem: { flex: 1, minHeight: 44, gap: 8, paddingTop: 2 },
  stepBar: { height: 3, borderRadius: 2 },
  facts: { borderWidth: 1, borderRadius: Radius.card, overflow: 'hidden' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 13, paddingHorizontal: 18, minHeight: 48 },
  factValue: { flex: 1, textAlign: 'right', fontSize: 15, lineHeight: 21 },
  quote: { fontSize: 21, lineHeight: 30, fontStyle: 'italic' },
});
