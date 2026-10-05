import { RoleTabs } from '@/components/role-tabs';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

export default function TutorLayout() {
  return (
    <RoleTabs
      role="tutor"
      search
      tabs={[
        { name: 'index', title: 'Today', icon: 'home' },
        { name: 'calendar', title: 'Calendar', icon: 'calendar' },
        { name: 'students', title: 'Students', icon: 'people', header: 'My students' },
        { name: 'messages', title: 'Messages', icon: 'chat', unreadBadge: true },
        { name: 'account', title: 'Account', icon: 'person', header: 'My account' },
      ]}
    />
  );
}
