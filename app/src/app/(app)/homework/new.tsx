import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { HomeworkEditor, isValidDueDate, type HomeworkDraft } from '@/components/homework';
import { Button, Chip, EmptyState, ErrorNote, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useStudents } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, toDateKey } from '@/domain/dates';

/** Tutors and admin set homework for one student, outside of recording a lesson. */
export default function NewHomework() {
  const params = useLocalSearchParams<{ studentId?: string }>();
  const me = useMe();
  const students = useStudents();
  const save = useAction(source.saveHomework);
  const [studentId, setStudentId] = useState<string | undefined>(params.studentId);
  const [draft, setDraft] = useState<HomeworkDraft>(() => ({ title: '', details: '', dueDate: toDateKey(addDays(new Date(), 7)), attachments: [] }));

  if (me.role !== 'admin' && me.role !== 'tutor') {
    return (
      <Screen>
        <EmptyState icon="book" title="For tutors only" message="Homework is set by your tutor." />
      </Screen>
    );
  }
  if (students.isLoading) return <Loading />;
  const list = [...(students.data ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const student = list.find((s) => s.id === studentId);
  const valid = !!studentId && !!draft.title.trim() && isValidDueDate(draft.dueDate);

  async function submit() {
    if (!studentId) return;
    const saved = await save.mutateAsync([
      {
        studentId,
        title: draft.title.trim(),
        details: draft.details.trim() || undefined,
        dueDate: draft.dueDate,
        attachments: draft.attachments,
      },
    ]);
    router.replace(`/homework/${saved.id}`);
  }

  return (
    <Screen footer={<Button title="Set homework" icon="check" variant="gold" style={{ flex: 1 }} disabled={!valid} loading={save.isPending} onPress={submit} />}>
      {params.studentId && student ? (
        <Txt variant="h2">For {student.fullName}</Txt>
      ) : (
        <Section title="Student">
          {list.length === 0 ? <Txt variant="muted">You have no students yet.</Txt> : null}
          <Row gap={Spacing.one} wrap>
            {list.map((s) => (
              <Chip
                key={s.id}
                label={s.fullName}
                selected={s.id === studentId}
                onPress={() => {
                  if (s.id === studentId) return;
                  // Uploaded files live in each student's own folder, so only links and library items carry over.
                  setStudentId(s.id);
                  setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.kind === 'link' || !!a.resourceId) }));
                }}
              />
            ))}
          </Row>
        </Section>
      )}
      {studentId ? (
        <Section title="Homework">
          <HomeworkEditor studentId={studentId} value={draft} onChange={setDraft} />
        </Section>
      ) : (
        <Txt variant="muted">Please choose a student first, so that any files are kept in their folder.</Txt>
      )}
      <ErrorNote error={save.error} />
    </Screen>
  );
}
