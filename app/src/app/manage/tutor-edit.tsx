import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useTutors } from '@/data/hooks';
import type { Tutor } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

const COLORS = ['#2b6cb0', '#c05621', '#2f855a', '#6b46c1', '#b83280', '#2c7a7b', '#975a16', '#1a365d'];
const SUBJECTS = ['IB', 'IGCSE', 'A-Level'];

export default function EditTutor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tutors = useTutors();
  if (tutors.isLoading) return <Loading />;
  const existing = id ? tutors.data?.find((t) => t.id === id) : undefined;
  return <TutorForm key={existing?.id ?? 'new'} existing={existing} />;
}

function TutorForm({ existing }: { existing?: Tutor }) {
  const theme = useTheme();
  const save = useAction(source.saveTutor);
  const [fullName, setFullName] = useState(existing?.fullName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [pay, setPay] = useState(existing ? String(existing.hourlyPay) : '');
  const [subjects, setSubjects] = useState<string[]>(existing?.subjects ?? []);
  const [color, setColor] = useState(existing?.color ?? COLORS[0]);
  const valid = fullName.trim() && /\S+@\S+/.test(email) && Number(pay) >= 0 && pay !== '';

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Add tutor'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={save.isPending}
          onPress={async () => {
            await save.mutateAsync([
              { id: existing?.id, fullName: fullName.trim(), email: email.trim(), phone: phone.trim() || undefined, hourlyPay: Number(pay), subjects, color },
            ]);
            router.back();
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? 'Edit tutor' : 'New tutor' }} />
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Pay per hour (AED)" value={pay} onChangeText={setPay} keyboardType="decimal-pad" />
      <Section title="Teaches">
        <Row gap={Spacing.one} wrap>
          {SUBJECTS.map((s) => (
            <Chip key={s} label={s} selected={subjects.includes(s)} onPress={() => setSubjects((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} />
          ))}
        </Row>
      </Section>
      <Section title="Calendar colour">
        <Row gap={Spacing.two} wrap>
          {COLORS.map((c) => (
            <Pressable key={c} onPress={() => setColor(c)} accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: color === c }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: 3, borderColor: color === c ? theme.text : 'transparent' }} />
            </Pressable>
          ))}
        </Row>
      </Section>
      <ErrorNote error={save.error} />
    </Screen>
  );
}
