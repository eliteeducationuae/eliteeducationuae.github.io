import { router, Stack, useLocalSearchParams } from 'expo-router';

import { ContactEditor } from '@/components/family-contacts';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { useFamilyContacts } from '@/data/hooks';
import { useMe } from '@/data/session';

export default function EditContact() {
  const { familyId, id } = useLocalSearchParams<{ familyId: string; id?: string }>();
  const me = useMe();
  const allowed = !!familyId && (me.role === 'admin' || (me.role === 'parent' && me.familyId === familyId));
  const contacts = useFamilyContacts(allowed ? familyId : undefined);

  if (!allowed) {
    return (
      <Screen>
        <EmptyState icon="alert" title="This page is not available." />
      </Screen>
    );
  }
  if (contacts.isLoading) return <Loading />;
  const all = contacts.data ?? [];
  const existing = id ? all.find((c) => c.id === id) : undefined;
  if (id && !existing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Contact' }} />
        <EmptyState icon="people" title="Contact not found" message="This contact may have been removed." />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: existing ? existing.name : 'New contact' }} />
      <ContactEditor key={existing?.id ?? 'new'} familyId={familyId} existing={existing} all={all} onDone={() => router.back()} />
    </>
  );
}
