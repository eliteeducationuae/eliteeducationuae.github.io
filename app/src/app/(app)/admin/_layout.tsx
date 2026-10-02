import { RoleTabs } from '@/components/role-tabs';

export default function AdminLayout() {
  return (
    <RoleTabs
      role="admin"
      inboxButton
      tabs={[
        { name: 'index', title: 'Today', icon: 'home', header: 'Dashboard' },
        { name: 'calendar', title: 'Calendar', icon: 'calendar' },
        { name: 'students', title: 'Students', icon: 'people' },
        { name: 'billing', title: 'Billing', icon: 'card' },
        { name: 'more', title: 'More', icon: 'more' },
      ]}
    />
  );
}
