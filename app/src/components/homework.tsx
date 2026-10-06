import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useLessons, useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { addDays, formatDate, formatTime, toDateKey } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import { classworkFolder, dueDateChoices, HOMEWORK_STATUS_LABEL, homeworkStatus } from '@/domain/homework';
import type { Attachment, Homework, HomeworkSubmission } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { AttachmentEditor, AttachmentList } from './attachments';
import { Badge, Button, Card, Chip, ErrorNote, Field, Row, Txt } from './ui';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when a typed due date is a real YYYY-MM-DD date. */
export function isValidDueDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && toDateKey(d) === value;
}

/** Where a piece of homework stands: to do, overdue, handed in or reviewed. */
export function HomeworkStatusBadge({ homework, submissions }: { homework: Homework; submissions: HomeworkSubmission[] }) {
  const [today] = useState(() => toDateKey(new Date()));
  const status = HOMEWORK_STATUS_LABEL[homeworkStatus(homework, submissions, today)];
  return <Badge label={status.label} tone={status.tone} />;
}

export interface HomeworkDraft {
  title: string;
  details: string;
  dueDate: string;
  attachments: Attachment[];
}

/** Title, instructions, due date and attachments for one student's homework. */
export function HomeworkEditor({ studentId, value, onChange }: { studentId: string; value: HomeworkDraft; onChange: (next: HomeworkDraft) => void }) {
  const dateOk = isValidDueDate(value.dueDate);
  const [now] = useState(() => new Date());
  const [until] = useState(() => addDays(new Date(), 60));
  const lessons = useLessons(now, until);
  const nextLesson = (lessons.data ?? [])
    .filter((l) => l.status === 'scheduled' && l.studentIds.includes(studentId) && new Date(l.start) > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const choices = dueDateChoices(now, nextLesson?.start);
  // The library opens on the subject of the student's next lesson (or their only subject).
  const enrolments = useEnrolments(studentId);
  const subject = lessonSubject(nextLesson ?? { studentIds: [studentId] }, enrolments.data ?? []);
  return (
    <View style={{ gap: Spacing.three }}>
      <Field label="Title" value={value.title} onChangeText={(title) => onChange({ ...value, title })} placeholder="e.g. Exercise 7C, questions 1 to 12" />
      <Field
        label="Details (optional)"
        multiline
        value={value.details}
        onChangeText={(details) => onChange({ ...value, details })}
        placeholder="Instructions for the student. For example, show all working and check each answer against the mark scheme."
      />
      <View style={{ gap: Spacing.two }}>
        <Field
          label="Due date"
          value={value.dueDate}
          onChangeText={(dueDate) => onChange({ ...value, dueDate })}
          placeholder="YYYY-MM-DD"
          hint={dateOk ? formatDate(value.dueDate) : 'Please enter the date as YYYY-MM-DD, or choose one below.'}
          autoCapitalize="none"
        />
        <Row gap={Spacing.one} wrap>
          {choices.map((c) => (
            <Chip key={c.label} label={c.label} selected={value.dueDate === c.date} onPress={() => onChange({ ...value, dueDate: c.date })} />
          ))}
        </Row>
      </View>
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Attachments</Txt>
        <AttachmentEditor
          value={value.attachments}
          onChange={(attachments) => onChange({ ...value, attachments })}
          folder={classworkFolder({ studentId })}
          allowLibrary
          subject={subject}
        />
      </View>
    </View>
  );
}

function when(iso: string): string {
  return `${formatDate(iso)} at ${formatTime(iso)}`;
}

/** One hand-in, with the tutor's feedback, or a feedback form for the tutor. */
export function SubmissionCard({ submission, canReview }: { submission: HomeworkSubmission; canReview: boolean }) {
  const theme = useTheme();
  const review = useAction(source.giveFeedback);
  const [feedback, setFeedback] = useState('');
  const [mark, setMark] = useState('');
  const s = submission;
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} wrap>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Txt variant="h3">{s.submittedByName ?? 'Handed in'}</Txt>
          <Txt variant="small">{when(s.submittedAt)}</Txt>
        </View>
        {s.feedback ? <Badge label="Feedback given" tone="success" /> : <Badge label="Awaiting feedback" tone="info" />}
      </Row>
      {s.note ? <Txt>{s.note}</Txt> : null}
      <AttachmentList items={s.files} />
      {s.feedback ? (
        <View style={{ gap: Spacing.one, borderLeftWidth: 2, borderLeftColor: theme.gold, paddingLeft: Spacing.three }}>
          <Row style={{ justifyContent: 'space-between' }} wrap>
            <Txt variant="label">Feedback{s.feedbackByName ? ` from ${s.feedbackByName}` : ''}</Txt>
            {s.mark ? <Badge label={`Mark ${s.mark}`} tone="gold" /> : null}
          </Row>
          <Txt>{s.feedback}</Txt>
          {s.feedbackAt ? <Txt variant="small">{when(s.feedbackAt)}</Txt> : null}
        </View>
      ) : canReview ? (
        <View style={{ gap: Spacing.two }}>
          <Field label="Feedback" multiline value={feedback} onChangeText={setFeedback} placeholder="What went well, and what to focus on next." />
          <Field label="Mark (optional)" value={mark} onChangeText={setMark} placeholder="e.g. 7/10" />
          <ErrorNote error={review.error} />
          <Button
            title="Send feedback"
            icon="check"
            variant="gold"
            disabled={!feedback.trim()}
            loading={review.isPending}
            onPress={async () => {
              await review.mutateAsync([s.id, feedback.trim(), mark.trim() || undefined]);
              setFeedback('');
              setMark('');
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** For students and parents: a note and files, handed in to the tutor. */
export function HandInForm({ homework, onDone }: { homework: Homework; onDone?: () => void }) {
  const me = useMe();
  const lookup = useLookup();
  const submit = useAction(source.submitHomework);
  // Parents hand in on their child's behalf, so the wording names the child.
  const firstName = me.role === 'parent' ? lookup.student(homework.studentId)?.fullName.split(' ')[0] : undefined;
  const whose = firstName ? `${firstName}'s` : 'your';
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const ready = !!note.trim() || files.length > 0;
  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">Hand in {whose} work</Txt>
      <Txt variant="muted">
        {firstName
          ? `Add a photo of ${firstName}'s work, a file or a link, together with a note for ${firstName}'s tutor if you wish.`
          : 'Add a photo of your work, a file or a link, together with a note for your tutor if you wish.'}
      </Txt>
      <AttachmentEditor value={files} onChange={setFiles} folder={classworkFolder({ studentId: homework.studentId })} />
      <Field
        label={`Note for ${whose} tutor (optional)`}
        multiline
        value={note}
        onChangeText={setNote}
        placeholder={firstName ? `e.g. ${firstName} found question 4 difficult and would like to go over it in the next lesson.` : 'e.g. I found question 4 difficult and would like to go over it next lesson.'}
      />
      <ErrorNote error={submit.error} />
      <Button
        title={`Hand in ${whose} work`}
        icon="check"
        variant="gold"
        disabled={!ready}
        loading={submit.isPending}
        onPress={async () => {
          await submit.mutateAsync([{ homeworkId: homework.id, note: note.trim() || undefined, files }]);
          setNote('');
          setFiles([]);
          onDone?.();
        }}
      />
    </Card>
  );
}
