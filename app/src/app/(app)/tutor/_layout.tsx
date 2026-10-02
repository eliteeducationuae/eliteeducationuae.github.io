import { RoleTabs } from '@/components/role-tabs';

export default function TutorLayout() {
  return (
    <RoleTabs
      role="tutor"
      tabs={[
        { name: 'index', title: 'Today', icon: 'home' },
        { name: 'calendar', title: 'Calendar', icon: 'calendar' },
        { name: 'students', title: 'Students', icon: 'people', header: 'My students' },
        { name: 'messages', title: 'Messages', icon: 'chat', unreadBadge: true },
        { name: 'account', title: 'Me', icon: 'person', header: 'My account' },
      ]}
    />
  );
}
