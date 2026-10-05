import { useLocalSearchParams } from 'expo-router';

import { AdvisoryUpdateScreen } from '@/components/admissions/update-editor';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useAdvisoryUpdates } from '@/data/hooks';

/** Write a new advisory update (?caseId=) or open one (?id=, also the notification deep link). */
export default function AdmissionsUpdateRoute() {
  const { id, caseId } = useLocalSearchParams<{ id?: string; caseId?: string }>();
  const updates = useAdvisoryUpdates();
  if (id && updates.isLoading) return <Loading />;
  const update = id ? updates.data?.find((u) => u.id === id) : undefined;
  const forCase = update?.caseId ?? caseId;
  if (!forCase) {
    return (
      <Screen>
        <EmptyState icon="mail" title="Update not found" message="This update may have been withdrawn, or it is not shared with you." />
      </Screen>
    );
  }
  return <AdvisoryUpdateScreen caseId={forCase} update={update} />;
}
