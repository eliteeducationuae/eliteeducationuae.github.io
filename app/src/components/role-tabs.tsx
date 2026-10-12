/**
 * The navigation shell for each role: a bottom tab bar on phones and a left rail on desktop (window at least
 * Layout.wideMin wide). Two looks: `sand` (parent, tutor, accountant: paper tab bar, sand rail with the black logo)
 * and `noir` (admin: a floating noir pill on phones, a black rail with the white logo).
 */
import { Redirect, router, type Href } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, font, Layout } from '@/constants/theme';
import type { Role } from '@/domain/types';
import { useUnreadCount } from '@/data/hooks';
import { useSession, useViewing } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Logo } from './logo';
import { Avatar, Loading } from './ui';

export interface TabSpec {
  name: string;
  title: string;
  icon: IconName;
  /** Header title if different from the tab label. */
  header?: string;
  /**
   * Show the screen's native header (default true). Set false for redesigned screens that draw their own
   * Hero or PageHeader (pair it with <Screen topInset>).
   */
  headerShown?: boolean;
  /** Show the unread-messages count on this tab (shorthand for badge: useUnreadCount). */
  unreadBadge?: boolean;
  /**
   * A hook returning this tab's count (0 hides the badge), e.g. `badge: useLessonsToRecordCount`. It is called on
   * every render of the tab, so it must be a real hook with no conditions of its own.
   */
  badge?: () => number;
  /** Only in the desktop sidebar; on phones the screen is reached from elsewhere (e.g. More). */
  wideOnly?: boolean;
}

/** The rail footer's primary pill, e.g. "Book a lesson". Hidden while an admin is viewing as someone else. */
export interface RailAction {
  title: string;
  icon: IconName;
  href?: Href;
  onPress?: () => void;
}

/** The phone tab bar's centre button (the admin "+" that opens the concierge). */
export interface CentreAction {
  icon: IconName;
  /** Read by screen readers, e.g. "Open the concierge". */
  label: string;
  onPress: () => void;
}

/** Screens at least this wide get a left rail instead of bottom tabs. */
export const SIDEBAR_MIN_WIDTH = Layout.wideMin;

const ROLE_NAMES: Record<Role, string> = {
  admin: 'Administrator',
  tutor: 'Tutor',
  parent: 'Parent',
  student: 'Student',
  accountant: 'Accountant',
};

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

const useZero = () => 0;

/** A tab's badge count, from its spec (a hook, or the unread-messages shorthand). */
function useTabBadge(spec: TabSpec | undefined): number {
  const useCount = spec?.badge ?? (spec?.unreadBadge ? useUnreadCount : useZero);
  return useCount();
}

