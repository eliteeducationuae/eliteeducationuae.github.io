import { RoleTabs } from '@/components/role-tabs';

export default function TutorLayout() {
  return (
    <RoleTabs
      role="tutor"
      tabs={[
        { name: 'index', title: 'Today', icon: 'home' },
        { name: 'calendar', title: 'Calendar', icon: 'calendar' },
        { name: 'students', title: 'Students', icon: 'people', header: 'My students' },
        { name: 'earnings', title: 'Pay', icon: 'money', header: 'My pay' },
        { name: 'account', title: 'Account', icon: 'person' },
      ]}
    />
  );
}
