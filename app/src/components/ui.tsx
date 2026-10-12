/**
 * The Elite Education design system (2026 redesign). Every screen is a list of blocks from this file:
 * Hero / PageHeader at the top, then Figures, Group (+ GroupRow), Notice, Prose, FieldsCard (+ Field, ChipField,
 * Toggle), Tabs and Actions. See .git/rd-components.md in the worktree for the API guide. Older components
 * (Card, ListItem, Stat, Banner, Section…) are kept for screens not yet moved over, restyled to the new look.
 */
import { router, type Href } from 'expo-router';
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
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

import { avatarColor, Brand, font, Layout, Radius, Spacing, type Palette } from '@/constants/theme';
import { isViewOnlyError, VIEW_ONLY_MESSAGE } from '@/data/view-as';
import { useTheme } from '@/hooks/use-theme';
import { useWide } from '@/hooks/use-wide';
import { politeError } from '@/lib/polite-error';

import { Icon, type IconName } from './icon';

export { useWide };

/** Set by hero cards so text inside them switches to the on-hero colours. */
const HeroSurface = createContext(false);

/** True inside a <Card variant="hero">; use it to pick on-hero colours for custom content. */
export function useOnHero() {
  return useContext(HeroSurface);
}

const web = Platform.OS === 'web';
/** Web-only style (cursor, grid, backdrop filter…), typed loosely because React Native's types do not know it. */
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

type ScreenMetrics = { wide: boolean; padX: number; padTop: number };
const ScreenContext = createContext<ScreenMetrics>({ wide: false, padX: Layout.phonePadX, padTop: Layout.phonePadTop });

/** The current screen's padding, so a block can bleed to the edges (the phone hero, phone tabs). */
export function useScreenMetrics() {
  return useContext(ScreenContext);
}

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  scroll = true,
  topInset = false,
  footer,
  narrow = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
  /** Pad for the status bar: use it on screens whose native header is hidden (Hero or PageHeader at the top). */
  topInset?: boolean;
  /** Pinned below the scroll area (e.g. a primary action). */
  footer?: ReactNode;
  /** A narrow centred column (520), for sign-in style pages. */
  narrow?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const padX = wide ? Layout.desktopPadX : Layout.phonePadX;
  const padTop = (wide ? Layout.desktopPadTop : Layout.phonePadTop) + (topInset ? insets.top + (wide ? 0 : Spacing.two) : 0);
  const metrics = useMemo(() => ({ wide, padX, padTop }), [wide, padX, padTop]);
  const content = (
    <View
      style={[
        styles.content,
        {
          maxWidth: narrow ? 520 : Layout.maxWidth,
          paddingHorizontal: padX,
          paddingTop: padTop,
          paddingBottom: wide ? Layout.desktopPadBottom : Layout.phonePadBottom,
          gap: wide ? Layout.desktopGap : Layout.phoneGap,
        },
        narrow && { alignSelf: 'center' },
      ]}>
      {children}
    </View>
  );
  return (
    <ScreenContext.Provider value={metrics}>
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
              { backgroundColor: theme.surface, borderTopColor: theme.hairline, paddingBottom: insets.bottom + Spacing.two, paddingHorizontal: padX },
            ]}>
            <View style={[styles.footerInner, { maxWidth: Layout.maxWidth - 2 * padX }]}>{footer}</View>
          </View>
        ) : null}
      </View>
    </ScreenContext.Provider>
  );
}

/** Horizontal layout helper (not a list row: for that, use GroupRow). */
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

/**
 * Blocks that sit two-up on desktop (each at least 400 wide) and stack on phones: the prototypes' "half" blocks.
 * Put Groups, Prose, Notices or any View inside.
 */
