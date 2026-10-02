import { RoleTabs } from '@/components/role-tabs';

export default function ParentLayout() {
  return (
    <RoleTabs
      role="parent"
      tabs={[
        { name: 'index', title: 'Home', icon: 'home' },
        { name: 'progress', title: 'Progress', icon: 'chart' },
        { name: 'billing', title: 'Billing', icon: 'card', header: 'Invoices & credits' },
        { name: 'account', title: 'Account', icon: 'person' },
      ]}
    />
  );
}
