import { View } from 'react-native';

import { ConciergeSheet } from '@/components/admin/concierge';
import { useConcierge } from '@/components/admin/concierge-store';
import { useDecisionCount } from '@/components/admin/decisions';
import { RoleTabs } from '@/components/role-tabs';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

/**
 * Admin: four tabs (Today, Diary, Ledger, Directory) in a noir rail or floating pill. The gold "+" on phones and
 * Ctrl/Cmd-K on desktop open the concierge; Messages sits under the tabs in the rail (and in Directory on phones).
 * Students is reached from Directory, so it keeps its route without a tab.
 */
export default function AdminLayout() {
  const show = useConcierge((s) => s.show);
  return (
    <View style={{ flex: 1 }}>
      <RoleTabs
        role="admin"
        variant="noir"
        inboxButton
        search
        onSearchShortcut={show}
        centreAction={{ icon: 'add', label: 'Open the concierge', onPress: () => show() }}
        railLinks={[{ title: 'Messages', icon: 'forum', href: '/messages', unreadBadge: true }]}
        tabs={[
          { name: 'index', title: 'Today', icon: 'wb_sunny', header: 'Today', headerShown: false, badge: useDecisionCount },
          { name: 'calendar', title: 'Diary', icon: 'calendar_month', headerShown: false },
          { name: 'billing', title: 'Ledger', icon: 'account_balance_wallet', headerShown: false },
          { name: 'more', title: 'Directory', icon: 'apps', headerShown: false },
          { name: 'students', title: 'Students', icon: 'school', hidden: true },
        ]}
      />
      <ConciergeSheet />
    </View>
  );
}
