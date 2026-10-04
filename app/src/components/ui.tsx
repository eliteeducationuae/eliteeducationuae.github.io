import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, elevation, font, MaxContentWidth, Radius, Spacing, type Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';

/** Set by hero cards so text inside them switches to the on-hero colours. */
const HeroSurface = createContext(false);

/** True inside a <Card variant="hero">; use it to pick on-hero colours for custom content. */
export function useOnHero() {
  return useContext(HeroSurface);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  scroll = true,
  topInset = false,
  footer,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
  /** Pad for the status bar (for screens without a header). */
  topInset?: boolean;
  /** Pinned below the scroll area (e.g. a primary action). */
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const content = (
    <View style={[styles.content, topInset && { paddingTop: insets.top + Spacing.three }]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
      {footer ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: insets.bottom + Spacing.two },
          ]}>
          <View style={styles.footerInner}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

export function Row({
  children,
  gap = Spacing.two,
  style,
  wrap,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.two + Spacing.one }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <SectionLabel>{title}</SectionLabel>
        {action}
      </Row>
      {children}
    </View>
  );
}

/** Uppercase tracked label with a short champagne-gold rule beneath, as in the brand guidelines. */
export function SectionLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label">{children}</Txt>
      <View style={{ width: 28, height: 1.5, backgroundColor: theme.gold }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type Variant = 'display' | 'title' | 'h2' | 'h3' | 'body' | 'muted' | 'small' | 'label' | 'number';

export function Txt({
  variant = 'body',
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: keyof Palette }) {
  const theme = useTheme();
  const onHero = useContext(HeroSurface);
  const base = variantStyles[variant];
  const secondary = variant === 'muted' || variant === 'label' || variant === 'small';
  const defaultColor = onHero ? (secondary ? theme.onHeroMuted : theme.onHero) : secondary ? theme.textMuted : theme.text;
  return <Text style={[base, { color: color ? theme[color] : defaultColor }, style]} {...rest} />;
}

// The brand type scale: Display Georgia bold, H1 Georgia regular, H2 Georgia bold,
// body in Calibri (Carlito), labels in Calibri bold capitals with tracking.
const variantStyles: Record<Variant, TextStyle> = {
  display: { ...font('serif', 'bold'), fontSize: 34, lineHeight: 40, letterSpacing: -0.4 },
  title: { ...font('serif', 'bold'), fontSize: 30, lineHeight: 38, letterSpacing: -0.3 },
  h2: { ...font('serif'), fontSize: 22, lineHeight: 29 },
  h3: { ...font('serif', 'bold'), fontSize: 16.5, lineHeight: 23 },
  body: { ...font('sans'), fontSize: 16, lineHeight: 23 },
  muted: { ...font('sans'), fontSize: 15, lineHeight: 21 },
  small: { ...font('sans'), fontSize: 13, lineHeight: 18 },
  label: { ...font('sans', 'bold'), fontSize: 11.5, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 1.6 },
  number: { ...font('serif', 'bold'), fontSize: 26, lineHeight: 32, fontVariant: ['tabular-nums'] },
};

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  onPress,
  style,
  accent,
  accessibilityLabel,
  variant = 'default',
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Coloured stripe on the left edge. */
  accent?: string;
  accessibilityLabel?: string;
  /** hero: noir surface with ivory text; highlight: champagne wash with a gold left rule. */
  variant?: 'default' | 'hero' | 'highlight';
}) {
  const theme = useTheme();
  const surface: ViewStyle =
    variant === 'hero'
      ? { backgroundColor: theme.hero, borderColor: theme.heroBorder, borderWidth: StyleSheet.hairlineWidth }
      : variant === 'highlight'
        ? { backgroundColor: theme.champagne, borderColor: theme.border, borderLeftWidth: 3, borderLeftColor: theme.gold }
        : { backgroundColor: theme.surface, borderColor: theme.border };
  const body = (
    <View
      style={[
        styles.card,
        surface,
        variant === 'hero' ? elevation(theme, 2) : elevation(theme),
        accent && { borderLeftWidth: 4, borderLeftColor: accent },
        style,
      ]}>
      {children}
    </View>
  );
  const content = variant === 'hero' ? <HeroSurface.Provider value>{body}</HeroSurface.Provider> : body;
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [{ flexGrow: 1, borderRadius: Radius.md }, pressed && { opacity: 0.88, transform: [{ scale: 0.995 }] }]}>
      {content}
    </Pressable>
  );
}

