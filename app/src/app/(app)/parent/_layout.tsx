import { RoleTabs } from '@/components/role-tabs';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

export default function ParentLayout() {
  return (
    <RoleTabs
      role="parent"
      tabs={[
        { name: 'index', title: 'Home', icon: 'home' },
        { name: 'progress', title: 'Progress', icon: 'chart' },
        { name: 'messages', title: 'Messages', icon: 'chat', unreadBadge: true, header: 'Messages with Elite Education' },
        { name: 'billing', title: 'Billing', icon: 'card', header: 'Invoices and credits' },
        { name: 'account', title: 'Account', icon: 'person' },
      ]}
    />
  );
}
