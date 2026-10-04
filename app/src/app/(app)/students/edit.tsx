import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { SYLLABUSES } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useFamilies, useStudents } from '@/data/hooks';
import type { Curriculum, Student } from '@/domain/types';

export default function EditStudent() {
  const { id, familyId } = useLocalSearchParams<{ id?: string; familyId?: string }>();
  const students = useStudents();
  const families = useFamilies();
  if (students.isLoading || families.isLoading) return <Loading />;
  const existing = id ? students.data?.find((s) => s.id === id) : undefined;
  return <StudentForm key={existing?.id ?? 'new'} existing={existing} defaultFamilyId={familyId} />;
}

function StudentForm({ existing, defaultFamilyId }: { existing?: Student; defaultFamilyId?: string }) {
  const families = useFamilies();
  const save = useAction(source.saveStudent);
  const [fullName, setFullName] = useState(existing?.fullName ?? '');
  const [familyId, setFamilyId] = useState(existing?.familyId ?? defaultFamilyId ?? '');
  const [curriculum, setCurriculum] = useState<Curriculum>(existing?.curriculum ?? 'IB');
  const [syllabusId, setSyllabusId] = useState(existing?.syllabusId ?? '');
  const [school, setSchool] = useState(existing?.school ?? '');
  const [yearGroup, setYearGroup] = useState(existing?.yearGroup ?? '');
  const [currentGrade, setCurrentGrade] = useState(existing?.currentGrade ?? '');
  const [targetGrade, setTargetGrade] = useState(existing?.targetGrade ?? '');
  const [examDate, setExamDate] = useState(existing?.examDate ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const syllabuses = SYLLABUSES.filter((s) => s.curriculum === curriculum);
  const valid = fullName.trim() && familyId && syllabusId && (!examDate || /^\d{4}-\d{2}-\d{2}$/.test(examDate));

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Add student'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={save.isPending}
          onPress={async () => {
            await save.mutateAsync([
              {
                id: existing?.id,
                fullName: fullName.trim(),
                familyId,
                curriculum,
                syllabusId,
                school: school.trim() || undefined,
                yearGroup: yearGroup.trim() || undefined,
                currentGrade: currentGrade.trim() || undefined,
                targetGrade: targetGrade.trim() || undefined,
                examDate: examDate.trim() || undefined,
                notes: notes.trim() || undefined,
              },
            ]);
            router.back();
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? 'Edit student' : 'New student' }} />
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <Section
        title="Family"
        action={<Button title="New family" size="sm" variant="ghost" icon="plus" onPress={() => router.push('/manage/family-edit')} />}>
        {(families.data ?? []).length === 0 ? <Banner>Add the family first, then come back to add the student.</Banner> : null}
        <Row gap={Spacing.one} wrap>
          {(families.data ?? []).map((f) => (
            <Chip key={f.id} label={`${f.name} (${f.parentName})`} selected={familyId === f.id} onPress={() => setFamilyId(f.id)} />
          ))}
        </Row>
      </Section>
      <Section title="Course">
        <Segmented
          value={curriculum}
          onChange={(c) => {
            setCurriculum(c);
            setSyllabusId('');
          }}
          options={[
            { value: 'IB', label: 'IB' },
            { value: 'IGCSE', label: 'IGCSE' },
            { value: 'A-Level', label: 'A-Level' },
          ]}
        />
        <Row gap={Spacing.one} wrap>
          {syllabuses.map((s) => (
            <Chip key={s.id} label={s.name} selected={syllabusId === s.id} onPress={() => setSyllabusId(s.id)} />
          ))}
        </Row>
      </Section>
      <Field label="School" value={school} onChangeText={setSchool} />
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="Year 12" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Exam date" value={examDate} onChangeText={setExamDate} placeholder="YYYY-MM-DD" />
        </View>
      </Row>
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Current grade" value={currentGrade} onChangeText={setCurrentGrade} placeholder="5" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Target grade" value={targetGrade} onChangeText={setTargetGrade} placeholder="7" />
        </View>
      </Row>
      <Field label="Tutor notes (staff only)" value={notes} onChangeText={setNotes} multiline placeholder="Learning style, goals, anything tutors should know" />
      <ErrorNote error={save.error} />
    </Screen>
  );
}
