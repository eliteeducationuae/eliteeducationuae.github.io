import { useLocalSearchParams } from 'expo-router';

import { BillForm } from '@/components/admissions/bill-form';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useAdmissionsCase } from '@/data/hooks';

/** Admin: raise an invoice for admissions advisory fees, linked to the case. ?caseId= */
export default function AdmissionsBill() {
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const c = useAdmissionsCase(caseId);
  if (c.isLoading) return <Loading />;
  if (!c.data) {
    return (
      <Screen>
        <EmptyState icon="school" title="Case not found" />
      </Screen>
    );
  }
  return <BillForm c={c.data} />;
}
