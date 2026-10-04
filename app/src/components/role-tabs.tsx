import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';

import type { Role } from '@/domain/types';
import { useUnreadCount } from '@/data/hooks';
import { useSession } from '@/data/session';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
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

function HeaderButton({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <Icon name={icon} size={24} color={theme.text} />
      {badge ? (
        <View style={{ position: 'absolute', top: 2, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: theme.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: theme.onGold, fontSize: 11, fontWeight: '800' }}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

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
  const wide = width >= SIDEBAR_MIN_WIDTH;
  useSearchShortcut(!!search && status === 'signed-in');
  if (status === 'loading') return <Loading />;
  if (!profile || profile.role !== role) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: wide
          ? { backgroundColor: theme.tabBar, borderRightColor: theme.border, width: 232, paddingTop: 12 }
          : { backgroundColor: theme.tabBar, borderTopColor: theme.border },
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: wide ? 'beside-icon' : undefined,
        headerStyle: { backgroundColor: theme.surface },
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
            tabBarIcon: ({ color, size }) => <Icon name={t.icon} size={size - 2} color={String(color)} />,
            tabBarBadge: t.unreadBadge && unread ? unread : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.gold, color: theme.onGold },
          }}
        />
      ))}
    </Tabs>
  );
}
