/**
 * Small building blocks shared by the admin People and Team screens (students, families, tutors, checks, hiring,
 * reports, handover, messages, pay, library, roles, handbook, activity, health). They only compose the design system
 * in `@/components/ui`; nothing here is used by the tutor, parent or accountant screens.
 */
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ChipField, Field, Group, Txt, useWide } from '@/components/ui';
import { font } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Hides the native stack header: the screen draws its own PageHeader (with a Back pill) instead. */
export function NoHeader({ title }: { title?: string }) {
  return <Stack.Screen options={{ headerShown: false, ...(title ? { title } : null) }} />;
}

/** The list search box: a labelled text field with a search glyph, as in the prototypes. */
export function SearchField({ value, onChangeText, placeholder, label = 'Search' }: { value: string; onChangeText: (v: string) => void; placeholder: string; label?: string }) {
  return <Field label={label} placeholder={placeholder} value={value} onChangeText={onChangeText} autoCorrect={false} autoCapitalize="none" />;
}

/** A row of filter chips without a label (single choice). */
export function FilterChips<T extends string>({ options, value, onChange }: { options: (T | { value: T; label: string })[]; value: T; onChange: (v: T) => void }) {
  return <ChipField options={options} value={value} onChange={onChange} />;
}

export type TagTone = 'good' | 'warn' | 'bad' | 'accent' | 'muted' | 'text';

/** A status word in small capitals with a coloured dot ("● CHECK ON"), for the right of a list row. */
export function Tag({ label, tone = 'muted' }: { label: string; tone?: TagTone }) {
  const theme = useTheme();
  const color = { good: theme.success, warn: theme.warning, bad: theme.danger, accent: theme.accent, muted: theme.textMuted, text: theme.text }[tone];
  return (
    <View style={styles.tag}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[font('sans', 'bold'), styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

/** A right-hand column for a list row: a status tag over a grey meta line. */
export function RowMeta({ tag, tone, meta }: { tag?: string; tone?: TagTone; meta?: string }) {
  const wide = useWide();
  if (!tag && !meta) return null;
  return (
    <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: wide ? 170 : 116 }}>
      {tag ? <Tag label={tag} tone={tone} /> : null}
      {meta ? (
        <Txt variant="small" style={{ textAlign: 'right' }}>
          {meta}
        </Txt>
      ) : null}
    </View>
  );
}

/** One line of a summary card: a grey label and a bold value. */
export type SummaryLine = { k: string; v: string };

/**
 * The side summary beside a form (below it on a phone): a kicker, an optional Georgia title, label/value lines,
 * an optional total and a note. It only restates what the form will do.
 */
export function SummaryCard({ kicker, title, lines, total, totalLabel, note }: { kicker: string; title?: string; lines: SummaryLine[]; total?: string; totalLabel?: string; note?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.summary, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      <Txt variant="label">{kicker}</Txt>
      {title ? <Txt variant="groupTitle">{title}</Txt> : null}
      <View>
        {lines.map((l, i) => (
          <View key={`${l.k}-${i}`} style={[styles.line, { borderTopColor: theme.rowDivider, borderTopWidth: i ? 1 : 0 }]}>
            <Txt variant="muted" style={{ flexShrink: 1 }}>
              {l.k}
            </Txt>
            <Text style={[font('sans', 'bold'), styles.lineValue, { color: theme.text }]}>{l.v}</Text>
          </View>
        ))}
      </View>
      {total ? (
        <View style={[styles.total, { borderTopColor: theme.hairline }]}>
          <Txt variant="label">{totalLabel ?? 'Total'}</Txt>
          <Txt variant="figure">{total}</Txt>
        </View>
      ) : null}
      {note ? <Txt variant="note">{note}</Txt> : null}
    </View>
  );
}

/** A form beside its summary on desktop (form wider), stacked on a phone with the summary after the form. */
export function FormWithSummary({ children, summary }: { children: ReactNode; summary?: ReactNode }) {
  const wide = useWide();
  if (!summary) return <View style={{ gap: wide ? 26 : 20 }}>{children}</View>;
  return (
    <View style={wide ? { flexDirection: 'row', gap: 32, alignItems: 'flex-start' } : { gap: 20 }}>
      <View style={wide ? { flex: 1.35, minWidth: 0, gap: 26 } : { gap: 20 }}>{children}</View>
      <View style={wide ? { flex: 1, minWidth: 0 } : undefined}>{summary}</View>
    </View>
  );
}

/** A Group of label/value facts (read-only details on a profile). Empty values are left out. */
export function FactsGroup({ title, facts, note, link }: { title: string; facts: { k: string; v?: string | null; icon?: Parameters<typeof Icon>[0]['name'] }[]; note?: string; link?: { label: string; onPress: () => void } }) {
  const shown = facts.filter((f) => f.v && String(f.v).trim());
  return (
    <Group title={title} note={shown.length ? note : (note ?? 'Nothing recorded yet.')} link={link}>
      {shown.map((f) => (
        <FactRow key={f.k} label={f.k} value={f.v!} />
      ))}
    </Group>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Txt variant="label">{label}</Txt>
      <Txt selectable>{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  summary: { borderWidth: 1, borderRadius: 18, padding: 20, gap: 12 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, paddingVertical: 11 },
  lineValue: { fontSize: 14.5, textAlign: 'right', flexShrink: 1, fontVariant: ['tabular-nums'] },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, paddingTop: 12 },
  fact: { paddingVertical: 13, paddingHorizontal: 18, gap: 4 },
});

/** Police clearance as a row tag: the same words as VettingBadge, in the list-row style. */
export const VETTING_TAG: Record<'cleared' | 'expiring' | 'pending' | 'expired' | 'missing', { tag: string; tone: TagTone }> = {
  cleared: { tag: 'Cleared', tone: 'good' },
  expiring: { tag: 'Expiring soon', tone: 'warn' },
  pending: { tag: 'Awaiting review', tone: 'accent' },
  expired: { tag: 'Expired', tone: 'bad' },
  missing: { tag: 'Clearance missing', tone: 'bad' },
};
