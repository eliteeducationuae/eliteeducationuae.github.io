import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { HomeworkEditor, isValidDueDate, type HomeworkDraft } from '@/components/homework';
import { Actions, Button, ChipField, EmptyState, ErrorNote, FieldsCard, Loading, Notice, PageHeader, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useStudents } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { addDays, toDateKey } from '@/domain/dates';
import { withoutClosed } from '@/domain/closed-accounts';

/** Tutors and admin set homework for one student, outside of recording a lesson. */
export default function NewHomework() {
  const params = useLocalSearchParams<{ studentId?: string }>();
  const me = useMe();
  const students = useStudents();
  const save = useAction(source.saveHomework);
  const [studentId, setStudentId] = useState<string | undefined>(params.studentId);
  const toast = useToast();
  const viewing = !!useViewing();
  const [tried, setTried] = useState(false);
  const [draft, setDraft] = useState<HomeworkDraft>(() => ({ title: '', details: '', dueDate: toDateKey(addDays(new Date(), 7)), attachments: [] }));

  const header = (title: string, sub?: string) => (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Homework" title={title} sub={sub} />
    </>
  );
  if (me.role !== 'admin' && me.role !== 'tutor') {
    return (
      <Screen topInset>
        {header('Set homework')}
        <EmptyState icon="book" title="For tutors only" message="Homework is set by your tutor." />
      </Screen>
    );
  }
  if (students.isLoading) return <Loading />;
  const list = withoutClosed(students.data).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const student = list.find((s) => s.id === studentId);
  const valid = !!studentId && !!draft.title.trim() && isValidDueDate(draft.dueDate);

  async function submit() {
    setTried(true);
    if (!studentId || !valid) return;
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
    toast(`Homework set. ${student?.fullName.split(' ')[0] ?? 'The student'} and the family have been told.`);
  }

  return (
    <Screen topInset>
      {header(student ? `For ${student.fullName}` : 'Set homework', student ? undefined : 'Choose a student first, so that any files are kept in their folder.')}
      {!(params.studentId && student) ? (
        <FieldsCard>
          {list.length === 0 ? (
            <Notice tone="info">You have no students yet.</Notice>
          ) : (
            <ChipField
              label="Student"
              options={list.map((s) => ({ value: s.id, label: s.fullName }))}
              value={studentId}
              error={tried && !studentId}
              onChange={(id) => {
                if (id === studentId) return;
                // Uploaded files live in each student's own folder, so only links and library items carry over.
                setStudentId(id);
                setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.kind === 'link' || !!a.resourceId) }));
              }}
            />
          )}
        </FieldsCard>
      ) : null}
      {studentId ? (
        <FieldsCard>
          <HomeworkEditor studentId={studentId} value={draft} onChange={setDraft} />
        </FieldsCard>
      ) : null}
      {tried && studentId && !draft.title.trim() ? <Notice tone="danger">Please give the homework a title.</Notice> : null}
      <ErrorNote error={save.error} />
      {!viewing ? (
        <Actions>
          <Button title="Set homework" icon="check" loading={save.isPending} onPress={submit} />
        </Actions>
      ) : null}
    </Screen>
  );
}
