import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { PackageCard } from '@/components/billing';
import { Button, ErrorNote, Field, ListItem, Loading, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useFamilies, usePackages, useStudents } from '@/data/hooks';
import type { Family } from '@/domain/types';

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
  const packages = usePackages(existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [parentName, setParentName] = useState(existing?.parentName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const valid = name.trim() && parentName.trim() && /\S+@\S+/.test(email);
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
              { id: existing?.id, name: name.trim(), parentName: parentName.trim(), email: email.trim(), phone: phone.trim() || undefined },
            ]);
            if (existing) router.back();
            else router.replace({ pathname: '/students/edit', params: { familyId: saved.id } });
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? `${existing.name} family` : 'New family' }} />
      <Field label="Family name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="e.g. Al Mansoori" />
      <Field label="Parent / guardian" value={parentName} onChangeText={setParentName} autoCapitalize="words" />
      <Field label="Email (for invoices and reports)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Phone / WhatsApp" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <ErrorNote error={save.error} />
      {existing ? (
        <>
          <Section
            title="Students"
            action={<Button title="Add" icon="plus" size="sm" variant="ghost" onPress={() => router.push({ pathname: '/students/edit', params: { familyId: existing.id } })} />}>
            {kids.map((s) => (
              <ListItem key={s.id} title={s.fullName} subtitle={s.curriculum} onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })} />
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
        </>
      ) : null}
    </Screen>
  );
}