export function ListItem({
  title,
  subtitle,
  left,
  right,
  below,
  onPress,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  /** Shown under the subtitle, e.g. a status badge, so it never squeezes the title on a phone. */
  below?: ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={title}>
      <Row gap={Spacing.three}>
        {left}
        <View style={{ flex: 1 }}>
          <Txt variant="h3" numberOfLines={below ? 2 : 1}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="muted" numberOfLines={2}>
              {subtitle}
            </Txt>
          ) : null}
          {below ? <View style={{ flexDirection: 'row', marginTop: Spacing.one }}>{below}</View> : null}
        </View>
        {right}
        {onPress ? <Icon name="chevron" size={16} color={theme.textMuted} /> : null}
      </Row>
    </Card>
  );
}

/** Wrapping grid of equal-height stat tiles. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
  onPress?: () => void;
}) {
  return (
    <View style={styles.stat}>
      <Card style={{ flex: 1, gap: Spacing.one }} onPress={onPress} accessibilityLabel={`${label}: ${value}`}>
        <Txt variant="label">{label}</Txt>
        <Txt variant="number" color={tone} adjustsFontSizeToFit numberOfLines={1} style={value.length > 7 && styles.statLong}>
          {value}
        </Txt>
        {hint ? <Txt variant="small">{hint}</Txt> : null}
      </Card>
    </View>
  );
}

export function EmptyState({ icon = 'sparkle', title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: Spacing.five, paddingHorizontal: Spacing.four, gap: Spacing.two + Spacing.one }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: theme.champagne,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.gold,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name={icon} size={26} color={theme.accent} />
      </View>
      <Txt variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <View style={{ width: 28, height: 1.5, backgroundColor: theme.gold }} />
      {message ? (
        <Txt variant="muted" style={{ textAlign: 'center', maxWidth: 380 }}>
          {message}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: Spacing.two }}>{action}</View> : null}
    </Card>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <View style={{ padding: Spacing.six, alignItems: 'center' }}>
      <ActivityIndicator color={theme.gold} />
    </View>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Banner tone="danger" icon="alert">
      {error instanceof Error ? error.message : String(error)}
    </Banner>
  );
}

export function Banner({
  children,
  tone = 'info',
  icon = 'sparkle',
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  icon?: IconName;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme[`${tone}Bg`], borderLeftColor: theme[tone] }]}>
      <Icon name={icon} size={18} color={theme[tone]} />
      <Txt variant="muted" style={{ flex: 1, color: theme.text }}>
        {children}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'danger' | 'ghost' | 'outline';

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconAfter,
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  /** An icon after the title, e.g. the forward chevron on a "Next" pager button. */
  iconAfter?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: theme.primary, fg: theme.onPrimary },
    // The main call to action: noir (ivory in dark) with a Champagne Gold hairline. Gold is never a fill.
    gold: { bg: theme.primary, fg: theme.onPrimary, border: theme.gold },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.border },
    danger: { bg: theme.dangerBg, fg: theme.danger },
    ghost: { bg: 'transparent', fg: theme.accent },
    // The brand's secondary button: transparent with a Champagne Gold hairline.
    outline: { bg: 'transparent', fg: theme.text, border: theme.gold },
  };
  // On a noir hero surface the light-scheme colours would vanish, so buttons invert there.
  const onHero = useContext(HeroSurface);
  if (onHero) {
    palette.primary = { bg: theme.onHero, fg: theme.hero };
    palette.gold = { bg: theme.onHero, fg: theme.hero, border: theme.gold };
    palette.secondary = { bg: 'transparent', fg: theme.onHero, border: theme.onHeroMuted };
    palette.outline = { bg: 'transparent', fg: theme.onHero, border: theme.gold };
    palette.ghost = { bg: 'transparent', fg: theme.onHero };
  }
  const c = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        { backgroundColor: c.bg, borderColor: c.border ?? c.bg },
        pressed && { opacity: 0.82, borderColor: theme.gold },
        inactive && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c.fg} size="small" />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 16 : 18} color={c.fg} />
      ) : null}
      <Text style={[styles.buttonText, size === 'sm' && { fontSize: 14 }, { color: c.fg }]}>{title}</Text>
      {iconAfter && !loading ? <Icon name={iconAfter} size={size === 'sm' ? 16 : 18} color={c.fg} /> : null}
    </Pressable>
  );
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'gold';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const theme = useTheme();
  const colors: Record<Tone, [string, string]> = {
    neutral: [theme.surfaceAlt, theme.textMuted],
    success: [theme.successBg, theme.success],
    warning: [theme.warningBg, theme.warning],
    danger: [theme.dangerBg, theme.danger],
    info: [theme.infoBg, theme.info],
    gold: [theme.champagne, theme.accent],
  };
  const [bg, fg] = colors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }, tone === 'gold' && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.gold }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.gold : theme.border, backgroundColor: selected ? theme.primary : theme.surface },
        pressed && { borderColor: theme.gold },
      ]}>
      <Text style={[font('sans', 'bold'), { color: selected ? theme.onPrimary : theme.text, fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Shown but not changeable (e.g. autopay before a card is saved). */
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.segmented,
        // Disabled: no trough, a dashed outline instead, so it reads as fixed without fading the labels below AA.
        disabled ? { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border } : { backgroundColor: theme.surfaceAlt },
      ]}
      accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            aria-selected={active}
            aria-disabled={!!disabled}
            style={[
              styles.segment,
              active && [{ backgroundColor: theme.surface, borderColor: theme.border }, !disabled && elevation(theme)],
              disabled && Platform.OS === 'web' && ({ cursor: 'not-allowed' } as object),
            ]}>
            <Text style={[font('sans', 'bold'), { color: active ? theme.text : theme.textMuted, fontSize: 14 }]}>{o.label}</Text>
            {active ? <View style={[styles.segmentMarker, { backgroundColor: theme.gold }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  hint,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string }) {
  const theme = useTheme();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const { onFocus, onBlur } = input;
  return (
    <Pressable onPress={() => ref.current?.focus()} style={{ gap: Spacing.one }} accessible={false}>
      <Txt variant="label">{label}</Txt>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          font('sans'),
          { backgroundColor: theme.surface, borderColor: focused ? theme.gold : theme.border, color: theme.text },
          input.multiline && { minHeight: 96, textAlignVertical: 'top' },
          style,
        ]}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
      {hint ? <Txt variant="small">{hint}</Txt> : null}
    </Pressable>
  );
}

