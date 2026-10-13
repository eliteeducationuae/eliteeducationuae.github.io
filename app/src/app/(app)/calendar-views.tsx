import { Redirect, Stack } from 'expo-router';

import { CalendarScreen } from '@/components/calendar-screen';
import { useMe } from '@/data/session';

/** The tutor's full calendar (day, timeline and week views), reached from the Calendar tab. */
export default function CalendarViews() {
  const me = useMe();
  if (me.role === 'admin') return <Redirect href="/admin/calendar" />;
  if (me.role !== 'tutor') return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ title: 'Day and week views' }} />
      <CalendarScreen canSchedule={false} perspective="tutor" />
    </>
  );
}
