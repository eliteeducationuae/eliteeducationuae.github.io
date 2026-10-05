import { Stack, useLocalSearchParams } from 'expo-router';

import { TaskForm } from '@/components/admissions/item-forms';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useAdmissionsCase, useAdmissionsTargets, useAdmissionsTasks } from '@/data/hooks';

/** Add or edit a task for the family or the adviser. ?caseId=&id= */
export default function AdmissionsTaskScreen() {
  const { caseId, id } = useLocalSearchParams<{ caseId: string; id?: string }>();
  const c = useAdmissionsCase(caseId);
  const targets = useAdmissionsTargets(caseId);
  const tasks = useAdmissionsTasks(caseId);
  if (c.isLoading || targets.isLoading || tasks.isLoading) return <Loading />;
  const existing = id ? tasks.data?.find((t) => t.id === id) : undefined;
  if (!c.data || (id && !existing)) {
    return (
      <Screen>
        <EmptyState icon="check" title="Not found" message="This task may have been removed." />
      </Screen>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Task' : 'Add a task' }} />
      <TaskForm key={existing ? `${existing.id}:${existing.doneAt ?? ''}` : 'new'} c={c.data} existing={existing} targets={targets.data ?? []} />
    </>
  );
}
