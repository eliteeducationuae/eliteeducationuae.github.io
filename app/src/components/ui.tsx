import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
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

import { MaxContentWidth, Radius, Spacing, type Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';

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
    <View style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="label">{title}</Txt>
        {action}
      </Row>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type Variant = 'title' | 'h2' | 'h3' | 'body' | 'muted' | 'small' | 'label' | 'number';

export function Txt({
  variant = 'body',
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: keyof Palette }) {
  const theme = useTheme();
  const base = variantStyles[variant];
  const defaultColor = variant === 'muted' || variant === 'label' || variant === 'small' ? theme.textMuted : theme.text;
  return <Text style={[base, { color: color ? theme[color] : defaultColor }, style]} {...rest} />;
}

const variantStyles: Record<Variant, TextStyle> = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  muted: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  number: { fontSize: 24, lineHeight: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Coloured stripe on the left edge. */
  accent?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const body = (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        accent && { borderLeftWidth: 4, borderLeftColor: accent },
        style,
      ]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [{ flexGrow: 1 }, pressed && { opacity: 0.75 }]}>
      {body}
    </Pressable>
  );
}

export function ListItem({
  title,
  subtitle,
  left,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={title}>
      <Row gap={Spacing.three}>
        {left}
        <View style={{ flex: 1 }}>
          <Txt variant="h3" numberOfLines={1}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="muted" numberOfLines={2}>
              {subtitle}
            </Txt>
          ) : null}
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
        <Txt variant="number" color={tone} adjustsFontSizeToFit numberOfLines={1}>
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
    <Card style={{ alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.two }}>
      <Icon name={icon} size={28} color={theme.textMuted} />
      <Txt variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {message ? (
        <Txt variant="muted" style={{ textAlign: 'center', maxWidth: 360 }}>
          {message}
        </Txt>
      ) : null}
      {action}
    </Card>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <View style={{ padding: Spacing.six, alignItems: 'center' }}>
      <ActivityIndicator color={theme.accent} />
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
    <View style={[styles.banner, { backgroundColor: theme[`${tone}Bg`] }]}>
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

type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: theme.primary, fg: theme.onPrimary },
    gold: { bg: theme.gold, fg: theme.onGold },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.border },
    danger: { bg: theme.dangerBg, fg: theme.danger },
    ghost: { bg: 'transparent', fg: theme.accent },
  };
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
        pressed && { opacity: 0.8 },
        inactive && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c.fg} size="small" />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 16 : 18} color={c.fg} />
      ) : null}
      <Text style={[styles.buttonText, size === 'sm' && { fontSize: 13 }, { color: c.fg }]}>{title}</Text>
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
    gold: [theme.gold, theme.onGold],
  };
  const [bg, fg] = colors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
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
      style={[
        styles.chip,
        { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primary : theme.surface },
      ]}>
      <Text style={{ color: selected ? theme.onPrimary : theme.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={{ color: active ? theme.text : theme.textMuted, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
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
  return (
    <Pressable onPress={() => ref.current?.focus()} style={{ gap: Spacing.one }} accessible={false}>
      <Txt variant="label">{label}</Txt>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
          input.multiline && { minHeight: 96, textAlignVertical: 'top' },
          style,
        ]}
        {...input}
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
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const theme = useTheme();
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.surfaceAlt, overflow: 'hidden' }}>
      <View
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', backgroundColor: color ?? theme.accent, borderRadius: 4 }}
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
  card: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'stretch' },
  stat: { flexGrow: 1, flexBasis: 150 },
  banner: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.md, alignItems: 'flex-start' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  buttonSm: { minHeight: 36, paddingHorizontal: Spacing.three, borderRadius: Radius.sm },
  buttonText: { fontSize: 15, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: Radius.sm, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    minHeight: 36,
  },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 44 },
});
