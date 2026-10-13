import { useState } from 'react';
import { View } from 'react-native';

import { source } from '@/data';
import { useAction, useStudents, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import {
  CASE_KIND_LABELS,
  CASE_STATUS_LABELS,
  canManageCase,
  validateCaseInput,
  type AdmissionsCase,
  type AdmissionsCaseInput,
  type AdmissionsCaseKind,
  type AdmissionsCaseStatus,
} from '@/domain/admissions';

import { NoHeader, SummaryCard } from '../ops/parts';
import { Actions, Button, ChipField, Columns, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Screen, useToast } from '../ui';
import { tutorChipLabel, useComplianceMap } from '../vetting';
import { OFFICE_ADVISER, suggestCaseTitle } from './format';

const KINDS = Object.keys(CASE_KIND_LABELS) as AdmissionsCaseKind[];
const STATUSES = Object.keys(CASE_STATUS_LABELS) as AdmissionsCaseStatus[];
const OFFICE = '__office__';

/**
 * The office opens and edits cases; the adviser may change only the summary and status
 * (the data layer enforces the same rule).
 */
export function CaseForm({
  existing,
  studentId: presetStudent,
  onSaved,
}: {
  existing?: AdmissionsCase;
  studentId?: string;
  onSaved: (saved: AdmissionsCase, created: boolean) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const students = useStudents();
  const tutors = useTutors();
  const vetting = useComplianceMap();
  const save = useAction(source.saveAdmissionsCase);
  const isAdmin = me.role === 'admin';
  const [studentId, setStudentId] = useState(existing?.studentId ?? presetStudent ?? '');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AdmissionsCaseKind>(existing?.kind ?? 'uk-university');
  const [entryYear, setEntryYear] = useState(existing?.entryYear ?? '');
  const [title, setTitle] = useState(existing?.title ?? suggestCaseTitle('uk-university', ''));
  const [titleEdited, setTitleEdited] = useState(!!existing);
  const [status, setStatus] = useState<AdmissionsCaseStatus>(existing?.status ?? 'active');
  const [adviser, setAdviser] = useState(existing?.adviserTutorId ?? OFFICE);
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const header = (
    <>
      <NoHeader />
      <PageHeader
        back={{ fallback: existing ? undefined : '/admissions' }}
        kicker={existing ? 'Admissions · Edit' : 'Admissions · New'}
        title={existing ? (isAdmin ? 'Edit case' : 'Summary and status') : 'Open an admissions case'}
        sub={
          existing
            ? undefined
            : 'A case holds the shortlist, key dates, tasks, documents and the updates the family receives.'
        }
      />
    </>
  );

  if (students.isLoading || tutors.isLoading) return <Loading />;
  if (existing && !canManageCase(me, existing)) {
    return (
      <Screen topInset>
        {header}
        <Notice tone="warn">Only the adviser or the office can change this case.</Notice>
      </Screen>
    );
  }

  const q = query.trim().toLowerCase();
  const studentList = (students.data ?? [])
    .filter((s) => !q || s.fullName.toLowerCase().includes(q) || s.id === studentId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const chosen = students.data?.find((s) => s.id === studentId);
  const adviserLabel = adviser === OFFICE ? `${OFFICE_ADVISER} office` : (tutors.data?.find((t) => t.id === adviser)?.fullName ?? '—');

  function changeKind(k: AdmissionsCaseKind) {
    setKind(k);
    if (!titleEdited) setTitle(suggestCaseTitle(k, entryYear));
  }
  function changeYear(y: string) {
    setEntryYear(y);
    if (!titleEdited) setTitle(suggestCaseTitle(kind, y));
  }

  async function submit() {
    setTried(true);
    const input: AdmissionsCaseInput = {
      id: existing?.id,
      studentId,
      kind,
      title: title.trim(),
      entryYear: entryYear.trim() || undefined,
      status,
      adviserTutorId: adviser === OFFICE ? null : adviser,
      summary: summary.trim() || undefined,
    };
    const invalid = validateCaseInput(input);
    setError(invalid);
    if (invalid) return;
    const saved = await save.mutateAsync([input]);
    toast(existing ? 'Case saved' : `Case opened for ${chosen?.fullName ?? 'the student'}`);
    onSaved(saved, !existing);
  }

  const form = (
    <View style={{ gap: 20 }}>
      {isAdmin ? (
        <>
          <FieldsCard title="Student">
            {existing ? (
              <Field label="Student" value={chosen?.fullName ?? 'Student'} editable={false} />
            ) : (
              <>
                <Field label="Find a student" value={query} onChangeText={setQuery} placeholder="Type a student’s name" autoCapitalize="words" />
                <ChipField
                  options={studentList.slice(0, 24).map((s) => ({ value: s.id, label: s.fullName }))}
                  value={studentId}
                  onChange={setStudentId}
                  error={tried && !studentId}
                />
              </>
            )}
          </FieldsCard>
          <FieldsCard title="Applying to">
            <ChipField label="Type of support" options={KINDS.map((k) => ({ value: k, label: CASE_KIND_LABELS[k] }))} value={kind} onChange={changeKind} />
            <Field label="Year of entry" value={entryYear} onChangeText={changeYear} placeholder="For example, 2028 or September 2027" maxLength={40} />
            <Field
              label="Title"
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                setTitleEdited(true);
              }}
              maxLength={200}
              error={tried && !title.trim()}
              hint="Seen by the family. Suggested from the type of support and the year of entry."
            />
          </FieldsCard>
          <FieldsCard title="Adviser">
            <ChipField
              options={[
                { value: OFFICE, label: `${OFFICE_ADVISER} office` },
                ...(tutors.data ?? []).map((t) => ({ value: t.id, label: tutorChipLabel(t.fullName, vetting.get(t.id)) })),
              ]}
              value={adviser}
              onChange={setAdviser}
              hint="The adviser can see and update this case. Other tutors cannot."
            />
          </FieldsCard>
        </>
      ) : (
        <Notice>As the adviser you may update the summary and status. Please ask the office to change anything else.</Notice>
      )}
      <FieldsCard title={isAdmin ? 'Status and summary' : undefined}>
        <ChipField label="Status" options={STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] }))} value={status} onChange={setStatus} />
        <Field
          label="Summary"
          value={summary}
          onChangeText={setSummary}
          multiline
          maxLength={4000}
          placeholder="Aims, the shape of the support and anything the family should know."
          hint="Shown to the family at the top of the case."
        />
      </FieldsCard>
    </View>
  );

  const submitButton = (
    <View style={{ gap: 12 }}>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <ErrorNote error={save.error} />
      <Actions>
        <Button title={existing ? 'Save changes' : 'Open case'} loading={save.isPending} onPress={() => submit().catch(() => undefined)} />
      </Actions>
    </View>
  );

  return (
    <Screen topInset>
      {header}
      {existing ? (
        <>
          {form}
          {submitButton}
        </>
      ) : (
        <Columns>
          {form}
          <View style={{ gap: 20 }}>
            <SummaryCard
              kicker="When the case opens"
              title={chosen?.fullName ?? 'New case'}
              lines={[
                { k: 'Applying to', v: CASE_KIND_LABELS[kind] },
                { k: 'Entry', v: entryYear.trim() || '—' },
                { k: 'Adviser', v: adviserLabel },
              ]}
              note="The family can follow the shortlist, key dates, tasks and published updates in their app. Updates are reviewed by the office before the family sees them."
            />
            {submitButton}
          </View>
        </Columns>
      )}
    </Screen>
  );
}
