import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Switch, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useLessons } from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  canManageCase,
  KEY_DATE_KIND_LABELS,
  TARGET_STATUS_LABELS,
  TARGET_STATUS_ORDER,
  validateKeyDateInput,
  validateTargetInput,
  validateTaskInput,
  type AdmissionsCase,
  type AdmissionsKeyDate,
  type AdmissionsKeyDateInput,
  type AdmissionsTarget,
  type AdmissionsTargetInput,
  type AdmissionsTask,
  type AdmissionsTaskInput,
  type KeyDateKind,
  type TaskOwner,
} from '@/domain/admissions';
import { addDays, formatDay, formatTime, startOfDay } from '@/domain/dates';
import { enrolmentTitle } from '@/domain/enrolments';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';

import { Banner, Button, Card, Chip, ErrorNote, Field, Row, Screen, Section, Segmented, Txt } from '../ui';

const KEY_DATE_KINDS = Object.keys(KEY_DATE_KIND_LABELS) as KeyDateKind[];
// Lessons that can be linked as preparation: from today to six months ahead.
const LESSONS_FROM = startOfDay(new Date());
const LESSONS_TO = addDays(LESSONS_FROM, 183);

/** The shared shell: refuses politely when the viewer cannot manage the case, and pins Save at the bottom. */
function FormShell({
  c,
  saving,
  onSave,
  onDelete,
  deleting,
  error,
  validation,
  children,
}: {
  c: AdmissionsCase;
  saving: boolean;
  onSave: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  error: unknown;
  validation: string | null;
  children: ReactNode;
}) {
  const me = useMe();
  if (!canManageCase(me, c)) {
    return (
      <Screen>
        <Banner icon="alert">Only the adviser or the office can change this case.</Banner>
      </Screen>
    );
  }
  return (
    <Screen footer={<Button title="Save" variant="gold" style={{ flex: 1 }} loading={saving} onPress={onSave} />}>
      {children}
      {validation ? (
        <Banner tone="warning" icon="alert">
          {validation}
        </Banner>
      ) : null}
      <ErrorNote error={error} />
      {onDelete ? <Button title="Delete" variant="danger" icon="close" loading={deleting} onPress={onDelete} /> : null}
    </Screen>
  );
}

function TargetChips({ targets, value, onChange }: { targets: AdmissionsTarget[]; value: string | null; onChange: (id: string | null) => void }) {
  if (!targets.length) return null;
  return (
    <Section title="School or university (optional)">
      <Row gap={Spacing.one} wrap>
        <Chip label="Not specific" selected={!value} onPress={() => onChange(null)} />
        {targets.map((t) => (
          <Chip key={t.id} label={t.institution} selected={value === t.id} onPress={() => onChange(t.id)} />
        ))}
      </Row>
    </Section>
  );
}

const done = () => router.back();

// ---------------------------------------------------------------------------------------------
// Shortlist entry
// ---------------------------------------------------------------------------------------------

