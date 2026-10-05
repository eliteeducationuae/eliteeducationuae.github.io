import { RoleTabs } from '@/components/role-tabs';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

export default function StudentLayout() {
  return (
    <RoleTabs
      role="student"
      tabs={[
        { name: 'index', title: 'Lessons', icon: 'calendar', header: 'My lessons' },
        { name: 'homework', title: 'Homework', icon: 'book' },
        { name: 'progress', title: 'Progress', icon: 'chart', header: 'My progress' },
        { name: 'account', title: 'Account', icon: 'person' },
      ]}
    />
  );
}
