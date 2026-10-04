import { SharedResources } from '@/components/resources';
import { HomeworkList } from '@/components/student-overview';
import { Screen } from '@/components/ui';
import { useHomework } from '@/data/hooks';
import { useMe } from '@/data/session';

export default function StudentHomework() {
  const me = useMe();
  const homework = useHomework(me.studentId);
  return (
    <Screen onRefresh={() => homework.refetch()} refreshing={homework.isRefetching}>
      <HomeworkList items={homework.data ?? []} loading={homework.isLoading} studentId={me.studentId} />
      <SharedResources studentId={me.studentId} />
    </Screen>
  );
}
