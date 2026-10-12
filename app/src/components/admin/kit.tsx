/**
 * The admin redesign's editorial blocks ("a private-office feel"): hairline-ruled lists instead of boxed cards,
 * a noir hero, big Georgia figures and pill switches. Shared by Today, Diary, Ledger, Directory and the concierge.
 * Colours come from theme tokens only, so dark mode and AA contrast follow the design system.
 */
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, font, tabular } from '@/constants/theme';
import { formatAED } from '@/domain/billing';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from '../icon';
import { Screen, Txt, useScreenMetrics, useWide } from '../ui';
import { useConcierge } from './concierge-store';

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

/** Today's date as the admin screens print it: "Monday 12 October". */
export function longDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
}

/** "October" (long month names, as the prototype prints them). */
export function monthName(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long' });
}

/** AED in a short form for tight figure columns: AED 950, AED 18.4k, AED 1.2m. */
export function shortAED(n: number, compactFrom = 10_000): string {
  const a = Math.abs(n);
  if (a < compactFrom) return formatAED(Math.round(n));
  if (a < 1_000_000) return `AED ${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `AED ${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

/**
 * A tab page: on desktop a 68px top bar (the concierge search field and the date) above the scrolling Screen.
 * `topInset` pads for the status bar on phones (the native header is hidden on admin tabs).
 */
export function AdminPage({
  children,
  onRefresh,
  refreshing,
  bare,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Children render their own Screen (e.g. the account screen in Directory). */
  bare?: boolean;
}) {
  const theme = useTheme();
  const wide = useWide();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {wide ? <TopBar /> : null}
      {bare ? (
        children
      ) : (
        <Screen topInset onRefresh={onRefresh} refreshing={refreshing}>
          {children}
        </Screen>
      )}
    </View>
  );
}

/** Desktop top bar: "Search, or tell Elite what to do" (opens the concierge) and the date in Dubai. */
export function TopBar() {
  const theme = useTheme();
  const show = useConcierge((s) => s.show);
  const [hover, setHover] = useState(false);
  const isMac = web && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <View style={[kit.topBar, { borderBottomColor: theme.border, backgroundColor: theme.background }]}>
      <Pressable
        onPress={() => show()}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        accessibilityRole="button"
        accessibilityLabel={`Open the concierge (${isMac ? 'Command' : 'Control'} K)`}
        style={[kit.topSearch, { borderColor: hover ? theme.gold : theme.border, backgroundColor: theme.surface }, webStyle({ cursor: 'text' })]}>
        <Icon name="search" size={20} color={theme.textMuted} />
        <Text style={[font('sans'), { flex: 1, fontSize: 14.5, color: theme.textMuted }]} numberOfLines={1}>
          Search, or tell Elite what to do
        </Text>
        <View style={[kit.kbd, { borderColor: theme.border }]}>
          <Text style={[font('sans', 'bold'), { fontSize: 11.5, letterSpacing: 0.6, color: theme.textMuted }]}>{isMac ? '⌘K' : 'Ctrl K'}</Text>
        </View>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Text style={[font('sans', 'bold'), kit.topDate, { color: theme.textMuted }]}>{longDate(new Date())} · Dubai</Text>
    </View>
  );
}

