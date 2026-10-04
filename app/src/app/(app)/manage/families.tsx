import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Badge, Button, ListItem, Loading, Row, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useFamilies, useLoginEmails, usePackages, useStudents } from '@/data/hooks';
import { packageRemaining } from '@/domain/billing';

export default function Families() {
  const families = useFamilies();
  const students = useStudents();
  const packages = usePackages();
  const logins = new Set(useLoginEmails().data ?? []);
  return (
    <Screen footer={<Button title="Add family" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/manage/family-edit')} />}>
      {families.isLoading ? (
        <Loading />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {[...(families.data ?? [])].sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.name.localeCompare(b.name)).map((f) => {
            const kids = (students.data ?? []).filter((s) => s.familyId === f.id).map((s) => s.fullName.split(' ')[0]);
            const credits = (packages.data ?? []).filter((p) => p.familyId === f.id).reduce((n, p) => n + packageRemaining(p), 0);
            return (
              <ListItem
                key={f.id}
                title={`${f.name} family`}
                subtitle={`${f.status === 'prospect' ? 'Prospect · ' : f.status === 'archived' ? 'Archived · ' : ''}${f.parentName} · ${kids.join(', ') || 'no students yet'}${credits ? ` · ${credits} lesson credits` : ''}`}
                left={<Avatar name={f.parentName} />}
                below={
                  <Row gap={Spacing.one} wrap>
                    <Badge label={logins.has(f.email.toLowerCase()) ? 'Can log in' : 'No login yet'} tone={logins.has(f.email.toLowerCase()) ? 'success' : 'neutral'} />
                    {f.autopay ? <Badge label="Autopay" tone="gold" /> : null}
                  </Row>
                }
                onPress={() => router.push({ pathname: '/manage/family-edit', params: { id: f.id } })}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}