function HeaderButton({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, justifyContent: 'center' }}>
      <Icon name={icon} size={24} color={theme.text} />
      {badge ? (
        <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: theme.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={[font('sans', 'bold'), { color: theme.onGold, fontSize: 10 }]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Search and inbox buttons, as in the native header. Put them in a Hero's or PageHeader's `right` slot on
 * screens that hide the native header.
 */
export function HeaderActions({ search, inbox }: { search?: boolean; inbox?: boolean }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {search ? <SearchButton /> : null}
      {inbox ? <InboxButton /> : null}
    </View>
  );
}

function SearchButton() {
  return <HeaderButton icon="search" label={web ? 'Search (Ctrl K)' : 'Search'} onPress={() => router.push('/search')} />;
}

function InboxButton() {
  const unread = useUnreadCount();
  return <HeaderButton icon="forum" label={unread ? `Messages, ${unread} unread` : 'Messages'} badge={unread} onPress={() => router.push('/messages')} />;
}

type BarProps = BottomTabBarProps & {
  specs: TabSpec[];
  variant: 'sand' | 'noir';
  railAction?: RailAction;
  centreAction?: CentreAction;
};

/** The routes that get a tab (expo-router hides `href: null` screens with display: none). */
function visibleRoutes({ state, descriptors }: BottomTabBarProps) {
  return state.routes
    .map((route, index) => ({ route, index, options: descriptors[route.key].options }))
    .filter(({ options }) => StyleSheet.flatten(options.tabBarItemStyle)?.display !== 'none');
}

function tabPresser({ navigation }: BottomTabBarProps) {
  return (routeKey: string, name: string, params: object | undefined, focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: routeKey, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(name, params);
  };
}

// ---------------------------------------------------------------------------
// Desktop rail
// ---------------------------------------------------------------------------

function RailItem({
  spec,
  label,
  focused,
  noir,
  onPress,
  onLongPress,
}: {
  spec: TabSpec | undefined;
  label: string;
  focused: boolean;
  noir: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const badge = useTabBadge(spec);
  const [hover, setHover] = useState(false);
  const fg = noir ? Brand.ivory : theme.text;
  const opacity = focused ? 1 : noir ? 0.6 : 0.62;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      accessibilityLabel={badge ? `${label}, ${badge}${spec?.unreadBadge ? ' unread' : ''}` : label}
      style={[
        rail.item,
        {
          backgroundColor: focused
            ? noir
              ? 'rgba(249,248,245,0.06)'
              : theme.railActive
            : hover
              ? noir
                ? 'rgba(249,248,245,0.05)'
                : theme.railHover
              : 'transparent',
        },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <View style={[noir ? rail.markerNoir : rail.marker, { backgroundColor: focused ? Brand.gold : 'transparent' }]} />
      {spec ? (
        <View style={{ opacity }}>
          <Icon name={spec.icon} size={21} color={fg} />
        </View>
      ) : null}
      <Text
        style={[font('sans', focused && !noir ? 'bold' : 'regular'), rail.label, { color: fg, opacity }, noir && { letterSpacing: 0.3 }]}
        numberOfLines={1}>
        {label}
      </Text>
      {badge ? (
        noir ? (
          <Text style={[font('sans', 'bold'), { fontSize: 12, color: Brand.gold }]}>{badge}</Text>
        ) : (
          <View style={[rail.badge, { backgroundColor: theme.gold }]}>
            <Text style={[font('sans', 'bold'), { color: theme.onGold, fontSize: 11.5 }]}>{badge}</Text>
          </View>
        )
      ) : null}
    </Pressable>
  );
}

function Rail(props: BarProps) {
  const { state, navigation, specs, variant, railAction } = props;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const profile = useSession((s) => s.profile);
  const viewing = useViewing();
  const press = tabPresser(props);
  const noir = variant === 'noir';
  const [ctaHover, setCtaHover] = useState(false);
  const bg = noir ? Brand.noir : theme.rail;
  return (
    <View
      style={[
        rail.panel,
        {
          width: noir ? Layout.railWidthNoir : Layout.railWidth,
          backgroundColor: bg,
          borderRightColor: noir ? theme.heroBorder : theme.hairline,
          paddingTop: insets.top + (noir ? 28 : 30),
          paddingBottom: insets.bottom + 24,
        },
      ]}>
      <View style={{ paddingHorizontal: 28 }}>
        <Logo wide tone={noir ? 'white' : 'auto'} width={noir ? 148 : 150} />
      </View>
      <View style={[rail.rule, { backgroundColor: Brand.gold, opacity: noir ? 0.55 : 0.6 }]} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }} accessibilityRole="tablist">
        {visibleRoutes(props).map(({ route, index, options }) => {
          const spec = specs.find((t) => t.name === route.name);
          const focused = index === state.index;
          const label = spec?.title ?? (typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name));
          return (
            <RailItem
              key={route.key}
              spec={spec}
              label={label}
              focused={focused}
              noir={noir}
              onPress={() => press(route.key, route.name, route.params, focused)}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </ScrollView>
      {profile ? (
        <View style={[rail.footer, { borderTopColor: noir ? 'rgba(201,168,76,0.3)' : 'rgba(126,98,31,0.25)' }]}>
          {railAction && !viewing ? (
            <Pressable
              onPress={() => (railAction.onPress ? railAction.onPress() : railAction.href ? router.push(railAction.href) : undefined)}
              onHoverIn={() => setCtaHover(true)}
              onHoverOut={() => setCtaHover(false)}
              accessibilityRole="button"
              accessibilityLabel={railAction.title}
              style={[
                rail.cta,
                { backgroundColor: ctaHover ? theme.primaryHover : theme.primary, borderColor: Brand.gold },
                webStyle({ cursor: 'pointer' }),
              ]}>
              <Icon name={railAction.icon} size={19} color={theme.onPrimary} weight={400} />
              <Text style={[font('sans', 'bold'), { fontSize: 14.5, color: theme.onPrimary }]}>{railAction.title}</Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {noir ? (
              <View style={[rail.avatarNoir, { borderColor: Brand.gold }]}>
                <Text style={[font('serif'), { color: Brand.ivory, fontSize: 13 }]}>{initials(profile.fullName)}</Text>
              </View>
            ) : (
              <Avatar name={profile.fullName} size={38} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font('serif'), { color: noir ? Brand.ivory : theme.text, fontSize: noir ? 14.5 : 15 }]} numberOfLines={1}>
                {profile.fullName}
              </Text>
              <Text
                style={
                  noir
                    ? [font('sans', 'bold'), { fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.onHeroMuted }]
                    : [font('sans'), { fontSize: 12.5, color: theme.textMuted }]
                }>
                {ROLE_NAMES[profile.role]}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

const rail = StyleSheet.create({
  panel: { borderRightWidth: 1 },
  rule: { height: 1, marginTop: 24, marginBottom: 18, marginHorizontal: 28 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 46, paddingHorizontal: 28 },
  marker: { position: 'absolute', left: 0, top: 11, bottom: 11, width: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  markerNoir: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 2 },
  label: { flex: 1, fontSize: 15.5 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  footer: { marginHorizontal: 28, paddingTop: 16, borderTopWidth: 1, gap: 14 },
  cta: { height: 44, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  avatarNoir: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// ---------------------------------------------------------------------------
// Phone tab bar
// ---------------------------------------------------------------------------

function BarItem({
  spec,
  label,
  focused,
  noir,
  onPress,
  onLongPress,
}: {
  spec: TabSpec | undefined;
  label: string;
  focused: boolean;
  noir: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const badge = useTabBadge(spec);
  const color = noir ? Brand.ivory : focused ? theme.tabActive : theme.navInactive;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      accessibilityLabel={badge ? `${label}, ${badge}${spec?.unreadBadge ? ' unread' : ''}` : label}
      style={[bar.item, webStyle({ cursor: 'pointer' })]}>
      {spec ? (
        <View style={noir && { opacity: focused ? 1 : 0.55 }}>
          <Icon name={spec.icon} size={noir ? 23 : 24} color={color} weight={focused ? 500 : 300} />
        </View>
      ) : null}
      {noir ? (
        <>
          <View style={[bar.dot, { backgroundColor: focused ? Brand.gold : 'transparent' }]} />
          {/* Icon-only on screen; the label stays in the tab's text for find-in-page and tooling. */}
          <Text style={bar.hiddenLabel} importantForAccessibility="no" aria-hidden>
            {label}
          </Text>
        </>
      ) : (
        <Text style={[font('sans', 'bold'), bar.label, { color }]} numberOfLines={1}>
          {label}
        </Text>
      )}
      {badge ? (
        <View style={[bar.badge, { backgroundColor: Brand.gold }]}>
          <Text style={[font('sans', 'bold'), { color: Brand.noir, fontSize: 10, lineHeight: 16 }]}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function CentreButton({ action, noir }: { action: CentreAction; noir: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={[bar.centre, { borderColor: Brand.gold, backgroundColor: noir ? 'transparent' : theme.surface }, webStyle({ cursor: 'pointer' })]}>
      {/* Gold on noir; the deeper gold-brown on paper, where Champagne Gold is too faint for an icon. */}
      <Icon name={action.icon} size={26} color={noir ? Brand.gold : theme.accent} />
    </Pressable>
  );
}

function PhoneBar(props: BarProps) {
  const { state, navigation, specs, variant, centreAction } = props;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const press = tabPresser(props);
  const noir = variant === 'noir';
  const items = visibleRoutes(props).map(({ route, index, options }) => {
    const spec = specs.find((t) => t.name === route.name);
    const focused = index === state.index;
    const label = spec?.title ?? (typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name));
    return (
      <BarItem
        key={route.key}
        spec={spec}
        label={label}
        focused={focused}
        noir={noir}
        onPress={() => press(route.key, route.name, route.params, focused)}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      />
    );
  });
  // The centre action sits between the two halves of the tabs.
  const half = Math.ceil(items.length / 2);
  const row = centreAction ? [...items.slice(0, half), <CentreButton key="centre" action={centreAction} noir={noir} />, ...items.slice(half)] : items;

  if (noir) {
    return (
      <View style={{ backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 26), paddingTop: 10, paddingHorizontal: 16 }}>
        <View
          style={[
            bar.pill,
            { backgroundColor: Brand.noir, borderColor: theme.heroBorder },
            web ? webStyle({ boxShadow: '0 12px 30px rgba(10,10,10,.28)' }) : bar.pillShadow,
          ]}
          accessibilityRole="tablist">
          {row}
        </View>
      </View>
    );
  }
  return (
    <View
      style={[
        bar.paper,
        { backgroundColor: theme.tabBarPaper, borderTopColor: theme.hairline, paddingBottom: Math.max(insets.bottom, 24) },
        webStyle({ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }),
      ]}
      accessibilityRole="tablist">
      {row}
    </View>
  );
}

const bar = StyleSheet.create({
  paper: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 8, paddingHorizontal: 6, borderTopWidth: 1 },
  item: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 11.5, lineHeight: 14 },
  badge: { position: 'absolute', top: 2, left: '50%', marginLeft: 6, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  hiddenLabel: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  centre: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: 6 },
  pill: { height: 64, borderRadius: 32, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  pillShadow: { shadowColor: '#0A0A0A', shadowOpacity: 0.28, shadowRadius: 15, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
});

/** Ctrl-K / Cmd-K opens search on the web. */
function useSearchShortcut(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !web || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        router.push('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Tabs for one role (bottom on phones, a rail on wide screens); other roles are sent back to their own home.
 * - variant: 'sand' (default) or 'noir' (admin).
 * - railAction: the rail footer's primary pill (e.g. Book a lesson).
 * - centreAction: a round button in the middle of the phone tab bar (admin "+").
 */
export function RoleTabs({
  role,
  tabs,
  inboxButton,
  search,
  variant = 'sand',
  railAction,
  centreAction,
}: {
  role: Role;
  tabs: TabSpec[];
  inboxButton?: boolean;
  search?: boolean;
  variant?: 'sand' | 'noir';
  railAction?: RailAction;
  centreAction?: CentreAction;
}) {
  const theme = useTheme();
  const { status, profile } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= SIDEBAR_MIN_WIDTH;
  useSearchShortcut(!!search && status === 'signed-in');
  if (status === 'loading') return <Loading />;
  if (!profile || profile.role !== role) return <Redirect href="/" />;

  return (
    <Tabs
      tabBar={(props) =>
        wide ? (
          <Rail {...props} specs={tabs} variant={variant} railAction={railAction} centreAction={centreAction} />
        ) : (
          <PhoneBar {...props} specs={tabs} variant={variant} railAction={railAction} centreAction={centreAction} />
        )
      }
      screenOptions={{
        tabBarPosition: wide ? 'left' : 'bottom',
        headerStyle: { backgroundColor: theme.surface, borderBottomColor: theme.hairline, borderBottomWidth: StyleSheet.hairlineWidth },
        headerTitleStyle: { ...font('serif'), fontSize: 19, color: theme.text },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.background },
        headerRight:
          inboxButton || search
            ? () => (
                <View style={{ paddingRight: 4 }}>
                  <HeaderActions search={search} inbox={inboxButton} />
                </View>
              )
            : undefined,
      }}>
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            href: t.wideOnly && !wide ? null : undefined,
            title: t.header ?? t.title,
            tabBarLabel: t.title,
            headerShown: t.headerShown ?? true,
          }}
        />
      ))}
    </Tabs>
  );
}

/** Spacing helper kept for screens that measure the bar (the paper bar is 84 tall without a home indicator). */
export const TAB_BAR_HEIGHT = Layout.tabBarHeight;
