import { router } from 'expo-router';
import { useState } from 'react';

import { View } from 'react-native';

import { Avatar, Badge, Button, EmptyState, Field, ListItem, Loading, Screen, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getSyllabus } from '@/data/curriculum';
import { useLookup, useStudents } from '@/data/hooks';
import type { Curriculum } from '@/domain/types';

export default function AdminStudents() {
  const students = useStudents();
  const lookup = useLookup();
  const [query, setQuery] = useState('');
  const [curriculum, setCurriculum] = useState<'all' | Curriculum>('all');

  const q = query.trim().toLowerCase();
  const list = (students.data ?? [])
    .filter((s) => curriculum === 'all' || s.curriculum === curriculum)
    .filter(
      (s) =>
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        (lookup.family(s.familyId)?.parentName.toLowerCase().includes(q) ?? false) ||
        (s.school?.toLowerCase().includes(q) ?? false),
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <Screen
      onRefresh={() => students.refetch()}
      refreshing={students.isRefetching}
      footer={<Button title="Add student" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => router.push('/students/edit')} />}>
      <Field label="Search" placeholder="Student, parent or school" value={query} onChangeText={setQuery} autoCorrect={false} />
      <Segmented
        value={curriculum}
        onChange={setCurriculum}
        options={[
          { value: 'all', label: 'All' },
          { value: 'IB', label: 'IB' },
          { value: 'IGCSE', label: 'IGCSE' },
          { value: 'A-Level', label: 'A-Level' },
        ]}
      />
      {students.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState icon="people" title="No students found" />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((s) => (
            <ListItem
              key={s.id}
              title={s.fullName}
              subtitle={`${getSyllabus(s.syllabusId)?.name ?? s.curriculum}${s.school ? ` · ${s.school}` : ''}\nParent: ${lookup.family(s.familyId)?.parentName ?? '–'}`}
              left={<Avatar name={s.fullName} />}
              right={s.targetGrade ? <Badge label={`Target ${s.targetGrade}`} tone="info" /> : undefined}
              onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
