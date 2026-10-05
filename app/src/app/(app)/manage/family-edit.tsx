import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { PackageCard } from '@/components/billing';
import { FamilyContactsSection } from '@/components/family-contacts';
import { FamilyCardAdmin } from '@/components/payments';
import { LoginHint } from '@/components/login-hint';
import { Button, ErrorNote, Field, ListItem, Loading, Screen, Section, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useFamilies, usePackages, useStudents } from '@/data/hooks';
import { studentSubjects } from '@/domain/enrolments';
import type { Family, FamilyStatus } from '@/domain/types';

export default function EditFamily() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const families = useFamilies();
  if (families.isLoading) return <Loading />;
  const existing = id ? families.data?.find((f) => f.id === id) : undefined;
  return <FamilyForm key={existing?.id ?? 'new'} existing={existing} />;
}

function FamilyForm({ existing }: { existing?: Family }) {
  const save = useAction(source.saveFamily);
  const students = useStudents();
  const enrolments = useEnrolments();
  const packages = usePackages(existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [parentName, setParentName] = useState(existing?.parentName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [status, setStatus] = useState<FamilyStatus>(existing?.status ?? 'active');
  // An existing family's contacts are edited in the Contacts section; the form keeps its main contact as it is.
  const valid = existing ? !!name.trim() : !!(name.trim() && parentName.trim() && /\S+@\S+/.test(email));
  const kids = existing ? (students.data ?? []).filter((s) => s.familyId === existing.id) : [];

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Add family'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={save.isPending}
          onPress={async () => {
            const saved = await save.mutateAsync([
              existing
                ? // The main contact's details are kept as they are now, so a change made in Contacts meanwhile is not undone.
                  { id: existing.id, name: name.trim(), parentName: existing.parentName, email: existing.email, phone: existing.phone, status }
                : { name: name.trim(), parentName: parentName.trim(), email: email.trim(), phone: phone.trim() || undefined, status },
            ]);
            if (existing) router.back();
            else router.replace({ pathname: '/students/edit', params: { familyId: saved.id } });
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? `${existing.name} family` : 'New family' }} />
      <Field label="Family name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="e.g. Al Mansoori" />
      {existing ? null : (
        <>
          <Field label="Main contact name" value={parentName} onChangeText={setParentName} autoCapitalize="words" />
          <Field
            label="Main contact email (invoices, reports and sign-in)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Field label="Main contact phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <LoginHint email={email} who="parent" name={parentName} />
        </>
      )}
      <Section title="Status">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'prospect', label: 'Prospect' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </Section>
      <ErrorNote error={save.error} />
      {existing ? (
        <>
          <FamilyContactsSection familyId={existing.id} editable intro="Contact changes are saved as soon as you make them." />
          <Section
            title="Students"
            action={<Button title="Add" icon="plus" size="sm" variant="ghost" onPress={() => router.push({ pathname: '/students/edit', params: { familyId: existing.id } })} />}>
            {kids.map((s) => (
              <ListItem key={s.id} title={s.fullName} subtitle={studentSubjects(enrolments.data ?? [], s.id) || 'No subjects yet'} onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })} />
            ))}
          </Section>
          <Section
            title="Lesson packages"
            action={<Button title="Sell" icon="tag" size="sm" variant="ghost" onPress={() => router.push({ pathname: '/manage/package-new', params: { familyId: existing.id } })} />}>
            <View style={{ gap: Spacing.two }}>
              {(packages.data ?? []).map((p) => (
                <PackageCard key={p.id} pkg={p} />
              ))}
            </View>
          </Section>
          <Section title="Card and autopay">
            <FamilyCardAdmin family={existing} />
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
