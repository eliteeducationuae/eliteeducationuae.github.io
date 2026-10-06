import { RoleTabs } from '@/components/role-tabs';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

export default function AdminLayout() {
  return (
    <RoleTabs
      role="admin"
      inboxButton
      search
      tabs={[
        { name: 'index', title: 'Today', icon: 'home', header: 'Dashboard' },
        { name: 'calendar', title: 'Calendar', icon: 'calendar' },
        { name: 'students', title: 'Students', icon: 'people' },
        { name: 'billing', title: 'Billing', icon: 'card' },
        { name: 'money', title: 'Money', icon: 'money', wideOnly: true },
        { name: 'insights', title: 'Insights', icon: 'trend', wideOnly: true },
        { name: 'reports', title: 'Reports', icon: 'book', header: 'Student reports', wideOnly: true },
        { name: 'more', title: 'More', icon: 'more' },
      ]}
    />
  );
}
