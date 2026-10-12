import { usePathname } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { BackPill, Card, Txt, useWide } from '@/components/ui';
import { font, Radius } from '@/constants/theme';
import { formatAED } from '@/domain/billing';
import { useTheme } from '@/hooks/use-theme';

/**
 * Building blocks for the office's money pages (Money, VAT returns, Insights, invoices, credit notes, refunds and
 * expenses). They follow the redesign's Money prototype and are built from the design-system tokens, so they read
 * the same in light and dark mode.
 */

const web = Platform.OS === 'web';

/** Back to where the page was opened from: shown on the stack routes (/manage/...), not when Money is a tab. */
export function useStackBack(): boolean {
  return usePathname().startsWith('/manage/');
}

/** A big headline amount: small label, a grey "AED" and the Georgia number, with a line under it. */
export function BigAmount({ label, amount, sub, negative, decimals }: { label: string; amount: number; sub?: string; negative?: boolean; decimals?: boolean }) {
  const theme = useTheme();
  const wide = useWide();
  const size = wide ? 64 : 50;
  const digits = Math.abs(amount)
    .toFixed(decimals || !Number.isInteger(Math.round(amount * 100) / 100) ? 2 : 0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    <View style={{ gap: 12 }} accessible accessibilityLabel={`${label}: ${formatAED(amount)}${sub ? `. ${sub}` : ''}`}>
      <Txt variant="label">{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Text style={[font('serif'), { fontSize: 20, color: theme.textMuted }]}>{amount < 0 ? '−AED' : 'AED'}</Text>
        <Text
          style={[
            font('serif'),
            { fontSize: digits.length > 9 ? size * 0.75 : size, lineHeight: size * 1.05, letterSpacing: -1, color: negative ? theme.danger : theme.text },
            { fontVariant: ['tabular-nums'] },
          ]}>
          {digits}
        </Text>
      </View>
      {sub ? (
        <Txt variant="muted" style={{ fontSize: 14.5 }}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

export interface LedgerLine {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'good' | 'bad' | 'warn';
}

/**
 * Ruled figures: a dark rule on top, then label and amount on each line (P&L, VAT return, totals). Each line is a
 * row of exactly two texts, label then amount, so tests and screen readers read them in order.
 */
export function Ledger({ lines, footnote, style }: { lines: LedgerLine[]; footnote?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const tones = { good: theme.success, bad: theme.danger, warn: theme.warning };
  return (
    <View style={style}>
      <View style={{ borderTopWidth: 1, borderTopColor: theme.text }}>
        {lines.map((l, i) => (
          <View key={`${l.label}-${i}`} style={[styles.ledgerRow, { borderBottomColor: l.strong ? theme.text : theme.border }]}>
            <Text style={[font('sans', l.strong ? 'bold' : 'regular'), styles.ledgerText, { flex: 1, color: l.strong ? theme.text : theme.textMuted }]}>
              {l.label}
            </Text>
            <Text
              style={[
                font('sans', l.strong ? 'bold' : 'regular'),
                styles.ledgerText,
                { color: l.tone ? tones[l.tone] : theme.text, fontVariant: ['tabular-nums'], textAlign: 'right' },
              ]}>
              {l.value}
            </Text>
          </View>
        ))}
      </View>
      {footnote ? (
        <Txt variant="small" style={{ paddingTop: 12, lineHeight: 19 }}>
          {footnote}
        </Txt>
      ) : null}
    </View>
  );
}

/** A 34px white pill with a gold-brown download icon, for one export. */
export function DownloadChip({
  label,
  onPress,
  icon = 'download',
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={{ top: 5, bottom: 5 }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: theme.surface, borderColor: pressed || hover ? theme.gold : theme.border },
        web ? ({ cursor: 'pointer' } as ViewStyle) : null,
      ]}>
      <Icon name={icon} size={16} color={theme.accent} weight={400} />
      <Text style={[font('sans', 'bold'), { fontSize: 13.5, color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/** A row of chips that wraps. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

/** The noir panel: a gold kicker, a Georgia title, a line and an optional action (pay run, written summary). */
export function NoirPanel({
  kicker,
  icon,
  title,
  line,
  children,
}: {
  kicker: string;
  icon?: IconName;
  title?: string;
  line?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const wide = useWide();
  return (
    <Card variant="hero" style={{ padding: wide ? 28 : 22, gap: 12, borderRadius: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Icon name={icon} size={16} color={theme.gold} weight={400} /> : null}
        <Text style={[font('sans', 'bold'), styles.kicker, { color: theme.gold }]}>{kicker}</Text>
      </View>
      {title ? <Text style={[font('serif'), { fontSize: 28, lineHeight: 33, color: theme.onHero, fontVariant: ['tabular-nums'] }]}>{title}</Text> : null}
      {line ? typeof line === 'string' ? <Text style={[font('sans'), { fontSize: 14.5, lineHeight: 21, color: theme.onHeroMuted }]}>{line}</Text> : line : null}
      {children}
    </Card>
  );
}

/** A white card with a Georgia title, a legend and twelve months of paired bars (revenue in ink, profit in gold). */
export function MonthBars({
  title,
  items,
  highlight,
}: {
  title: string;
  items: { label: string; short: string; revenue: number; profit: number }[];
  /** Index of the month(s) to draw in full ink; the rest are drawn in a quiet stone. Omit for all in ink. */
  highlight?: number[];
}) {
  const theme = useTheme();
  const wide = useWide();
  const max = Math.max(1, ...items.map((i) => Math.max(i.revenue, i.profit)));
  const quiet = theme.sendDisabled;
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <Txt variant="groupTitle" style={{ fontSize: 19 }} accessibilityRole="header">
          {title}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Key color={theme.text} label="Revenue" />
          <Key color={theme.gold} label="Profit" />
        </View>
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={items.map((i) => `${i.label}: revenue ${formatAED(i.revenue)}, profit ${formatAED(i.profit)}`).join('. ')}
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 140 }}>
        {items.map((m, i) => {
          const ink = !highlight || highlight.includes(i);
          return (
            <View key={m.label} style={{ flex: 1, height: '100%', flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
              <View
                style={{
                  flex: 1,
                  height: `${(Math.max(0, m.revenue) / max) * 100}%`,
                  minHeight: m.revenue > 0 ? 2 : 0,
                  backgroundColor: ink ? theme.text : quiet,
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                }}
              />
              <View
                style={{
                  flex: 1,
                  height: `${(Math.abs(m.profit) / max) * 100}%`,
                  minHeight: m.profit !== 0 ? 2 : 0,
                  backgroundColor: m.profit < 0 ? theme.danger : theme.gold,
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                }}
              />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {items.map((m) => (
          <Text key={m.label} numberOfLines={1} style={[font('sans'), { flex: 1, textAlign: 'center', fontSize: 10.5, color: theme.textMuted }]}>
            {wide ? m.short : m.short.slice(0, 1)}
          </Text>
        ))}
      </View>
      {items.some((m) => m.profit < 0) ? <Txt variant="small">Months with a loss draw their profit bar in red.</Txt> : null}
    </View>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Txt variant="small" style={{ fontSize: 12 }}>
        {label}
      </Txt>
    </View>
  );
}

/** Labelled horizontal bars (share of revenue, tutor capacity): label and value above a 6px bar. */
export function BarList({ items, footnote }: { items: { label: string; value: string; share: number; gold?: boolean }[]; footnote?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      {items.map((b) => (
        <View key={b.label} style={{ gap: 6 }} accessible accessibilityLabel={`${b.label}: ${b.value}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={[font('sans'), { flex: 1, fontSize: 14.5, color: theme.text }]}>{b.label}</Text>
            <Text style={[font('sans'), { fontSize: 14.5, color: theme.textMuted, fontVariant: ['tabular-nums'] }]}>{b.value}</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.rowDivider }}>
            <View
              style={{
                height: '100%',
                width: `${Math.max(0, Math.min(1, b.share)) * 100}%`,
                borderRadius: 3,
                backgroundColor: b.gold ? theme.gold : theme.text,
              }}
            />
          </View>
        </View>
      ))}
      {footnote ? (
        <Txt variant="small" style={{ lineHeight: 19 }}>
          {footnote}
        </Txt>
      ) : null}
    </View>
  );
}

/** A white summary card (preview, payment on an invoice, "in the books") with a small label on top. */
export function SideCard({ label, children, gold, style }: { label?: string; children: ReactNode; gold?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.side, { backgroundColor: theme.surface, borderColor: gold ? theme.gold : theme.hairline }, style]}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      {children}
    </View>
  );
}

/** Two blocks side by side on desktop (weighted), stacked on phones. */
export function Split({ children, weights = [1, 1], gap }: { children: [ReactNode, ReactNode]; weights?: [number, number]; gap?: number }) {
  const wide = useWide();
  if (!wide) return <View style={{ gap: gap ?? 20 }}>{children}</View>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: gap ?? 40 }}>
      <View style={{ flex: weights[0], minWidth: 0, gap: 20 }}>{children[0]}</View>
      <View style={{ flex: weights[1], minWidth: 0, gap: 20 }}>{children[1]}</View>
    </View>
  );
}

export interface ActionItem {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  accessibilityHint?: string;
}

/** A ruled list of actions: icon, bold label and a chevron (Download PDF, Issue a credit note, Cancel this invoice). */
export function ActionList({ items }: { items: ActionItem[] }) {
  const theme = useTheme();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.text }}>
      {items.map((a) => (
        <ActionRow key={a.label} item={a} color={a.danger ? theme.danger : theme.text} />
      ))}
    </View>
  );
}

function ActionRow({ item, color }: { item: ActionItem; color: string }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={item.onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityHint={item.accessibilityHint}
      style={({ pressed }) => [
        styles.action,
        { borderBottomColor: theme.border, backgroundColor: hover || pressed ? theme.rowHover : 'transparent' },
        web ? ({ cursor: 'pointer' } as ViewStyle) : null,
      ]}>
      <Icon name={item.icon} size={20} color={color} />
      <Text style={[font('sans', 'bold'), { flex: 1, fontSize: 15, color }]}>{item.label}</Text>
      <Icon name="chevron_right" size={18} color={theme.chevron} />
    </Pressable>
  );
}

/** A status word with a coloured dot before it, in small capitals. */
export function StatusDot({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={[font('sans', 'bold'), { fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color }]}>{label}</Text>
    </View>
  );
}

/** The back pill on stack routes only. */
export function StackBack() {
  return useStackBack() ? <BackPill /> : null;
}

const styles = StyleSheet.create({
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, paddingVertical: 12, borderBottomWidth: 1 },
  ledgerText: { fontSize: 15, lineHeight: 21 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: Radius.pill, borderWidth: 1 },
  kicker: { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' },
  panel: { borderRadius: Radius.card, borderWidth: 1, padding: 20, gap: 14 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1 },
  side: { borderRadius: Radius.card, borderWidth: 1, padding: 22, gap: 12 },
});
