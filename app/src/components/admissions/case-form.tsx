import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
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

import { Banner, Button, Card, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '../ui';
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
  const students = useStudents();
  const tutors = useTutors();
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

  if (students.isLoading || tutors.isLoading) return <Loading />;
  if (existing && !canManageCase(me, existing)) {
    return (
      <Screen>
        <Banner icon="alert">Only the adviser or the office can change this case.</Banner>
      </Screen>
    );
  }

  const q = query.trim().toLowerCase();
  const studentList = (students.data ?? [])
    .filter((s) => !q || s.fullName.toLowerCase().includes(q) || s.id === studentId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const chosen = students.data?.find((s) => s.id === studentId);

  function changeKind(k: AdmissionsCaseKind) {
    setKind(k);
    if (!titleEdited) setTitle(suggestCaseTitle(k, entryYear));
  }
  function changeYear(y: string) {
    setEntryYear(y);
    if (!titleEdited) setTitle(suggestCaseTitle(kind, y));
  }

  async function submit() {
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
    onSaved(saved, !existing);
  }

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save changes' : 'Open case'}
          variant="gold"
          style={{ flex: 1 }}
          loading={save.isPending}
          onPress={() => submit().catch(() => undefined)}
        />
      }>
      {isAdmin ? (
        <>
          <Section title="Student">
            {existing ? (
              <Card>
                <Txt variant="h3">{chosen?.fullName ?? 'Student'}</Txt>
              </Card>
            ) : (
              <>
                <Field label="Search" value={query} onChangeText={setQuery} placeholder="Type a student’s name" autoCapitalize="words" />
                <Row gap={Spacing.one} wrap>
                  {studentList.slice(0, 24).map((s) => (
                    <Chip key={s.id} label={s.fullName} selected={studentId === s.id} onPress={() => setStudentId(s.id)} />
                  ))}
                </Row>
              </>
            )}
          </Section>

          <Section title="Type of support">
            <Row gap={Spacing.one} wrap>
              {KINDS.map((k) => (
                <Chip key={k} label={CASE_KIND_LABELS[k]} selected={kind === k} onPress={() => changeKind(k)} />
              ))}
            </Row>
          </Section>

          <Card style={{ gap: Spacing.three }}>
            <Field label="Year of entry" value={entryYear} onChangeText={changeYear} placeholder="For example, 2028 or September 2027" maxLength={40} />
            <Field
              label="Title"
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                setTitleEdited(true);
              }}
              maxLength={200}
              hint="Seen by the family. Suggested from the type of support and the year of entry."
            />
          </Card>

          <Section title="Adviser">
            <Row gap={Spacing.one} wrap>
              <Chip label={`${OFFICE_ADVISER} office`} selected={adviser === OFFICE} onPress={() => setAdviser(OFFICE)} />
              {(tutors.data ?? []).map((t) => (
                <Chip key={t.id} label={t.fullName} selected={adviser === t.id} onPress={() => setAdviser(t.id)} />
              ))}
            </Row>
            <Txt variant="small">The adviser can see and update this case. Other tutors cannot.</Txt>
          </Section>
        </>
      ) : (
        <Banner icon="sparkle">As the adviser you may update the summary and status. Please ask the office to change anything else.</Banner>
      )}

      <Section title="Status">
        <Row gap={Spacing.one} wrap>
          {STATUSES.map((s) => (
            <Chip key={s} label={CASE_STATUS_LABELS[s]} selected={status === s} onPress={() => setStatus(s)} />
          ))}
        </Row>
      </Section>

      <View>
        <Field
          label="Summary"
          value={summary}
          onChangeText={setSummary}
          multiline
          maxLength={4000}
          placeholder="Aims, the shape of the support and anything the family should know."
          hint="Shown to the family at the top of the case."
        />
      </View>

      {error ? <Banner tone="warning" icon="alert">{error}</Banner> : null}
      <ErrorNote error={save.error} />
    </Screen>
  );
}
