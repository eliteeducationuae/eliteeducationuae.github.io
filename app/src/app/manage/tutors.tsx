import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Button, ListItem, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';

export default function Tutors() {
  const tutors = useTutors();
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
              onPress={() => router.push({ pathname: '/manage/tutor-edit', params: { id: t.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
