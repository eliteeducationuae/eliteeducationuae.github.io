import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Badge, Button, ListItem, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLoginEmails, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';

export default function Tutors() {
  const tutors = useTutors();
  const logins = new Set(useLoginEmails().data ?? []);
  return (
    <Screen footer={<Button title="Add tutor" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/manage/tutor-edit')} />}>
      {tutors.isLoading ? (
        <Loading />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {(tutors.data ?? []).map((t) => (
            <ListItem
              key={t.id}
              title={t.fullName}
              subtitle={`${t.subjects.join(', ') || 'No subjects'} · ${formatAED(t.hourlyPay)}/hr`}
              left={<Avatar name={t.fullName} color={t.color} />}
              right={<Badge label={logins.has(t.email.toLowerCase()) ? 'Can log in' : 'No login yet'} tone={logins.has(t.email.toLowerCase()) ? 'success' : 'neutral'} />}
              onPress={() => router.push({ pathname: '/manage/tutor-edit', params: { id: t.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
