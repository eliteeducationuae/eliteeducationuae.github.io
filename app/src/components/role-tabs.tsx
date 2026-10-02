import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import type { Role } from '@/domain/types';
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
}

/** Bottom tabs for one role; anyone signed in with a different role is sent back to their own home. */
export function RoleTabs({ role, tabs }: { role: Role; tabs: TabSpec[] }) {
  const theme = useTheme();
  const { status, profile } = useSession();
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
      }}>
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.header ?? t.title,
            tabBarLabel: t.title,
            tabBarIcon: ({ color, size }) => <Icon name={t.icon} size={size - 2} color={String(color)} />,
          }}
        />
      ))}
    </Tabs>
  );
}
