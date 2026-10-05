import { router, Stack, useLocalSearchParams } from 'expo-router';

import { CaseForm } from '@/components/admissions/case-form';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useAdmissionsCase } from '@/data/hooks';

/** Open (admin) or edit an admissions case. ?id= to edit, ?studentId= to prefill a new case. */
export default function AdmissionsCaseEdit() {
  const { id, studentId } = useLocalSearchParams<{ id?: string; studentId?: string }>();
  const existing = useAdmissionsCase(id);
  if (id && existing.isLoading) return <Loading />;
  if (id && !existing.data) {
    return (
      <Screen>
        <EmptyState icon="school" title="Case not found" />
      </Screen>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: id ? 'Edit case' : 'New admissions case' }} />
      <CaseForm
        key={existing.data?.updatedAt ?? 'new'}
        existing={existing.data ?? undefined}
        studentId={studentId}
        onSaved={(saved, created) =>
          created ? router.replace({ pathname: '/admissions/[id]', params: { id: saved.id } }) : router.back()
        }
      />
    </>
  );
}
