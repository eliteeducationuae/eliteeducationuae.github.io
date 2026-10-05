import { Stack, useLocalSearchParams } from 'expo-router';

import { KeyDateForm } from '@/components/admissions/item-forms';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useAdmissionsCase, useAdmissionsKeyDates, useAdmissionsTargets } from '@/data/hooks';

/** Add or edit a key date (deadline, test, interview, open day, decision). ?caseId=&id=&targetId= */
export default function AdmissionsKeyDateScreen() {
  const { caseId, id, targetId } = useLocalSearchParams<{ caseId: string; id?: string; targetId?: string }>();
  const c = useAdmissionsCase(caseId);
  const targets = useAdmissionsTargets(caseId);
  const dates = useAdmissionsKeyDates({ caseId });
  if (c.isLoading || targets.isLoading || dates.isLoading) return <Loading />;
  const existing = id ? dates.data?.find((d) => d.id === id) : undefined;
  if (!c.data || (id && !existing)) {
    return (
      <Screen>
        <EmptyState icon="calendar" title="Not found" message="This key date may have been removed." />
      </Screen>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Key date' : 'Add a key date' }} />
      <KeyDateForm key={existing ? `${existing.id}:${existing.dueOn}:${existing.done}` : 'new'} c={c.data} existing={existing} targets={targets.data ?? []} presetTargetId={targetId} />
    </>
  );
}