/** The noir Today hero: date kicker, Georgia greeting, gold rule, summary line. Bleeds to the edges on phones. */
export function NoirHero({ kicker, title, line, right }: { kicker: string; title: string; line?: string; right?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { wide, padX, padTop } = useScreenMetrics();
  return (
    <View
      style={[
        { backgroundColor: theme.hero, borderColor: theme.heroBorder, borderWidth: 1, gap: 14 },
        wide
          ? { borderRadius: 24, paddingVertical: 40, paddingHorizontal: 44 }
          : {
              borderTopWidth: 0,
              borderLeftWidth: 0,
              borderRightWidth: 0,
              borderBottomLeftRadius: 28,
              borderBottomRightRadius: 28,
              marginHorizontal: -padX,
              marginTop: -padTop,
              paddingTop: Math.max(padTop, insets.top + 8) + 10,
              paddingHorizontal: 22,
              paddingBottom: 32,
            },
      ]}>
      <View style={kit.heroTop}>
        <Text style={[font('sans', 'bold'), kit.kicker, { color: theme.onHeroMuted }]}>{kicker}</Text>
        {right}
      </View>
      <Text
        accessibilityRole="header"
        style={[font('serif'), { color: theme.onHero, fontSize: wide ? 44 : 34, lineHeight: wide ? 50 : 38, letterSpacing: -0.4 }]}>
        {title}
      </Text>
      <View style={{ width: 40, height: 1, backgroundColor: Brand.gold }} />
      {line ? <Text style={[font('sans'), { color: theme.onHero, opacity: 0.86, fontSize: 17, lineHeight: 24.5, maxWidth: 520 }]}>{line}</Text> : null}
    </View>
  );
}

/** Kicker + large Georgia page title (Diary, Ledger, Directory), with an optional control on the right. */
export function PageTitle({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) {
  const theme = useTheme();
  const wide = useWide();
  return (
    <View style={kit.pageTitle}>
      <View style={{ gap: 8, flexShrink: 1 }}>
        <Text style={[font('sans', 'bold'), kit.kicker, { color: theme.textMuted }]}>{kicker}</Text>
        <Text accessibilityRole="header" style={[font('serif'), { color: theme.text, fontSize: wide ? 48 : 40, lineHeight: wide ? 52 : 44, letterSpacing: -0.5 }]}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** A Georgia 22–24 section heading with an optional meta line under it and a link or text on the right. */
export function SectionHead({
  title,
  meta,
  link,
  right,
  size = 24,
}: {
  title: string;
  meta?: string;
  link?: { label: string; onPress: () => void };
  right?: ReactNode;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <View style={kit.sectionHead}>
      <View style={{ gap: 6, flexShrink: 1 }}>
        <Text accessibilityRole="header" style={[font('serif'), { fontSize: size, lineHeight: size + 6, color: theme.text }]}>
          {title}
        </Text>
        {meta ? <Txt variant="note">{meta}</Txt> : null}
      </View>
      {link ? <InlineLink label={link.label} onPress={link.onPress} /> : right}
    </View>
  );
}

/** Gold-brown bold text link with a 44px touch area. */
export function InlineLink({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={accessibilityLabel} hitSlop={12} style={[{ minHeight: 24, justifyContent: 'center' }, webStyle({ cursor: 'pointer' })]}>
      {({ pressed }) => <Text style={[font('sans', 'bold'), { fontSize: 13.5, color: pressed ? theme.text : theme.accent }]}>{label}</Text>}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Ruled lists
// ---------------------------------------------------------------------------

/** A list under a 1px ink rule (the editorial look). Rows draw their own bottom hairlines. */
export function RuledList({ children, style, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; label?: string }) {
  const theme = useTheme();
  return (
    <View style={[{ borderTopWidth: 1, borderTopColor: theme.text }, style]} accessibilityLabel={label}>
      {children}
    </View>
  );
}

/** A small capitals heading over a 1px ink rule (Directory groups, concierge sections). */
export function RuledHeading({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.text }}>
      <Text accessibilityRole="header" style={[font('sans', 'bold'), kit.groupLabel, { color: theme.textMuted }]}>
        {title}
      </Text>
    </View>
  );
}

/**
 * One ruled row: optional icon, Georgia or bold title, note, a right-hand count or node, and a chevron or arrow
 * when tappable. Hover washes the row on the web.
 */
export function RuledRow({
  icon,
  title,
  note,
  count,
  right,
  onPress,
  serif = true,
  trail = 'chevron',
  accessibilityLabel,
  padV = 13,
}: {
  icon?: IconName;
  title: string;
  note?: string;
  count?: number | string;
  right?: ReactNode;
  onPress?: () => void;
  serif?: boolean;
  trail?: 'chevron' | 'arrow' | 'none';
  accessibilityLabel?: string;
  padV?: number;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const body = (
    <>
      {icon ? <Icon name={icon} size={20} color={theme.accent} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[serif ? font('serif') : font('sans', 'bold'), { fontSize: serif ? 16 : 15.5, lineHeight: 21, color: theme.text }]}>{title}</Text>
        {note ? (
          <Text style={[font('sans'), { fontSize: 13, lineHeight: 18, color: theme.textMuted }]} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
      {count ? <Text style={[font('sans', 'bold'), { fontSize: 12, color: theme.accent }]}>{count}</Text> : null}
      {right}
      {onPress && trail !== 'none' ? <Icon name={trail === 'arrow' ? 'arrow_forward' : 'chevron'} size={16} color={theme.chevron} /> : null}
    </>
  );
  const style = [kit.ruledRow, { paddingVertical: padV, borderBottomColor: theme.border }, hover && { backgroundColor: theme.rowHover }];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, note, count ? `${count} waiting` : ''].filter(Boolean).join(', ')}
      style={[style, webStyle({ cursor: 'pointer' })]}>
      {body}
    </Pressable>
  );
}

/** The time column + coloured bar + text + status row used by Today's list and the Diary agenda. */
export function TimeRow({
  start,
  end,
  color,
  title,
  lines,
  status,
  statusColor,
  onPress,
  large,
  accessibilityLabel,
}: {
  start: string;
  end?: string;
  color: string;
  title: string;
  lines: ReactNode[];
  status?: string;
  statusColor?: string;
  onPress: () => void;
  large?: boolean;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        kit.timeRow,
        { paddingVertical: large ? 18 : 14, gap: large ? 18 : 16, borderBottomColor: theme.border, alignItems: large ? 'flex-start' : 'center' },
        hover && { backgroundColor: theme.rowHover },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <View style={{ width: large ? 64 : 52 }}>
        <Text style={[font('serif'), tabular, { fontSize: large ? 20 : 17, color: theme.text }]}>{start}</Text>
        {end ? <Text style={[font('sans'), { fontSize: 12.5, color: theme.textMuted }]}>to {end}</Text> : null}
      </View>
      <View style={{ width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: color }} />
      <View style={{ flex: 1, minWidth: 0, gap: large ? 3 : 0 }}>
        <Text style={[font('sans', 'bold'), { fontSize: large ? 16.5 : 15.5, lineHeight: large ? 22 : 21, color: theme.text }]} numberOfLines={2}>
          {title}
        </Text>
        {lines}
      </View>
      {status ? <StatusText label={status} color={statusColor ?? theme.textMuted} style={{ paddingTop: large ? 4 : 0 }} /> : null}
    </Pressable>
  );
}

/** Small spaced capitals in a status colour (SCHEDULED, NEEDS NOTES, OVERDUE…). */
export function StatusText({ label, color, dot, style }: { label: string; color: string; dot?: boolean; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} /> : null}
      <Text style={[font('sans', 'bold'), { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color }, style]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** The pill switch from the Diary header (Agenda / By tutor / Week). */
export function PillSwitch<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[kit.pillSwitch, { backgroundColor: theme.surfaceAlt }]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            hitSlop={{ top: 5, bottom: 5 }}
            style={[
              kit.pill,
              on && { backgroundColor: theme.surface, borderColor: theme.hairline },
              on && (web ? webStyle({ boxShadow: '0 1px 4px rgba(26,20,8,.08)' }) : null),
              webStyle({ cursor: 'pointer' }),
            ]}>
            <Text style={[font('sans', 'bold'), { fontSize: 13.5, color: on ? theme.text : theme.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Underlined text filters (Open / Overdue / Paid / All). */
export function TextFilters<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 18 }} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={[{ paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: on ? theme.gold : 'transparent' }, webStyle({ cursor: 'pointer' })]}>
            <Text style={[font('sans', 'bold'), { fontSize: 13.5, color: on ? theme.text : theme.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A 36px white pill link with a gold-brown icon (Money, VAT returns, Insights). */
export function LinkPill({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={{ top: 4, bottom: 4 }}
      style={[kit.linkPill, { borderColor: hover ? theme.gold : theme.border, backgroundColor: theme.surface }, webStyle({ cursor: 'pointer' })]}>
      <Icon name={icon} size={17} color={theme.accent} />
      <Text style={[font('sans', 'bold'), { fontSize: 13.5, color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/** A compact pill button (38px): primary noir with a gold hairline, or secondary white. */
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  accessibilityLabel,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  icon?: IconName;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const primary = variant === 'primary';
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      aria-disabled={!!off}
      hitSlop={{ top: 3, bottom: 3 }}
      style={[
        kit.pillButton,
        primary
          ? { backgroundColor: hover && !off ? theme.primaryHover : theme.primary, borderColor: Brand.gold }
          : { backgroundColor: theme.surface, borderColor: hover && !off ? theme.gold : theme.border },
        off && { opacity: 0.4 },
        webStyle({ cursor: off ? 'not-allowed' : 'pointer' }),
      ]}>
      {icon ? <Icon name={icon} size={18} color={primary ? theme.onPrimary : theme.text} /> : null}
      <Text style={[font('sans', 'bold'), { fontSize: 14, letterSpacing: 0.3, color: primary ? theme.onPrimary : theme.text }]}>{busy ? 'Working…' : label}</Text>
    </Pressable>
  );
}

/** A 20px checkbox square: ink fill with a gold tick when on. */
export function CheckSquare({ on }: { on: boolean }) {
  const theme = useTheme();
  return (
    <View style={[kit.check, { borderColor: on ? theme.text : theme.chevron, backgroundColor: on ? theme.text : theme.surface }]}>
      {/* Gold tick on the noir box; on the ivory box of dark mode a noir tick keeps the contrast. */}
      {on ? <Icon name="checkmark" size={15} color={theme.primary === Brand.noir ? Brand.gold : theme.onPrimary} weight={500} /> : null}
    </View>
  );
}

/** A ruled grid of figures (The month; Collected / Earned): label, Georgia value, hint, divided by hairlines. */
export function RuledFigures({ items }: { items: { label: string; value: string; hint?: string; onPress?: () => void; tone?: 'bad' }[] }) {
  const theme = useTheme();
  const wide = useWide();
  return (
    <View style={[kit.figures, { borderTopColor: theme.text }]}>
      {items.map((f, i) => {
        const inner = (
          <>
            <Text style={[font('sans', 'bold'), kit.figLabel, { color: theme.textMuted }]}>{f.label}</Text>
            <Text
              style={[font('serif'), tabular, { fontSize: wide ? 25 : 21, lineHeight: wide ? 30 : 26, letterSpacing: -0.3, color: f.tone === 'bad' ? theme.danger : theme.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {f.value}
            </Text>
            {f.hint ? <Text style={[font('sans'), { fontSize: 12.5, lineHeight: 17, color: theme.textMuted }]}>{f.hint}</Text> : null}
          </>
        );
        const style = [
          kit.figure,
          { paddingLeft: i === 0 ? 0 : 12, borderRightWidth: i < items.length - 1 ? 1 : 0, borderRightColor: theme.border },
        ];
        return f.onPress ? (
          <Pressable
            key={f.label}
            onPress={f.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${f.label}: ${f.value}${f.hint ? `, ${f.hint}` : ''}`}
            style={({ hovered }: { hovered?: boolean }) => [style, hovered && { backgroundColor: theme.rowHover }, webStyle({ cursor: 'pointer' })]}>
            {inner}
          </Pressable>
        ) : (
          <View key={f.label} style={style}>
            {inner}
          </View>
        );
      })}
    </View>
  );
}

/** Two blocks side by side on desktop (flex 1 1 basis, 40 apart), stacked on phones. */
export function Split({ children, gap = 40 }: { children: ReactNode; gap?: number }) {
  const wide = useWide();
  return wide ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'flex-start' }}>{children}</View> : <View style={{ gap: 36 }}>{children}</View>;
}

export function SplitCol({ children, basis = 400, gap = 18 }: { children: ReactNode; basis?: number; gap?: number }) {
  const wide = useWide();
  return <View style={[{ minWidth: 0, gap }, wide && { flexGrow: 1, flexShrink: 1, flexBasis: basis }]}>{children}</View>;
}

const kit = StyleSheet.create({
  topBar: { height: 68, flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 40, borderBottomWidth: 1 },
  topSearch: { flex: 1, maxWidth: 520, height: 40, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12 },
  kbd: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  topDate: { fontSize: 11.5, letterSpacing: 1.6, textTransform: 'uppercase' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  kicker: { fontSize: 11.5, lineHeight: 15, letterSpacing: 2, textTransform: 'uppercase' },
  pageTitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  groupLabel: { fontSize: 11, lineHeight: 14, letterSpacing: 1.6, textTransform: 'uppercase' },
  ruledRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 2, borderBottomWidth: 1, minHeight: 44 },
  timeRow: { flexDirection: 'row', paddingHorizontal: 4, borderBottomWidth: 1 },
  pillSwitch: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, alignSelf: 'flex-start' },
  pill: { height: 34, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  linkPill: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillButton: { height: 38, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  figures: { flexDirection: 'row', borderTopWidth: 1 },
  figure: { flex: 1, minWidth: 0, paddingTop: 14, paddingRight: 10, paddingBottom: 4, gap: 6 },
  figLabel: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1.5, textTransform: 'uppercase' },
});
