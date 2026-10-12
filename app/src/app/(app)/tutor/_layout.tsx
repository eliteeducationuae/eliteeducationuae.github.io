import { RoleTabs } from '@/components/role-tabs';
import { needsRecording, useAccountBadge, useMyLessons, useToRecordCount } from '@/components/tutor/common';

// Launch readiness: a calm, branded screen when something here fails to render.
export { ErrorBoundary } from '@/components/error-boundary';

export default function TutorLayout() {
  // The rail's call to action: record the oldest lesson still waiting, otherwise set homework.
  const { mine } = useMyLessons();
  const now = new Date();
  const toRecord = mine.find((l) => needsRecording(l, now));
  return (
    <RoleTabs
      role="tutor"
      search
      railAction={
        toRecord
          ? { title: 'Record a lesson', icon: 'edit_note', href: { pathname: '/complete/[id]', params: { id: toRecord.id } } }
          : { title: 'Set homework', icon: 'assignment', href: '/homework/new' }
      }
      tabs={[
        { name: 'index', title: 'Today', icon: 'home', headerShown: false, badge: useToRecordCount, badgeNoun: 'to record' },
        { name: 'calendar', title: 'Calendar', icon: 'calendar_month', headerShown: false },
        { name: 'students', title: 'Students', icon: 'group', headerShown: false },
        { name: 'messages', title: 'Messages', icon: 'forum', unreadBadge: true, headerShown: false },
        { name: 'account', title: 'Account', icon: 'person', headerShown: false, badge: useAccountBadge, badgeNoun: 'to do' },
      ]}
    />
  );
}
