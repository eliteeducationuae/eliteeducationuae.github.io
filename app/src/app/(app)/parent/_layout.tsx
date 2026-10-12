import { useBillingBadge } from '@/components/parent/hooks';
import { RoleTabs } from '@/components/role-tabs';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

export default function ParentLayout() {
  return (
    <RoleTabs
      role="parent"
      variant="sand"
      railAction={{ title: 'Book a lesson', icon: 'event_available', href: '/book' }}
      tabs={[
        { name: 'index', title: 'Home', icon: 'home', headerShown: false },
        { name: 'progress', title: 'Progress', icon: 'monitoring', headerShown: false },
        { name: 'messages', title: 'Messages', icon: 'forum', unreadBadge: true, headerShown: false },
        { name: 'billing', title: 'Billing', icon: 'credit_card', badge: useBillingBadge, badgeNoun: 'to pay', headerShown: false },
        { name: 'account', title: 'Account', icon: 'person', headerShown: false },
      ]}
    />
  );
}
