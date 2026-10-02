import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Button, ListItem, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePackages, useStudents, useFamilies } from '@/data/hooks';
import { packageRemaining } from '@/domain/billing';

export default function Families() {
  const families = useFamilies();
  const students = useStudents();
  const packages = usePackages();
  return (
    <Screen footer={<Button title="Add family" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/manage/family-edit')} />}>
      {families.isLoading ? (
        <Loading />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {(families.data ?? []).map((f) => {
            const kids = (students.data ?? []).filter((s) => s.familyId === f.id).map((s) => s.fullName.split(' ')[0]);
            const credits = (packages.data ?? []).filter((p) => p.familyId === f.id).reduce((n, p) => n + packageRemaining(p), 0);
            return (
              <ListItem
                key={f.id}
                title={`${f.name} family`}
                subtitle={`${f.parentName} · ${kids.join(', ') || 'no students yet'}${credits ? ` · ${credits} lesson credits` : ''}`}
                left={<Avatar name={f.parentName} />}
                onPress={() => router.push({ pathname: '/manage/family-edit', params: { id: f.id } })}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}
