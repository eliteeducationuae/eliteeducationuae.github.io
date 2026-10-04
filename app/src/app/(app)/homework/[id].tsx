import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AttachmentList } from '@/components/attachments';
import { HandInForm, HomeworkEditor, HomeworkStatusBadge, isValidDueDate, SubmissionCard, type HomeworkDraft } from '@/components/homework';
import { Button, Card, EmptyState, ErrorNote, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useHomeworkItem, useLookup, useSubmissions } from '@/data/hooks';
import { useMe } from '@/data/session';
import { dueLabel } from '@/domain/homework';
import type { Homework } from '@/domain/types';

/** One piece of homework: instructions and attachments, hand-ins, and tutor feedback. */
export default function HomeworkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const lookup = useLookup();
  const item = useHomeworkItem(id);
  const submissions = useSubmissions({ homeworkId: id });
  const save = useAction(source.saveHomework);
  const [draft, setDraft] = useState<HomeworkDraft | null>(null);
  const [handingIn, setHandingIn] = useState(false);
  const [now] = useState(() => new Date());

  if (item.isLoading) return <Loading />;
  const h = item.data;
  if (!h) {
    return (
      <Screen>
        <EmptyState icon="book" title="Homework not found" message="This homework may have been removed, or it belongs to another student." />
      </Screen>
    );
  }

  const staff = me.role === 'admin' || me.role === 'tutor';
  const family = me.role === 'student' || me.role === 'parent';
  const subs = [...(submissions.data ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const student = lookup.student(h.studentId);
  const attachments = h.attachments ?? [];

  function startEdit(hw: Homework) {
    save.reset();
    setDraft({ title: hw.title, details: hw.details ?? '', dueDate: hw.dueDate.slice(0, 10), attachments: hw.attachments ?? [] });
  }

  async function saveEdit(hw: Homework, d: HomeworkDraft) {
    await save.mutateAsync([
      {
        id: hw.id,
        studentId: hw.studentId,
        lessonId: hw.lessonId,
        title: d.title.trim(),
        details: d.details.trim() || undefined,
        dueDate: d.dueDate,
        attachments: d.attachments,
      },
    ]);
    setDraft(null);
  }

  return (
    <Screen onRefresh={() => Promise.all([item.refetch(), submissions.refetch()])} refreshing={item.isRefetching || submissions.isRefetching}>
      {draft ? (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="h2">Edit homework</Txt>
          <HomeworkEditor studentId={h.studentId} value={draft} onChange={setDraft} />
          <ErrorNote error={save.error} />
          <Row gap={Spacing.two} wrap>
            <Button
              title="Save changes"
              icon="check"
              variant="gold"
              disabled={!draft.title.trim() || !isValidDueDate(draft.dueDate)}
              loading={save.isPending}
              onPress={() => saveEdit(h, draft)}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} />
          </Row>
        </Card>
      ) : (
        <Card style={{ gap: Spacing.two }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} wrap>
            <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
              <Txt variant="h2">{h.title}</Txt>
              {(staff || me.role === 'parent') && student ? <Txt variant="muted">{student.fullName}</Txt> : null}
              <Txt variant="small">{dueLabel(h.dueDate, now)}</Txt>
            </View>
            <HomeworkStatusBadge homework={h} submissions={subs} />
          </Row>
          {h.details ? <Txt>{h.details}</Txt> : null}
          <AttachmentList items={attachments} />
          {staff ? (
            <Row>
              <Button title="Edit" size="sm" variant="ghost" onPress={() => startEdit(h)} />
            </Row>
          ) : null}
        </Card>
      )}

      {family && (subs.length === 0 || handingIn) ? <HandInForm homework={h} onDone={() => setHandingIn(false)} /> : null}

      <Section
        title="Hand-ins"
        action={
          family && subs.length > 0 && !handingIn ? (
            <Button title="Hand in again" icon="plus" size="sm" variant="outline" onPress={() => setHandingIn(true)} />
          ) : undefined
        }>
        {submissions.isLoading ? (
          <Loading />
        ) : subs.length === 0 ? (
          <EmptyState icon="inbox" title="Nothing handed in yet." message={family ? 'When the work is ready, hand it in above and your tutor will be notified.' : 'Work handed in by the student or their family will appear here for your feedback.'} />
        ) : (
          subs.map((s) => <SubmissionCard key={s.id} submission={s} canReview={staff} />)
        )}
      </Section>
    </Screen>
  );
}
