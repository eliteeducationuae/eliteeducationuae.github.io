import { Redirect, router } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, Spacing, type Palette } from '@/constants/theme';
import type { Role } from '@/domain/types';
import { useUnreadCount } from '@/data/hooks';
import { useSession } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Logo } from './logo';
import { Loading } from './ui';

export interface TabSpec {
  name: string;
  title: string;
  icon: IconName;
  /** Header title if different from the tab label. */
  header?: string;
  /** Show the unread-messages count on this tab. */
  unreadBadge?: boolean;
  /** Only in the desktop sidebar; on phones the screen is reached from elsewhere (e.g. More). */
  wideOnly?: boolean;
}

/** Screens at least this wide get a left sidebar instead of bottom tabs. */
export const SIDEBAR_MIN_WIDTH = 1024;

const SIDEBAR_WIDTH = 248;

const ROLE_NAMES: Record<Role, string> = {
  admin: 'Administrator',
  tutor: 'Tutor',
  parent: 'Parent',
  student: 'Student',
};

function HeaderButton({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <Icon name={icon} size={24} color={theme.text} />
      {badge ? (
        <View style={{ position: 'absolute', top: 2, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: theme.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={[font('sans', 'bold'), { color: theme.onGold, fontSize: 11 }]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Desktop sidebar: noir panel with the white logo, a gold rule and a gold marker on the active row. */
function Sidebar({ state, descriptors, navigation, specs, unread, theme }: BottomTabBarProps & { specs: TabSpec[]; unread: number; theme: Palette }) {
  const insets = useSafeAreaInsets();
  const profile = useSession((s) => s.profile);
  return (
    <View
      style={[
        sidebar.panel,
        { backgroundColor: theme.hero, borderRightColor: theme.border, paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.three },
      ]}>
      <Logo tone="white" width={120} />
      <View style={[sidebar.rule, { backgroundColor: theme.gold }]} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: Spacing.three, gap: 2 }} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // expo-router hides `href: null` screens with display: none.
          if (StyleSheet.flatten(options.tabBarItemStyle)?.display === 'none') return null;
          const spec = specs.find((t) => t.name === route.name);
          const focused = index === state.index;
          const label = spec?.title ?? (typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name));
          const badge = spec?.unreadBadge && unread ? unread : 0;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              aria-selected={focused}
              accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
              style={({ pressed }) => [sidebar.item, (pressed || focused) && { backgroundColor: 'rgba(249, 248, 245, 0.06)' }]}>
              <View style={[sidebar.marker, { backgroundColor: focused ? theme.gold : 'transparent' }]} />
              {spec ? <Icon name={spec.icon} size={20} color={theme.onHero} style={{ opacity: focused ? 1 : 0.62 }} /> : null}
              <Text style={[font('sans', focused ? 'bold' : 'regular'), sidebar.label, { color: theme.onHero, opacity: focused ? 1 : 0.72 }]} numberOfLines={1}>
                {label}
              </Text>
              {badge ? (
                <View style={[sidebar.badge, { backgroundColor: theme.gold }]}>
                  <Text style={[font('sans', 'bold'), { color: theme.onGold, fontSize: 11 }]}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {profile ? (
        <View style={[sidebar.footer, { borderTopColor: 'rgba(201, 168, 76, 0.35)' }]}>
          <Text style={[font('serif'), { color: theme.onHero, fontSize: 15 }]} numberOfLines={1}>
            {profile.fullName}
          </Text>
          <Text style={[font('sans', 'bold'), sidebar.caption, { color: theme.onHeroMuted }]}>{ROLE_NAMES[profile.role]}</Text>
        </View>
      ) : null}
    </View>
  );
}

const sidebar = StyleSheet.create({
  panel: { width: SIDEBAR_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  rule: { height: 1, marginHorizontal: Spacing.four, opacity: 0.7 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingRight: Spacing.three, paddingLeft: Spacing.four - 3 },
  marker: { width: 3, alignSelf: 'stretch', marginVertical: 8, marginRight: 4, borderRadius: 2 },
  label: { flex: 1, fontSize: 15.5, letterSpacing: 0.2 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: Spacing.four, paddingTop: Spacing.three, gap: 2 },
  caption: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4 },
});

/** Ctrl-K / Cmd-K opens search on the web. */
function useSearchShortcut(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') return;
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

/** Tabs for one role (bottom on phones, a sidebar on wide screens); other roles are sent back to their own home. */
export function RoleTabs({ role, tabs, inboxButton, search }: { role: Role; tabs: TabSpec[]; inboxButton?: boolean; search?: boolean }) {
  const theme = useTheme();
  const { status, profile } = useSession();
  const unread = useUnreadCount();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= SIDEBAR_MIN_WIDTH;
  useSearchShortcut(!!search && status === 'signed-in');
  if (status === 'loading') return <Loading />;
  if (!profile || profile.role !== role) return <Redirect href="/" />;

  return (
    <Tabs
      tabBar={wide ? (props) => <Sidebar {...props} specs={tabs} unread={unread} theme={theme} /> : undefined}
      screenOptions={{
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: wide
          ? { backgroundColor: theme.hero, width: SIDEBAR_WIDTH }
          : {
              backgroundColor: theme.tabBar,
              borderTopColor: theme.border,
              borderTopWidth: StyleSheet.hairlineWidth,
              // Room for the gold marker and Carlito labels (the default 49 clips them).
              height: 58 + insets.bottom,
              paddingTop: 4,
            },
        tabBarLabelStyle: [font('sans', 'bold'), { fontSize: 11.5, lineHeight: 14, letterSpacing: 0.2 }],
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: wide ? 'beside-icon' : undefined,
        headerStyle: { backgroundColor: theme.surface, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
        headerTitleStyle: { ...font('serif'), fontSize: 19, color: theme.text },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.background },
        headerRight:
          inboxButton || search
            ? () => (
                <View style={{ flexDirection: 'row', paddingRight: 4 }}>
                  {search ? <HeaderButton icon="search" label={Platform.OS === 'web' ? 'Search (Ctrl K)' : 'Search'} onPress={() => router.push('/search')} /> : null}
                  {inboxButton ? (
                    <HeaderButton icon="chat" label={unread ? `Messages, ${unread} unread` : 'Messages'} badge={unread} onPress={() => router.push('/messages')} />
                  ) : null}
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
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{ alignItems: 'center' }}>
                <Icon name={t.icon} size={size - 2} color={String(color)} />
                {!wide && focused ? <View style={[tabMarker, { backgroundColor: theme.gold }]} /> : null}
              </View>
            ),
            tabBarBadge: t.unreadBadge && unread ? unread : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.gold, color: theme.onGold },
          }}
        />
      ))}
    </Tabs>
  );
}

/** Short Champagne Gold marker above the active bottom-tab icon. */
const tabMarker = { position: 'absolute', top: -7, width: 20, height: 2, borderRadius: 1 } as const;
