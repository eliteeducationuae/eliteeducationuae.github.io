import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, EmptyState, ListItem, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getSyllabus } from '@/data/curriculum';
import { useStudents } from '@/data/hooks';

export default function TutorStudents() {
  const students = useStudents();
  if (students.isLoading) return <Loading />;
  const list = [...(students.data ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return (
    <Screen onRefresh={() => students.refetch()} refreshing={students.isRefetching}>
      {list.length === 0 ? (
        <EmptyState icon="people" title="No students yet" message="Your students will appear here as soon as lessons with them are booked." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((s) => (
            <ListItem
              key={s.id}
              title={s.fullName}
              subtitle={`${getSyllabus(s.syllabusId)?.name ?? s.curriculum}${s.targetGrade ? ` · Target ${s.targetGrade}` : ''}`}
              left={<Avatar name={s.fullName} />}
              onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
