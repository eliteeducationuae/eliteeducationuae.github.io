import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { EnrolmentEditor } from '@/components/enrolment-editor';
import { Banner, Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { queryClient } from '@/data/query';
import { useEnrolments, useFamilies, useStudents, useTutors } from '@/data/hooks';
import { PHASES } from '@/domain/catalogue';
import { activeEnrolments, draftFromEnrolment, validateEnrolments, type EnrolmentDraft } from '@/domain/enrolments';
import type { Enrolment, Student } from '@/domain/types';

export default function EditStudent() {
  const { id, familyId } = useLocalSearchParams<{ id?: string; familyId?: string }>();
  const students = useStudents();
  const families = useFamilies();
  const enrolments = useEnrolments(id);
  if (students.isLoading || families.isLoading || (id && enrolments.isLoading)) return <Loading />;
  const existing = id ? students.data?.find((s) => s.id === id) : undefined;
  return (
    <StudentForm
      key={existing?.id ?? 'new'}
      existing={existing}
      enrolments={existing ? activeEnrolments(enrolments.data ?? [], existing.id) : []}
      defaultFamilyId={familyId}
    />
  );
}

function StudentForm({ existing, enrolments, defaultFamilyId }: { existing?: Student; enrolments: Enrolment[]; defaultFamilyId?: string }) {
  const families = useFamilies();
  const tutors = useTutors();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fullName, setFullName] = useState(existing?.fullName ?? '');
  const [familyId, setFamilyId] = useState(existing?.familyId ?? defaultFamilyId ?? '');
  const [phase, setPhase] = useState<string | undefined>(existing?.phase);
  // Seeded once from the saved subjects; the form is keyed on the student, so this never needs an effect.
  const [drafts, setDrafts] = useState<EnrolmentDraft[]>(() => enrolments.map(draftFromEnrolment));
  const [school, setSchool] = useState(existing?.school ?? '');
  const [yearGroup, setYearGroup] = useState(existing?.yearGroup ?? '');
  const [currentGrade, setCurrentGrade] = useState(existing?.currentGrade ?? '');
  const [targetGrade, setTargetGrade] = useState(existing?.targetGrade ?? '');
  const [examDate, setExamDate] = useState(existing?.examDate ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  // Remembered after the first write, so retrying after a failed subject save updates rather than duplicates.
  const [savedId, setSavedId] = useState<string | undefined>(existing?.id);

  const valid = fullName.trim() && familyId && (!examDate || /^\d{4}-\d{2}-\d{2}$/.test(examDate));

  const submit = async () => {
    setError(null);
    const active = drafts.filter((d) => d.active);
    if (!savedId && !active.length) {
      setError(new Error('Please add at least one subject.'));
      return;
    }
    const problem = validateEnrolments(drafts);
    if (problem) {
      setError(new Error(problem));
      return;
    }
    setSaving(true);
    try {
      const saved = await source.saveStudent({
        id: savedId,
        fullName: fullName.trim(),
        familyId,
        // Legacy single-course fields are left exactly as they were; new students use subjects instead.
        curriculum: existing?.curriculum,
        syllabusId: existing?.syllabusId,
        phase,
        school: school.trim() || undefined,
        yearGroup: yearGroup.trim() || undefined,
        currentGrade: currentGrade.trim() || undefined,
        targetGrade: targetGrade.trim() || undefined,
        examDate: examDate.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setSavedId(saved.id);
      const next = [...drafts];
      for (const [i, d] of next.entries()) {
        if (!d.id && !d.active) continue;
        const e = await source.saveEnrolment({ ...d, subject: d.subject.trim(), studentId: saved.id });
        next[i] = { ...d, id: e.id };
        setDrafts([...next]);
      }
      await queryClient.invalidateQueries();
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Add student'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid || saving}
          loading={saving}
          onPress={submit}
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
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <Section title="Subjects">
        <EnrolmentEditor value={drafts} onChange={setDrafts} tutors={tutors.data ?? []} />
      </Section>
      <Field label="School" value={school} onChangeText={setSchool} />
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="Year 12" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Exam date" value={examDate} onChangeText={setExamDate} placeholder="For example, 2027-05-14" />
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
      <Field label="Tutor notes (staff only)" value={notes} onChangeText={setNotes} multiline placeholder="For example, learning style, goals, or anything tutors should know" />
      <ErrorNote error={error} />
    </Screen>
  );
}
