import { Redirect, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';

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
}

/** Bottom tabs for one role; anyone signed in with a different role is sent back to their own home. */
export function RoleTabs({ role, tabs, inboxButton }: { role: Role; tabs: TabSpec[]; inboxButton?: boolean }) {
  const theme = useTheme();
  const { status, profile } = useSession();
  const unread = useUnreadCount();
  if (status === 'loading') return <Loading />;
  if (!profile || profile.role !== role) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: { backgroundColor: theme.tabBar, borderTopColor: theme.border },
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.background },
        headerRight: inboxButton
          ? () => (
              <Pressable
                onPress={() => router.push('/messages')}
                accessibilityRole="button"
                accessibilityLabel={unread ? `Messages, ${unread} unread` : 'Messages'}
                style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                <Icon name="chat" size={24} color={theme.text} />
                {unread ? (
                  <View style={{ position: 'absolute', top: 2, right: 8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: theme.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                    <Text style={{ color: theme.onGold, fontSize: 11, fontWeight: '800' }}>{unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            )
          : undefined,
      }}>
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
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
