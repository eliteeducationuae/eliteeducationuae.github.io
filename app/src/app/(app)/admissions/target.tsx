import { Stack, useLocalSearchParams } from 'expo-router';

import { TargetForm } from '@/components/admissions/item-forms';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useAdmissionsCase, useAdmissionsTargets } from '@/data/hooks';

/** Add or edit a school or university on a case's shortlist. ?caseId=&id= */
export default function AdmissionsTargetScreen() {
  const { caseId, id } = useLocalSearchParams<{ caseId: string; id?: string }>();
  const c = useAdmissionsCase(caseId);
  const targets = useAdmissionsTargets(caseId);
  if (c.isLoading || targets.isLoading) return <Loading />;
  const existing = id ? targets.data?.find((t) => t.id === id) : undefined;
  if (!c.data || (id && !existing)) {
    return (
      <Screen>
        <EmptyState icon="school" title="Not found" message="This shortlist entry may have been removed." />
      </Screen>
    );
  }
  const nextSort = Math.max(-1, ...(targets.data ?? []).map((t) => t.sort)) + 1;
  return (
    <>
      <Stack.Screen options={{ title: existing ? existing.institution : 'Add institution' }} />
      <TargetForm key={existing?.updatedAt ?? 'new'} c={c.data} existing={existing} nextSort={nextSort} />
    </>
  );
}