export function TargetForm({ c, existing, nextSort }: { c: AdmissionsCase; existing?: AdmissionsTarget; nextSort: number }) {
  const save = useAction(source.saveAdmissionsTarget);
  const remove = useAction(source.deleteAdmissionsTarget);
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [country, setCountry] = useState(existing?.country ?? (c.kind === 'us-university' ? 'United States' : c.kind === 'uk-university' || c.kind === 'boarding' ? 'United Kingdom' : ''));
  const [programme, setProgramme] = useState(existing?.programme ?? '');
  const [entryYear, setEntryYear] = useState(existing?.entryYear ?? c.entryYear ?? '');
  const [status, setStatus] = useState(existing?.status ?? 'researching');
  const [decisionDate, setDecisionDate] = useState(existing?.decisionDate ?? '');
  const [requirements, setRequirements] = useState(existing?.requirements ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [validation, setValidation] = useState<string | null>(null);

  async function submit() {
    const input: AdmissionsTargetInput = {
      id: existing?.id,
      caseId: c.id,
      institution: institution.trim(),
      country: country.trim() || undefined,
      programme: programme.trim() || undefined,
      entryYear: entryYear.trim() || undefined,
      status,
      decisionDate: decisionDate.trim() || null,
      requirements: requirements.trim() || undefined,
      notes: notes.trim() || undefined,
      sort: existing?.sort ?? nextSort,
    };
    const invalid = validateTargetInput(input);
    setValidation(invalid);
    if (invalid) return;
    await save.mutateAsync([input]);
    done();
  }

  return (
    <FormShell
      c={c}
      saving={save.isPending}
      onSave={() => submit().catch(() => undefined)}
      error={save.error ?? remove.error}
      validation={validation}
      deleting={remove.isPending}
      onDelete={
        existing
          ? () =>
              confirm('Remove from the shortlist?', `${existing.institution} will be removed from this case.`, async () => {
                await remove.mutateAsync([existing.id]);
                done();
              }, 'Remove')
          : undefined
      }>
      <Card style={{ gap: Spacing.three }}>
        <Field label="School or university" value={institution} onChangeText={setInstitution} placeholder="For example, University of Pennsylvania" maxLength={200} />
        <Field label="Course or programme" value={programme} onChangeText={setProgramme} placeholder="For example, BSc Economics or Sixth Form (16+)" maxLength={200} />
        <Row gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field label="Country" value={country} onChangeText={setCountry} maxLength={100} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Year of entry" value={entryYear} onChangeText={setEntryYear} maxLength={40} />
          </View>
        </Row>
      </Card>
      <Section title="Status">
        <Row gap={Spacing.one} wrap>
          {TARGET_STATUS_ORDER.map((s) => (
            <Chip key={s} label={TARGET_STATUS_LABELS[s]} selected={status === s} onPress={() => setStatus(s)} />
          ))}
        </Row>
        <Txt variant="small">Each change of status is recorded on the family’s timeline.</Txt>
      </Section>
      <Card style={{ gap: Spacing.three }}>
        <Field label="Decision expected (optional)" value={decisionDate} onChangeText={setDecisionDate} placeholder="YYYY-MM-DD" maxLength={10} autoCapitalize="none" />
        <Field label="Entry requirements" value={requirements} onChangeText={setRequirements} multiline maxLength={4000} placeholder="Grades, tests and anything else required." />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={4000} />
      </Card>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Key date
// ---------------------------------------------------------------------------------------------

export function KeyDateForm({
  c,
  existing,
  targets,
  presetTargetId,
}: {
  c: AdmissionsCase;
  existing?: AdmissionsKeyDate;
  targets: AdmissionsTarget[];
  presetTargetId?: string;
}) {
  const theme = useTheme();
  const save = useAction(source.saveAdmissionsKeyDate);
  const remove = useAction(source.deleteAdmissionsKeyDate);
  const enrolments = useEnrolments(c.studentId);
  const lessons = useLessons(LESSONS_FROM, LESSONS_TO);
  const [kind, setKind] = useState<KeyDateKind>(existing?.kind ?? 'deadline');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? '');
  const [time, setTime] = useState(existing?.time ?? '');
  const [targetId, setTargetId] = useState<string | null>(existing?.targetId ?? presetTargetId ?? null);
  const [enrolmentId, setEnrolmentId] = useState<string | null>(existing?.enrolmentId ?? null);
  const [lessonId, setLessonId] = useState<string | null>(existing?.lessonId ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [isDone, setDone] = useState(existing?.done ?? false);
  const [validation, setValidation] = useState<string | null>(null);
  const [openedAt] = useState(() => new Date().toISOString());
  const prep = kind === 'test' || kind === 'interview';
  // Upcoming lessons only: a lesson that has already started cannot be set aside for preparation.
  const studentLessons = (lessons.data ?? [])
    .filter((l) => l.status === 'scheduled' && l.studentIds.includes(c.studentId) && (l.start >= openedAt || l.id === lessonId))
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .slice(0, 12);

  async function submit() {
    const input: AdmissionsKeyDateInput = {
      id: existing?.id,
      caseId: c.id,
      targetId,
      kind,
      title: title.trim(),
      dueOn: dueOn.trim(),
      time: time.trim() || null,
      done: isDone,
      enrolmentId: prep ? enrolmentId : null,
      lessonId: prep ? lessonId : null,
      notes: notes.trim() || undefined,
    };
    const invalid = validateKeyDateInput(input);
    setValidation(invalid);
    if (invalid) return;
    await save.mutateAsync([input]);
    done();
  }

  return (
    <FormShell
      c={c}
      saving={save.isPending}
      onSave={() => submit().catch(() => undefined)}
      error={save.error ?? remove.error}
      validation={validation}
      deleting={remove.isPending}
      onDelete={
        existing
          ? () =>
              confirm('Delete this key date?', `${existing.title} will be removed, along with its reminders.`, async () => {
                await remove.mutateAsync([existing.id]);
                done();
              }, 'Delete')
          : undefined
      }>
      <Section title="Type of date">
        <Row gap={Spacing.one} wrap>
          {KEY_DATE_KINDS.map((k) => (
            <Chip key={k} label={KEY_DATE_KIND_LABELS[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </Row>
      </Section>
      <Card style={{ gap: Spacing.three }}>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="For example, Early Decision application deadline" maxLength={200} />
        <Row gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 3 }}>
            <Field label="Date" value={dueOn} onChangeText={setDueOn} placeholder="YYYY-MM-DD" maxLength={10} autoCapitalize="none" />
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Time (optional)" value={time} onChangeText={setTime} placeholder="HH:MM" maxLength={5} autoCapitalize="none" />
          </View>
        </Row>
        <Txt variant="small">Times are UAE time. The family and adviser are reminded 14, 7 and 1 days before, and on the day.</Txt>
      </Card>
      <TargetChips targets={targets} value={targetId} onChange={setTargetId} />
      {prep ? (
        <Section title="Preparation">
          <Txt variant="muted">Link the subject and lesson in which the student will prepare. Both are optional.</Txt>
          {(enrolments.data ?? []).length ? (
            <Row gap={Spacing.one} wrap>
              <Chip label="No subject" selected={!enrolmentId} onPress={() => setEnrolmentId(null)} />
              {(enrolments.data ?? []).filter((e) => e.active).map((e) => (
                <Chip key={e.id} label={enrolmentTitle(e)} selected={enrolmentId === e.id} onPress={() => setEnrolmentId(e.id)} />
              ))}
            </Row>
          ) : null}
          {studentLessons.length ? (
            <Row gap={Spacing.one} wrap>
              <Chip label="No lesson" selected={!lessonId} onPress={() => setLessonId(null)} />
              {studentLessons.map((l) => (
                <Chip
                  key={l.id}
                  label={`${formatDay(l.start)} ${formatTime(l.start)}${l.subject ? ` · ${l.subject}` : ''}`}
                  selected={lessonId === l.id}
                  onPress={() => setLessonId(l.id)}
                />
              ))}
            </Row>
          ) : (
            <Txt variant="small">No upcoming lessons are booked for this student.</Txt>
          )}
        </Section>
      ) : null}
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      {existing ? (
        <Row gap={Spacing.three} style={{ justifyContent: 'space-between' }}>
          <Txt style={{ flex: 1 }}>Done</Txt>
          <Switch
            value={isDone}
            onValueChange={setDone}
            accessibilityLabel="Done"
            trackColor={{ true: theme.accent, false: theme.textMuted }}
            thumbColor={isDone ? theme.onGold : theme.text}
            // react-native-web paints the "on" thumb teal unless told otherwise.
            {...({ activeThumbColor: theme.onGold } as object)}
          />
        </Row>
      ) : null}
    </FormShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------------------------

export function TaskForm({ c, existing, targets }: { c: AdmissionsCase; existing?: AdmissionsTask; targets: AdmissionsTarget[] }) {
  const save = useAction(source.saveAdmissionsTask);
  const remove = useAction(source.deleteAdmissionsTask);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? '');
  const [owner, setOwner] = useState<TaskOwner>(existing?.owner ?? 'family');
  const [targetId, setTargetId] = useState<string | null>(existing?.targetId ?? null);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit() {
    const input: AdmissionsTaskInput = {
      id: existing?.id,
      caseId: c.id,
      title: title.trim(),
      details: details.trim() || undefined,
      dueOn: dueOn.trim() || null,
      owner,
      targetId,
    };
    const invalid = validateTaskInput(input);
    setValidation(invalid);
    if (invalid) return;
    await save.mutateAsync([input]);
    done();
  }

  return (
    <FormShell
      c={c}
      saving={save.isPending}
      onSave={() => submit().catch(() => undefined)}
      error={save.error ?? remove.error}
      validation={validation}
      deleting={remove.isPending}
      onDelete={
        existing
          ? () =>
              confirm('Delete this task?', `“${existing.title}” will be removed.`, async () => {
                await remove.mutateAsync([existing.id]);
                done();
              }, 'Delete')
          : undefined
      }>
      <Segmented<TaskOwner>
        value={owner}
        onChange={setOwner}
        options={[
          { value: 'family', label: 'For the family' },
          { value: 'adviser', label: 'For the adviser' },
        ]}
      />
      <Card style={{ gap: Spacing.three }}>
        <Field label="Task" value={title} onChangeText={setTitle} placeholder={owner === 'family' ? 'For example, Share your activities list' : 'For example, Review the essay draft'} maxLength={200} />
        <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline maxLength={4000} />
        <Field label="Due (optional)" value={dueOn} onChangeText={setDueOn} placeholder="YYYY-MM-DD" maxLength={10} autoCapitalize="none" />
      </Card>
      {owner === 'family' ? <Txt variant="small">The family will see this task and can mark it as done.</Txt> : <Txt variant="small">The family will see that this is in hand.</Txt>}
      <TargetChips targets={targets} value={targetId} onChange={setTargetId} />
    </FormShell>
  );
}