export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const theme = useTheme();
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color ?? theme.primary,
        borderWidth: color ? 0 : 1,
        borderColor: theme.gold,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={[font('serif', 'bold'), { color: color ? Brand.white : theme.onPrimary, fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const theme = useTheme();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.surfaceAlt, overflow: 'hidden' }}>
      <View
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', backgroundColor: color ?? theme.gold, borderRadius: 4 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, paddingHorizontal: Spacing.three, alignItems: 'center' },
  footerInner: { width: '100%', maxWidth: MaxContentWidth, flexDirection: 'row', gap: Spacing.two },
  card: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three + Spacing.one, gap: Spacing.two },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'stretch' },
  stat: { flexGrow: 1, flexBasis: 150 },
  // Web cannot shrink text to fit, so longer figures (e.g. "AED 12,400") step down a size.
  statLong: { fontSize: 21, lineHeight: 28 },
  banner: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, borderLeftWidth: 3, alignItems: 'flex-start' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 50,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  buttonSm: { minHeight: 38, paddingHorizontal: Spacing.three + 2 },
  buttonText: { ...font('sans', 'bold'), fontSize: 16, letterSpacing: 0.3 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  badgeText: { ...font('sans', 'bold'), fontSize: 11, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 1.1 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: Radius.pill, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    minHeight: 36,
  },
  segmentMarker: { position: 'absolute', bottom: 3, width: 18, height: 2, borderRadius: 1 },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, minHeight: 48 },
});