export function Columns({ children }: { children: ReactNode }) {
  const wide = useWide();
  return (
    <View style={[styles.columns, { gap: wide ? Layout.halfGap : Layout.phoneGap }]}>
      {Children.toArray(children).map((child, i) => (
        <View key={isValidElement(child) && child.key != null ? child.key : i} style={wide ? styles.half : styles.full}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** A titled section: Georgia group title with an optional action on the right, then its content. */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.groupHead}>
        <Txt variant="groupTitle" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        {action}
      </View>
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
      {/* 2px so the gold rule never renders grey or white on screens that round a thinner line away. */}
      <View style={{ width: 28, height: 2, backgroundColor: theme.gold }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type TxtVariant =
  | 'display'
  | 'title'
  | 'figure'
  | 'groupTitle'
  | 'h2'
  | 'h3'
  | 'kicker'
  | 'label'
  | 'figureLabel'
  | 'body'
  | 'muted'
  | 'note'
  | 'small'
  | 'number';

/**
 * Text in the brand type scale. Redesign variants:
 * display (hero greeting, Georgia 34 / 46 on desktop), title (page title, Georgia 34 / 44), figure (Georgia 27,
 * tabular), groupTitle (Georgia 21), kicker (11.5 bold, 2px tracking, gold-brown, capitals), label (11 bold capitals,
 * field labels), figureLabel (10.5), body (15.5), note (13.5, grey).
 */
export function Txt({
  variant = 'body',
  color,
  style,
  ...rest
}: TextProps & { variant?: TxtVariant; color?: keyof Palette }) {
  const theme = useTheme();
  const onHero = useContext(HeroSurface);
  const wide = useWide();
  const base = variantStyles[variant];
  const responsive = wide ? desktopStyles[variant] : undefined;
  const secondary = variant === 'muted' || variant === 'label' || variant === 'small' || variant === 'note' || variant === 'figureLabel';
  const defaultColor = onHero
    ? secondary || variant === 'kicker'
      ? theme.onHeroMuted
      : theme.onHero
    : variant === 'kicker'
      ? theme.accent
      : secondary
        ? theme.textMuted
        : theme.text;
  return <Text style={[base, responsive, { color: color ? theme[color] : defaultColor }, style]} {...rest} />;
}

// Georgia (regular) for display, titles and figures; Calibri (Carlito) for everything else.
const variantStyles: Record<TxtVariant, TextStyle> = {
  display: { ...font('serif'), fontSize: 34, lineHeight: 38, letterSpacing: -0.4 },
  title: { ...font('serif'), fontSize: 34, lineHeight: 37, letterSpacing: -0.3 },
  figure: { ...font('serif'), fontSize: 27, lineHeight: 29, fontVariant: ['tabular-nums'] },
  groupTitle: { ...font('serif'), fontSize: 21, lineHeight: 27 },
  h2: { ...font('serif'), fontSize: 22, lineHeight: 29 },
  h3: { ...font('serif', 'bold'), fontSize: 16.5, lineHeight: 23 },
  kicker: { ...font('sans', 'bold'), fontSize: 11.5, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 2 },
  label: { ...font('sans', 'bold'), fontSize: 11, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 1.5 },
  figureLabel: { ...font('sans', 'bold'), fontSize: 10.5, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 1.5 },
  body: { ...font('sans'), fontSize: 15.5, lineHeight: 23 },
  muted: { ...font('sans'), fontSize: 15, lineHeight: 21 },
  note: { ...font('sans'), fontSize: 13.5, lineHeight: 19.5 },
  small: { ...font('sans'), fontSize: 13, lineHeight: 18 },
  number: { ...font('serif'), fontSize: 27, lineHeight: 32, fontVariant: ['tabular-nums'] },
};

const desktopStyles: Partial<Record<TxtVariant, TextStyle>> = {
  display: { fontSize: 46, lineHeight: 52 },
  title: { fontSize: 44, lineHeight: 48 },
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
  /** hero: noir surface with ivory text; highlight: a sand wash. */
  variant?: 'default' | 'hero' | 'highlight';
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const surface: ViewStyle =
    variant === 'hero'
      ? { backgroundColor: theme.hero, borderColor: theme.heroBorder, borderRadius: 22 }
      : variant === 'highlight'
        ? { backgroundColor: theme.sand, borderColor: theme.sand }
        : { backgroundColor: theme.surface, borderColor: hover ? theme.gold : theme.hairline };
  const body = (
    <View style={[styles.card, surface, accent && { borderLeftWidth: 4, borderLeftColor: accent }, style]}>{children}</View>
  );
  const content = variant === 'hero' ? <HeroSurface.Provider value>{body}</HeroSurface.Provider> : body;
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [{ flexGrow: 1, borderRadius: Radius.card }, pressed && { opacity: 0.88 }]}>
      {content}
    </Pressable>
  );
}

/** A single tappable card row. Prefer a Group of GroupRows for lists; this stays for older screens. */
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
    <Card onPress={onPress} accessibilityLabel={title} style={styles.listItem}>
      <Row gap={14}>
        {left}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={below ? 2 : 1}>
            {title}
          </Text>
          {subtitle ? (
            <Txt variant="note" numberOfLines={2}>
              {subtitle}
            </Txt>
          ) : null}
          {below ? <View style={{ flexDirection: 'row', marginTop: Spacing.one }}>{below}</View> : null}
        </View>
        {right}
        {onPress ? <Icon name="chevron_right" size={20} color={theme.chevron} /> : null}
      </Row>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** Grid of figure cards: as many 140-wide columns as fit, 12 apart. */
export function Figures({ children }: { children: ReactNode }) {
  return (
    <View style={[styles.figures, webStyle({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' })]}>
      {children}
    </View>
  );
}

export type FigureTone = 'good' | 'bad' | 'highlight' | 'warn' | 'success' | 'warning' | 'danger' | 'info';

/** One figure: label (capitals), Georgia value in tabular numerals, optional hint. Tone colours the value. */
export function Figure({
  label,
  value,
  hint,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  /** good: green, bad: red (overdue, losses), highlight: gold-brown, warn: amber. */
  tone?: FigureTone;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const toneColor: Record<FigureTone, string> = {
    good: theme.success,
    success: theme.success,
    bad: theme.danger,
    danger: theme.danger,
    highlight: theme.accent,
    info: theme.accent,
    warn: theme.warning,
    warning: theme.warning,
  };
  const body = (
    <View style={[styles.figure, { backgroundColor: theme.surface, borderColor: hover ? theme.gold : theme.hairline }]}>
      <Txt variant="figureLabel">{label}</Txt>
      <Text
        style={[
          variantStyles.figure,
          { color: tone ? toneColor[tone] : theme.text },
          // Long amounts step down rather than truncate (the web cannot shrink text to fit).
          value.length > 12 ? { fontSize: 20, lineHeight: 24 } : value.length > 9 ? { fontSize: 23, lineHeight: 27 } : null,
        ]}>
        {value}
      </Text>
      {hint ? <Txt variant="small">{hint}</Txt> : null}
    </View>
  );
  const wrap = web ? undefined : styles.figureCell;
  if (!onPress) return <View style={wrap}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={wrap}>
      {body}
    </Pressable>
  );
}

/** Older name for Figures. */
export const StatGrid = Figures;
/** Older name for Figure. */
export const Stat = Figure;

// ---------------------------------------------------------------------------
// Group (list card) and its rows
// ---------------------------------------------------------------------------

/**
 * A list card: optional Georgia title with a meta note or a link on the right, an optional intro note, then
 * GroupRows separated by hairline dividers. Any child works as a row.
 */
export function Group({
  title,
  meta,
  link,
  note,
  children,
  style,
}: {
  title?: string;
  /** Grey text on the right of the title, e.g. "3 this week". */
  meta?: string;
  /** A gold-brown link on the right of the title. */
  link?: { label: string; onPress: () => void };
  /** A paragraph at the top of the card, before the rows. */
  note?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ gap: 12 }, style]}>
      {title ? (
        <View style={styles.groupHead}>
          <Txt variant="groupTitle" accessibilityRole="header" style={{ flexShrink: 1 }}>
            {title}
          </Txt>
          {meta ? <Txt variant="small">{meta}</Txt> : null}
          {link ? <TextLink label={link.label} onPress={link.onPress} /> : null}
        </View>
      ) : null}
      {rows.length || note ? (
        <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          {note ? (
            <View style={styles.groupNote}>
              {typeof note === 'string' ? (
                <Txt style={{ fontSize: 14.5, lineHeight: 22, color: theme.textWarm }}>{note}</Txt>
              ) : (
                note
              )}
            </View>
          ) : null}
          {rows.map((r, i) => (
            <View
              key={isValidElement(r) && r.key != null ? r.key : i}
              style={i > 0 || note ? { borderTopWidth: 1, borderTopColor: theme.rowDivider } : undefined}>
              {r}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A gold-brown text link (13.5 bold), e.g. a group's "See all". */
export function TextLink({ label, onPress, underline }: { label: string; onPress: () => void; underline?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={12} style={webStyle({ cursor: 'pointer' })}>
      {({ pressed }) => (
        <Text
          style={[
            font('sans', 'bold'),
            { fontSize: 13.5, color: pressed ? theme.text : theme.accent },
            underline && { textDecorationLine: 'underline' },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export type RowTone = 'gold' | 'good' | 'warn' | 'bad' | 'neutral' | 'noir';

function toneColors(theme: Palette, tone: RowTone): [bg: string, fg: string] {
  switch (tone) {
    case 'good':
      return [theme.successBg, theme.success];
    case 'warn':
      return [theme.warningBg, theme.warning];
    case 'bad':
      return [theme.dangerBg, theme.danger];
    case 'neutral':
      return [theme.surfaceAlt, theme.textMuted];
    case 'noir':
      return [theme.primary, theme.onPrimary];
    default:
      return [theme.sand, theme.accent];
  }
}

/** A 38px round icon (sand with a gold-brown icon by default). */
export function IconCircle({ icon, tone = 'gold', size = 38 }: { icon: IconName; tone?: RowTone; size?: number }) {
  const theme = useTheme();
  const [bg, fg] = toneColors(theme, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={Math.round(size * 0.53)} color={fg} />
    </View>
  );
}

/** A 44-wide date chip: short day above the day number, on sand. */
export function DateChip({ top, num }: { top: string; num: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.dateChip, { backgroundColor: theme.sand }]}>
      <Text style={[font('sans', 'bold'), styles.dateTop, { color: theme.accent }]}>{top}</Text>
      <Text style={[font('serif'), { fontSize: 19, lineHeight: 21, color: theme.text }]}>{num}</Text>
    </View>
  );
}

export type ValueTone = 'muted' | 'text' | 'good' | 'warn' | 'bad' | 'accent';

/**
 * One row of a Group. Left: an icon circle, an initials avatar or a date chip. Middle: bold title, note, optional
 * progress bar. Right: a tabular value, a compact pill action, a chevron (when tappable) or an expand arrow
 * (when it has a body). Tappable rows highlight on hover and are announced as buttons.
 */
export function GroupRow({
  title,
  note,
  icon,
  tone = 'gold',
  avatar,
  avatarColor: avatarFill,
  date,
  progress,
  progressColor,
  value,
  valueTone = 'muted',
  valueSize,
  action,
  onPress,
  body,
  expanded: expandedProp,
  onToggle,
  titleWeight = 'bold',
  right,
  children,
  accessibilityLabel,
  accessibilityHint,
  disabled,
}: {
  title: string;
  note?: ReactNode;
  /** A 38px icon circle on the left. */
  icon?: IconName;
  /** The icon circle's colours. */
  tone?: RowTone;
  /** A name: shows a 38px initials avatar in one of the avatar colours. */
  avatar?: string;
  /** Overrides the avatar colour. */
  avatarColor?: string;
  /** A 44px date chip, e.g. { top: 'Wed', num: '7' }. */
  date?: { top: string; num: string };
  /** 0–100: a 6px progress bar under the note. */
  progress?: number;
  progressColor?: string;
  /** Right-aligned tabular value, e.g. an amount or a status word. */
  value?: string;
  valueTone?: ValueTone;
  valueSize?: number;
  /** A compact 34px pill button on the right. Hidden by the caller while viewing as someone else. */
  action?: { label: string; onPress: () => void; variant?: 'secondary' | 'primary' | 'danger'; disabled?: boolean; accessibilityLabel?: string };
  /** Makes the row tappable, with a chevron. */
  onPress?: () => void;
  /** Expandable detail shown under the row (indented 70). The row toggles it. */
  body?: ReactNode;
  /** Controlled expansion (with onToggle); otherwise the row keeps its own state. */
  expanded?: boolean;
  onToggle?: () => void;
  titleWeight?: 'bold' | 'regular';
  /** Custom content on the right (instead of, or as well as, value and action). */
  right?: ReactNode;
  /** Extra content under the note. */
  children?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const [openLocal, setOpenLocal] = useState(false);
  const expandable = body != null && body !== false;
  const open = expandedProp ?? openLocal;
  const toggle = onToggle ?? (() => setOpenLocal((o) => !o));
  const press = expandable ? toggle : onPress;
  const tappable = !!press && !disabled;
  const valueColors: Record<ValueTone, string> = {
    muted: theme.textMuted,
    text: theme.text,
    good: theme.success,
    warn: theme.warning,
    bad: theme.danger,
    accent: theme.accent,
  };
  const hasLead = !!(icon || avatar || date);
  const label = accessibilityLabel ?? [title, typeof note === 'string' ? note : null, value].filter(Boolean).join(', ');

  const inner = (
    <>
      {date ? <DateChip top={date.top} num={date.num} /> : null}
      {icon && !date ? <IconCircle icon={icon} tone={tone} /> : null}
      {avatar && !icon && !date ? <Avatar name={avatar} color={avatarFill ?? avatarColor(avatar)} size={38} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[styles.rowTitle, titleWeight === 'regular' && { ...font('sans'), fontWeight: '400' }, { color: theme.text }]}>{title}</Text>
        {note ? typeof note === 'string' ? <Txt variant="note">{note}</Txt> : note : null}
        {progress != null ? (
          <View style={{ marginTop: 6 }}>
            <ProgressBar value={progress} color={progressColor} />
          </View>
        ) : null}
        {children}
      </View>
      {value ? (
        <Text style={[font('sans', 'bold'), styles.rowValue, { color: valueColors[valueTone] }, valueSize ? { fontSize: valueSize } : null]}>
          {value}
        </Text>
      ) : null}
      {right}
      {action ? (
        <Button
          title={action.label}
          size="sm"
          variant={action.variant ?? 'secondary'}
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityLabel={action.accessibilityLabel}
        />
      ) : null}
      {expandable ? (
        <Icon name={open ? 'expand_less' : 'expand_more'} size={20} color={theme.chevron} />
      ) : onPress ? (
        <Icon name="chevron_right" size={20} color={theme.chevron} />
      ) : null}
    </>
  );

  return (
    <View>
      {tappable ? (
        <Pressable
          onPress={press}
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={expandable ? { expanded: open } : undefined}
          aria-expanded={expandable ? open : undefined}
          style={({ pressed }) => [styles.row, { backgroundColor: hover || pressed ? theme.rowHover : 'transparent' }, webStyle({ cursor: 'pointer' })]}>
          {inner}
        </Pressable>
      ) : (
        <View style={styles.row}>{inner}</View>
      )}
      {expandable && open ? (
        <View style={[styles.rowBody, { paddingLeft: hasLead ? 70 : 18 }]}>
          {typeof body === 'string' ? <Txt style={{ fontSize: 14.5, lineHeight: 22.5, color: theme.textBody }}>{body}</Txt> : body}
        </View>
      ) : null}
    </View>
  );
}

/** Alias of GroupRow. */
export const ListRow = GroupRow;

// ---------------------------------------------------------------------------
// Notice, prose, empty and loading states
// ---------------------------------------------------------------------------

export type NoticeTone = 'info' | 'warn' | 'good' | 'danger';

const NOTICE_ICONS: Record<NoticeTone, IconName> = { info: 'info', warn: 'schedule', good: 'check_circle', danger: 'report' };

/**
 * A tinted notice: info (sand / gold-brown), warn (amber), good (green), danger (red). Title, body and an
 * optional underlined link. Replaces Banner.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  icon,
  link,
  style,
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  icon?: IconName;
  link?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [bg, fg] =
    tone === 'warn'
      ? [theme.warningBg, theme.warning]
      : tone === 'good'
        ? [theme.successBg, theme.success]
        : tone === 'danger'
          ? [theme.dangerBg, theme.danger]
          : [theme.sand, theme.accent];
  const plain = typeof children === 'string' || typeof children === 'number' || Array.isArray(children);
  return (
    <View style={[styles.notice, { backgroundColor: bg }, style]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? NOTICE_ICONS[tone]} size={22} color={fg} />
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <Text style={[font('sans', 'bold'), { fontSize: 15.5, lineHeight: 21, color: fg }]}>{title}</Text> : null}
        {children != null && children !== false ? (
          plain ? <Text style={[font('sans'), { fontSize: 14.5, lineHeight: 21.75, color: theme.textBody }]}>{children}</Text> : children
        ) : null}
        {link ? (
          <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <Pressable onPress={link.onPress} accessibilityRole="link" hitSlop={10} style={webStyle({ cursor: 'pointer' })}>
              <Text style={[font('sans', 'bold'), { fontSize: 14, color: fg, textDecorationLine: 'underline' }]}>{link.label}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Older banner API, drawn as a Notice (success → good, warning → warn). */
export function Banner({
  children,
  tone = 'info',
  icon,
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  icon?: IconName;
}) {
  const map = { info: 'info', success: 'good', warning: 'warn', danger: 'danger' } as const;
  // The old default icon was the sparkle; keep the tone's own icon unless another was asked for.
  return (
    <Notice tone={map[tone]} icon={icon && icon !== 'sparkle' ? icon : undefined}>
      {children}
    </Notice>
  );
}

/** A white card of reading text: Georgia title, optional byline, 15.5/1.6 paragraphs. */
export function Prose({ title, by, paragraphs, children }: { title?: string; by?: string; paragraphs?: string[]; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.prose, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      {title ? (
        <Txt variant="groupTitle" accessibilityRole="header">
          {title}
        </Txt>
      ) : null}
      {by ? <Txt variant="small">{by}</Txt> : null}
      {(paragraphs ?? []).map((p, i) => (
        <Text key={i} style={[font('sans'), styles.proseText, { color: theme.textProse }]}>
          {p}
        </Text>
      ))}
      {typeof children === 'string' ? <Text style={[font('sans'), styles.proseText, { color: theme.textProse }]}>{children}</Text> : children}
    </View>
  );
}

export function EmptyState({ icon = 'sparkle', title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.prose,
        { backgroundColor: theme.surface, borderColor: theme.hairline, alignItems: 'center', paddingVertical: Spacing.five, paddingHorizontal: Spacing.four, gap: 10 },
      ]}>
      <IconCircle icon={icon} size={56} />
      <Txt variant="groupTitle" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <View style={{ width: 40, height: 1, backgroundColor: theme.gold }} />
      {message ? (
        <Txt variant="muted" style={{ textAlign: 'center', maxWidth: 380 }}>
          {message}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: Spacing.two }}>{action}</View> : null}
    </View>
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
  // A change refused while an admin is viewing as someone else is expected, not an error: keep it calm.
  if (isViewOnlyError(error)) {
    return (
      <Notice tone="info" icon="visibility">
        {VIEW_ONLY_MESSAGE}
      </Notice>
    );
  }
  return <Notice tone="danger">{politeError(error instanceof Error ? error.message : String(error))}</Notice>;
}

// ---------------------------------------------------------------------------
// Page tops: Hero and PageHeader
// ---------------------------------------------------------------------------

/**
 * The home hero: sand panel with a kicker (the date), a Georgia greeting, a 40×1 gold rule and a warm line.
 * On phones it bleeds to the screen edges (and under the status bar) with only its bottom corners rounded;
 * on desktop it is a 26-radius card. Use it as the first block of a Screen with `topInset`.
 */
export function Hero({ kicker, title, line, right, children }: { kicker?: string; title: string; line?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  const theme = useTheme();
  const { wide, padX, padTop } = useScreenMetrics();
  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: theme.sand },
        wide
          ? { borderRadius: Radius.hero, paddingVertical: 40, paddingHorizontal: 44 }
          : {
              borderBottomLeftRadius: Radius.heroPhone,
              borderBottomRightRadius: Radius.heroPhone,
              marginHorizontal: -padX,
              marginTop: -padTop,
              paddingTop: padTop + 10,
              paddingHorizontal: 22,
              paddingBottom: 30,
            },
      ]}>
      <View style={styles.heroTop}>
        {kicker ? <Txt variant="kicker">{kicker}</Txt> : <View />}
        {right}
      </View>
      <Txt variant="display" accessibilityRole="header">
        {title}
      </Txt>
      <View style={{ width: 40, height: 1, backgroundColor: theme.gold }} />
      {line ? (
        typeof line === 'string' ? (
          <Text style={[font('sans'), { fontSize: 17, lineHeight: 25.5, color: theme.textWarm, maxWidth: 560 }]}>{line}</Text>
        ) : (
          line
        )
      ) : null}
      {children}
    </View>
  );
}

/** Back pill: 36 tall, white, hairline border (gold on hover). Goes back, or to `fallback` when there is no history. */
export function BackPill({ label = 'Back', onPress, fallback }: { label?: string; onPress?: () => void; fallback?: Href }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const go =
    onPress ??
    (() => {
      if (router.canGoBack()) router.back();
      else if (fallback) router.replace(fallback);
    });
  return (
    <Pressable
      onPress={go}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.backPill,
        { backgroundColor: theme.surface, borderColor: hover || pressed ? theme.gold : theme.border },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <Icon name="arrow_back" size={18} color={theme.text} weight={400} />
      <Text style={[font('sans', 'bold'), { fontSize: 14, color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The top of an inner page (with the native header hidden): optional Back pill, kicker, Georgia title
 * (34 phone / 44 desktop) and a grey sub-line. `right` sits beside the kicker (e.g. search and inbox buttons).
 */
export function PageHeader({
  kicker,
  title,
  sub,
  back,
  right,
  children,
}: {
  kicker?: string;
  title: string;
  sub?: ReactNode;
  /** true for "Back", a string for a custom label, or full control. */
  back?: boolean | string | { label?: string; onPress?: () => void; fallback?: Href };
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { wide } = useScreenMetrics();
  const backProps = typeof back === 'object' ? back : typeof back === 'string' ? { label: back } : back ? {} : null;
  return (
    <View style={{ gap: 8, paddingTop: wide ? 0 : 8 }}>
      {backProps ? (
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          <BackPill {...backProps} />
        </View>
      ) : null}
      {kicker || right ? (
        <View style={styles.heroTop}>
          {kicker ? <Txt variant="kicker">{kicker}</Txt> : <View />}
          {right}
        </View>
      ) : null}
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      {sub ? typeof sub === 'string' ? <Txt variant="muted" style={{ fontSize: 15.5, lineHeight: 23, maxWidth: 640 }}>{sub}</Txt> : sub : null}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'danger' | 'ghost' | 'outline';

/** Lays out buttons: full width and stacked on phones, side by side at their own width on desktop. */
export function Actions({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const wide = useWide();
  return (
    <View style={[wide ? { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } : { flexDirection: 'column', alignItems: 'stretch', gap: 10 }, style]}>
      {Children.toArray(children).filter(Boolean)}
    </View>
  );
}

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
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  /** primary (noir with a gold hairline; `gold` is the same), secondary (white), danger (solid red), ghost, outline. */
  variant?: ButtonVariant;
  /** md: 50 tall; sm: the 34px compact pill (its touch area still reaches 44). */
  size?: 'sm' | 'md';
  icon?: IconName;
  /** An icon after the title, e.g. the forward chevron on a "Next" pager button. */
  iconAfter?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string; hoverBg?: string }> = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: theme.gold, hoverBg: theme.primaryHover },
    gold: { bg: theme.primary, fg: theme.onPrimary, border: theme.gold, hoverBg: theme.primaryHover },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.border },
    danger: { bg: theme.dangerSolid, fg: theme.onDangerSolid, border: theme.dangerSolid },
    ghost: { bg: 'transparent', fg: theme.accent, border: 'transparent' },
    outline: { bg: 'transparent', fg: theme.text, border: theme.gold },
  };
  // On a noir hero surface the light-scheme colours would vanish, so buttons invert there.
  const onHero = useContext(HeroSurface);
  if (onHero) {
    palette.primary = { bg: theme.onHero, fg: theme.hero, border: theme.gold };
    palette.gold = { bg: theme.onHero, fg: theme.hero, border: theme.gold };
    palette.secondary = { bg: 'transparent', fg: theme.onHero, border: theme.onHeroMuted };
    palette.outline = { bg: 'transparent', fg: theme.onHero, border: theme.gold };
    palette.ghost = { bg: 'transparent', fg: theme.onHero, border: 'transparent' };
  }
  const c = palette[variant];
  const inactive = disabled || loading;
  const sm = size === 'sm';
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={sm ? { top: 5, bottom: 5 } : undefined}
      style={({ pressed }) => [
        styles.button,
        sm && styles.buttonSm,
        { backgroundColor: (hover || pressed) && c.hoverBg && !inactive && !onHero ? c.hoverBg : c.bg, borderColor: c.border },
        (hover || pressed) && !inactive && !c.hoverBg && variant !== 'ghost' && { borderColor: theme.gold },
        pressed && { opacity: 0.9 },
        inactive && { opacity: 0.4 },
        webStyle({ cursor: inactive ? 'not-allowed' : 'pointer' }),
        style,
      ]}>
      {loading ? <ActivityIndicator color={c.fg} size="small" /> : icon ? <Icon name={icon} size={sm ? 16 : 19} color={c.fg} weight={400} /> : null}
      <Text style={[styles.buttonText, sm && { fontSize: 13.5 }, { color: c.fg }]} numberOfLines={1}>
        {title}
      </Text>
      {iconAfter && !loading ? <Icon name={iconAfter} size={sm ? 16 : 19} color={c.fg} weight={400} /> : null}
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
    gold: [theme.sand, theme.accent],
  };
  const [bg, fg] = colors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** A 40px choice pill: black with ivory text when selected. */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  error,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Draws the error border (the message comes from ChipField). */
  error?: boolean;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      aria-pressed={!!selected}
      hitSlop={{ top: 2, bottom: 2 }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? theme.primary : error ? theme.errorBorder : hover || pressed ? theme.gold : theme.border,
          backgroundColor: selected ? theme.primary : theme.surface,
        },
        disabled && { opacity: 0.4 },
        webStyle({ cursor: disabled ? 'not-allowed' : 'pointer' }),
      ]}>
      <Text style={[font('sans', 'bold'), { color: selected ? theme.onPrimary : theme.text, fontSize: 14.5, fontVariant: ['tabular-nums'] }]}>{label}</Text>
    </Pressable>
  );
}

/** "Please fill this in." / "Please choose one.": the prototypes' validation messages. */
export const FILL_IN = 'Please fill this in.';
export const CHOOSE_ONE = 'Please choose one.';

function FieldError({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text style={[font('sans', 'bold'), { fontSize: 13, lineHeight: 18, color: theme.danger }]} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

/** A labelled set of chips (single or multiple choice), with a hint and "Please choose one." on error. */
export function ChipField<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  error,
  disabled,
}: {
  label?: string;
  options: (T | { value: T; label: string })[];
  /** One value, or an array for multiple choice. */
  value: T | T[] | null | undefined;
  onChange: (v: T) => void;
  hint?: string;
  /** true shows "Please choose one."; a string shows that instead. */
  error?: boolean | string;
  disabled?: boolean;
}) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  const message = error === true ? CHOOSE_ONE : error || null;
  return (
    <View style={{ gap: 8 }} accessibilityLabel={label}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <Chip key={opt.value} label={opt.label} selected={selected(opt.value)} onPress={() => onChange(opt.value)} disabled={disabled} error={!!message} />;
        })}
      </View>
      {hint ? <Txt variant="small">{hint}</Txt> : null}
      {message ? <FieldError>{message}</FieldError> : null}
    </View>
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
              active && { backgroundColor: theme.surface, borderColor: theme.hairline },
              disabled && webStyle({ cursor: 'not-allowed' }),
            ]}>
            <Text style={[font('sans', 'bold'), { color: active ? theme.text : theme.textMuted, fontSize: 14 }]}>{o.label}</Text>
            {active ? <View style={[styles.segmentMarker, { backgroundColor: theme.gold }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Underlined text tabs (15 bold, 22 apart, a 2px gold line under the active one, a 1px baseline). On phones the
 * strip bleeds to the screen edges and scrolls sideways.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  accessibilityLabel,
}: {
  tabs: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const { wide, padX } = useScreenMetrics();
  // When the strip scrolls, keep the chosen tab fully in view and never leave a tab cut at the left edge: the strip
  // snaps so that it starts on a whole tab (the earliest one that still leaves the chosen tab visible).
  const scroller = useRef<ScrollView>(null);
  const spans = useRef<Record<string, { x: number; w: number }>>({});
  const [stripWidth, setStripWidth] = useState(0);
  const pad = wide ? 0 : padX;
  const order = tabs.map((t) => t.value).join('|');
  useEffect(() => {
    const values = order.split('|');
    const at = values.indexOf(value);
    const sel = spans.current[value];
    if (at < 0 || !sel || !stripWidth) return;
    let first = at;
    while (first > 0) {
      const prev = spans.current[values[first - 1]];
      if (!prev || sel.x + sel.w - prev.x + 2 * pad > stripWidth) break;
      first -= 1;
    }
    const start = spans.current[values[first]];
    scroller.current?.scrollTo({ x: first === 0 || !start ? 0 : Math.max(0, start.x - pad), animated: false });
  }, [value, order, stripWidth, pad]);
  return (
    <View style={[{ borderBottomWidth: 1, borderBottomColor: theme.border }, !wide && { marginHorizontal: -padX }]}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}
        contentContainerStyle={[{ gap: 22 }, !wide && { paddingHorizontal: padX }]}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}>
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <Pressable
              key={t.value}
              onLayout={(e) => {
                spans.current[t.value] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
              }}
              onPress={() => onChange(t.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-selected={active}
              accessibilityLabel={t.badge ? `${t.label}, ${t.badge}` : t.label}
              style={[styles.tab, { borderBottomColor: active ? theme.gold : 'transparent' }, webStyle({ cursor: 'pointer' })]}>
              <Text style={[font('sans', 'bold'), { fontSize: 15, color: active ? theme.text : theme.textMuted }]}>{t.label}</Text>
              {t.badge ? <CountBadge count={t.badge} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Alias of Tabs (handy in files that also import expo-router's Tabs). */
export const TabStrip = Tabs;

/** The 16px gold count pill used on tabs and in the rail. */
export function CountBadge({ count, size = 16 }: { count: number; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.count, { minWidth: size, height: size, borderRadius: size / 2, backgroundColor: theme.gold }]}>
      <Text style={[font('sans', 'bold'), { color: theme.onGold, fontSize: size >= 20 ? 11.5 : 10, lineHeight: size }]}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** A white card of form fields, 20 padding and 20 between fields, with an optional Georgia title above it. */
export function FieldsCard({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[{ gap: 12 }, style]}>
      {title ? (
        <Txt variant="groupTitle" accessibilityRole="header" style={{ paddingHorizontal: 2 }}>
          {title}
        </Txt>
      ) : null}
      <View style={[styles.fields, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>{children}</View>
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & {
  label: string;
  hint?: string;
  /** true shows "Please fill this in."; a string shows that message. Either draws the error border. */
  error?: boolean | string;
}) {
  const theme = useTheme();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const { onFocus, onBlur } = input;
  // A read-only field looks it: a muted surface and text, no gold focus ring, and it is announced as unavailable.
  const readOnly = input.editable === false;
  const message = error === true ? FILL_IN : error || null;
  return (
    <Pressable onPress={readOnly ? undefined : () => ref.current?.focus()} style={{ gap: 8 }} accessible={false}>
      <Txt variant="label">{label}</Txt>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityState={readOnly ? { disabled: true } : undefined}
        aria-invalid={message ? true : undefined}
        {...(readOnly ? ({ 'aria-readonly': true, tabIndex: -1 } as object) : null)}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          font('sans'),
          readOnly
            ? { backgroundColor: theme.surfaceAlt, borderColor: theme.border, color: theme.textMuted }
            : {
                backgroundColor: theme.inputFill,
                borderColor: message ? theme.errorBorder : focused ? theme.gold : theme.border,
                color: theme.text,
              },
          input.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12, lineHeight: 23 },
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
      {message ? <FieldError>{message}</FieldError> : null}
    </Pressable>
  );
}

/**
 * A 46×28 switch (green when on, warm grey when off) with an optional bold title and note to its left.
 * Announced as a switch. Prefer it to React Native's Switch in redesigned screens.
 */
export function Toggle({
  value,
  onValueChange,
  title,
  note,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  title?: string;
  note?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={note}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      aria-checked={value}
      style={[styles.toggleRow, disabled && { opacity: 0.4 }, webStyle({ cursor: disabled ? 'not-allowed' : 'pointer' })]}>
      {title || note ? (
        <View style={{ flex: 1, gap: 2 }}>
          {title ? <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text> : null}
          {note ? <Txt variant="note">{note}</Txt> : null}
        </View>
      ) : null}
      <View style={[styles.track, { backgroundColor: value ? theme.toggleOn : theme.toggleOff }]}>
        <View style={[styles.knob, { left: value ? 21 : 3 }, web ? webStyle({ boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s' }) : styles.knobShadow]} />
      </View>
    </Pressable>
  );
}

/** Colours for a React Native Switch, matching Toggle's green and warm-grey tracks. */
export function useSwitchColors(on: boolean) {
  const theme = useTheme();
  return {
    trackColor: { true: theme.toggleOn, false: theme.toggleOff },
    // React Native's Switch draws no knob shadow on the web, so an off knob is dark (text colour) to stand out from
    // the card; the on knob is white on the green track.
    thumbColor: on ? Brand.white : theme.text,
    // react-native-web paints the "on" thumb teal unless told otherwise.
    ...({ activeThumbColor: Brand.white, activeTrackColor: theme.toggleOn } as object),
  };
}

/**
 * Initials in a circle. Without a colour: white with a gold hairline and Georgia initials (the rail and hero
 * look); with one (e.g. avatarColor(name)): white bold initials on that colour.
 */
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
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color ?? theme.surface,
        borderWidth: color ? 0 : 1,
        borderColor: theme.gold,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={[color ? font('sans', 'bold') : font('serif'), { color: color ? Brand.white : theme.text, fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      style={{ height: 6, borderRadius: 3, backgroundColor: theme.rowDivider, overflow: 'hidden' }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color ?? theme.gold, borderRadius: 3 }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export const TOAST_MS = 3400;
type ToastFn = (message: string) => void;
const ToastContext = createContext<ToastFn>(() => undefined);

/** Show a short confirmation ("Recorded. Reem has the note.") at the bottom of the screen for 3.4 seconds. */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

/** The toast itself: noir, gold hairline, gold check. (Shown by useToast; exported for the kit page.) */
export function ToastCard({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.toast,
        { backgroundColor: Brand.noir, borderColor: 'rgba(201,168,76,0.6)' },
        web ? webStyle({ boxShadow: '0 10px 30px rgba(10,10,10,.25)' }) : styles.toastShadow,
      ]}>
      <Icon name="checkmark" size={18} color={theme.gold} weight={400} />
      <Text style={[font('sans'), { color: Brand.ivory, fontSize: 14.5, lineHeight: 20, flexShrink: 1 }]}>{message}</Text>
    </View>
  );
}

/** Hosts the toast. Mounted once, in the root layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<ToastFn>((m) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(m);
    if (!web) AccessibilityInfo.announceForAccessibility(m);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ToastContext.Provider value={show}>
      <View style={{ flex: 1 }}>
        {children}
        {/* Always mounted, so screen readers on the web hear each new message. */}
        <View
          pointerEvents="none"
          style={[styles.toastWrap, { bottom: wide ? 28 : 100 + insets.bottom }]}
          accessibilityLiveRegion="polite"
          {...({ role: 'status', 'aria-live': 'polite' } as object)}>
          {message ? <ToastCard message={message} /> : null}
        </View>
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  content: { width: '100%' },
  footer: { borderTopWidth: 1, paddingTop: Spacing.two },
  footerInner: { width: '100%', flexDirection: 'row', gap: Spacing.two },
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  half: { flexGrow: 1, flexShrink: 1, flexBasis: Layout.halfBasis, minWidth: 0 },
  full: { width: '100%' },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
  card: { borderRadius: Radius.card, borderWidth: 1, padding: 20, gap: Spacing.two },
  listItem: { paddingVertical: 14, paddingHorizontal: 18 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  figureCell: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  figure: { borderRadius: Radius.card, borderWidth: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 14, gap: 6, flexGrow: 1 },
  group: { borderRadius: Radius.card, borderWidth: 1, overflow: 'hidden' },
  groupNote: { paddingVertical: 15, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 18, minHeight: 52 },
  rowTitle: { ...font('sans', 'bold'), fontSize: 15.5, lineHeight: 21 },
  rowValue: { fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rowBody: { paddingRight: 18, paddingBottom: 16 },
  dateChip: { width: 44, alignItems: 'center', paddingVertical: 4, borderRadius: Radius.chip },
  dateTop: { fontSize: 10.5, lineHeight: 13, letterSpacing: 1.2, textTransform: 'uppercase' },
  notice: { flexDirection: 'row', gap: 12, paddingVertical: 16, paddingHorizontal: 18, borderRadius: Radius.card, alignItems: 'flex-start' },
  prose: { borderRadius: Radius.card, borderWidth: 1, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 18, gap: 10 },
  proseText: { fontSize: 15.5, lineHeight: 24.8 },
  hero: { gap: 12 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 20 },
  backPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 10, paddingRight: 14, borderRadius: Radius.pill, borderWidth: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    paddingHorizontal: 22,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  buttonSm: { minHeight: 34, height: 34, paddingHorizontal: 14, gap: 6 },
  buttonText: { ...font('sans', 'bold'), fontSize: 15 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  badgeText: { ...font('sans', 'bold'), fontSize: 11, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 1.1 },
  chip: { paddingHorizontal: 16, borderRadius: Radius.pill, borderWidth: 1, minHeight: 40, justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: Radius.pill, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 36,
  },
  segmentMarker: { position: 'absolute', bottom: 3, width: 18, height: 2, borderRadius: 1 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 2, marginBottom: -1, minHeight: 44 },
  count: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  fields: { borderRadius: Radius.card, borderWidth: 1, padding: 20, gap: 20 },
  input: { borderWidth: 1, borderRadius: Radius.input, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, minHeight: 48 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  track: { width: 46, height: 28, borderRadius: 14 },
  knob: { position: 'absolute', top: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF' },
  knobShadow: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: '7%' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 18, borderRadius: Radius.toast, borderWidth: 1, maxWidth: 560 },
  toastShadow: { shadowColor: '#0A0A0A', shadowOpacity: 0.25, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
});
