import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { EnquiryForm } from '@/components/enquiry-form';
import { EnrolmentEditor, emptyDraft } from '@/components/enrolment-editor';
import { Icon } from '@/components/icon';
import { Button, Card, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useEnrolments, useFamilies, useStudents } from '@/data/hooks';
import { useMe, useSession } from '@/data/session';
import { PHASES } from '@/domain/catalogue';
import { activeEnrolments, studentSubjects, validateEnrolments, type EnrolmentDraft } from '@/domain/enrolments';
import { useTheme } from '@/hooks/use-theme';
import { isPlaceholderName } from '@/lib/social-auth';

/**
 * First-run for parents who signed up themselves: add children, then tell us what they need.
 * Families who are already with us use the same screen to add another child, without the consultation step.
 */
export default function Onboarding() {
  const me = useMe();
  const theme = useTheme();
  const students = useStudents();
  const enrolments = useEnrolments();
  const families = useFamilies();
  const setMyName = useSession((s) => s.setMyName);
  const [step, setStep] = useState<'children' | 'help'>('children');
  // An Apple sign-in may share no name; ask for it once rather than greeting a family as 'New parent'.
  // Onboarding is also the 'Add a child' screen, so parents who already have a name never see the field.
  const [askName] = useState(() => isPlaceholderName(me.fullName, me.email));
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<unknown>(null);
  if (students.isLoading || families.isLoading) return <Loading />;
  const kids = students.data ?? [];
  const family = (families.data ?? []).find((f) => f.id === me.familyId);
  // Families default to active; only prospects are still waiting for their consultation. A family we cannot see
  // (the query failed, or the row is not visible yet) takes the prospect path, so a new enquiry is never skipped.
  const enrolled = !!family && (family.status === undefined || family.status === 'active');
  const firstSubjects = kids[0] ? activeEnrolments(enrolments.data ?? [], kids[0].id) : [];
  const firstName = isPlaceholderName(me.fullName, me.email) ? '' : me.fullName.split(' ')[0];
  const parentName = askName ? name.trim().replace(/\s+/g, ' ') : me.fullName;

  async function next() {
    setNameError(null);
    if (askName && parentName !== me.fullName) {
      setSaving(true);
      try {
        await setMyName(parentName);
      } catch (err) {
        setNameError(err);
        return;
      } finally {
        setSaving(false);
      }
    }
    setStep('help');
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: enrolled ? 'Add a child' : 'Welcome' }} />
      <View style={{ gap: Spacing.one }}>
        <Txt variant="title">{enrolled ? 'Add a child' : firstName ? `Welcome, ${firstName}` : 'Welcome'}</Txt>
        <Txt variant="muted">
          {enrolled
            ? 'Please tell us about your child and the subjects they would like support with. We will confirm a tutor within one working day.'
            : 'Two short steps, and we will be in touch within one working day to arrange a complimentary consultation.'}
        </Txt>
      </View>
      {families.isError ? (
        <View style={{ gap: Spacing.two }}>
          <ErrorNote error={families.error} />
          <Button title="Try again" variant="outline" size="sm" onPress={() => families.refetch()} />
        </View>
      ) : null}
      {enrolled ? null : (
        <Row gap={Spacing.two}>
          {(['children', 'help'] as const).map((s, i) => (
            <Row key={s} gap={6} style={{ flex: 1 }}>
              <Icon name={step === 'help' && s === 'children' ? 'check' : 'circle'} size={20} color={step === s ? theme.accent : theme.textMuted} />
              <Txt variant={step === s ? 'h3' : 'muted'}>
                {i + 1}. {s === 'children' ? 'Your children' : 'What you need'}
              </Txt>
            </Row>
          ))}
        </Row>
      )}

      {step === 'children' ? (
        <>
          {askName ? (
            <Card style={{ gap: Spacing.three }}>
              <Txt variant="h3">How should we address you?</Txt>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                maxLength={120}
                placeholder="For example, Fatima Al Mansoori"
              />
            </Card>
          ) : null}
          {kids.length ? (
            <Section title="Added">
              {kids.map((k) => (
                <Card key={k.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt variant="h3">{k.fullName}</Txt>
                    <Txt variant="muted" style={{ flexShrink: 1, textAlign: 'right' }}>
                      {studentSubjects(enrolments.data ?? [], k.id) || k.curriculum || 'Subjects to be confirmed'}
                    </Txt>
                  </Row>
                </Card>
              ))}
            </Section>
          ) : null}
          <AddChildForm key={kids.length} first={kids.length === 0} />
          <ErrorNote error={nameError} />
          {enrolled ? (
            <Button title="Back to my home screen" variant="secondary" onPress={() => router.replace('/parent')} />
          ) : (
            <Button
              title="Next: what you need"
              variant="gold"
              loading={saving}
              disabled={kids.length === 0 || (askName && !parentName)}
              onPress={next}
            />
          )}
        </>
      ) : (
        <>
          <EnquiryForm
            hideContact
            defaults={{
              parentName,
              email: me.email,
              studentName: kids.map((k) => k.fullName.split(' ')[0]).join(', '),
              curriculum: firstSubjects[0]?.curriculum ?? kids[0]?.curriculum,
              subject: firstSubjects.map((e) => e.subject).join(', ') || undefined,
              phase: kids[0]?.phase,
              yearGroup: kids[0]?.yearGroup,
            }}
            submitLabel="Request a complimentary consultation"
          />
          <Button title="Go to my home screen" variant="secondary" onPress={() => router.replace('/parent')} />
        </>
      )}
    </Screen>
  );
}

function AddChildForm({ first }: { first: boolean }) {
  const add = useAction(source.addMyChild);
  const [fullName, setFullName] = useState('');
  const [phase, setPhase] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<EnrolmentDraft[]>(() => [emptyDraft()]);
  const [school, setSchool] = useState('');
  const [yearGroup, setYearGroup] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const active = drafts.filter((d) => d.active);
    const message = active.length ? validateEnrolments(active) : 'Please add at least one subject.';
    setProblem(message);
    if (message) return;
    add.mutate([
      {
        fullName: fullName.trim(),
        school: school.trim() || undefined,
        yearGroup: yearGroup.trim() || undefined,
        phase,
        subjects: active.map((d) => ({
          subject: d.subject.trim(),
          curriculum: d.curriculum,
          level: d.level,
          examBoard: d.examBoard,
          syllabusId: d.syllabusId,
        })),
      },
    ]);
  };

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">{first ? 'Add your child' : 'Add another child'}</Txt>
      <Field label="Child’s full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <View style={{ gap: Spacing.two }}>
        <Txt variant="label">Subjects</Txt>
        <Txt variant="muted">If you are unsure of the curriculum or level, please leave it blank and we will confirm it with you.</Txt>
        <EnrolmentEditor value={drafts} onChange={setDrafts} forFamily />
      </View>
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="School" value={school} onChangeText={setSchool} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="For example, Year 10" />
        </View>
      </Row>
      <ErrorNote error={problem ? new Error(problem) : add.error} />
      <Button title="Add child" icon="plus" loading={add.isPending} disabled={!fullName.trim() || drafts.length > 10} onPress={submit} />
    </Card>
  );
}
