import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EnquiryForm } from '@/components/enquiry-form';
import { Icon } from '@/components/icon';
import { Banner, Button, Card, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { SYLLABUSES } from '@/data/curriculum';
import { source } from '@/data';
import { useAction, useStudents } from '@/data/hooks';
import { useMe, useSession } from '@/data/session';
import type { Curriculum } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { isPlaceholderName } from '@/lib/social-auth';

/** First-run for parents who signed up themselves: add children, then tell us what they need. */
export default function Onboarding() {
  const me = useMe();
  const theme = useTheme();
  const students = useStudents();
  const setMyName = useSession((s) => s.setMyName);
  const [step, setStep] = useState<'children' | 'help'>('children');
  const placeholder = isPlaceholderName(me.fullName, me.email);
  // An Apple sign-in may share no name; ask for it rather than greeting a family as 'New parent'.
  const [name, setName] = useState(() => (placeholder ? '' : me.fullName));
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<unknown>(null);
  if (students.isLoading) return <Loading />;
  const kids = students.data ?? [];
  const firstName = placeholder ? '' : me.fullName.split(' ')[0];

  async function next() {
    const clean = name.trim().replace(/\s+/g, ' ');
    setNameError(null);
    if (clean !== me.fullName) {
      setSaving(true);
      try {
        await setMyName(clean);
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
      <Stack.Screen options={{ title: 'Welcome' }} />
      <View style={{ gap: Spacing.one }}>
        <Txt variant="title">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</Txt>
        <Txt variant="muted">Two short steps, and we will be in touch within one working day to arrange a complimentary consultation.</Txt>
      </View>
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

      {step === 'children' ? (
        <>
          <Card style={{ gap: Spacing.three }}>
            <Txt variant="h3">Your name</Txt>
            <Field
              label="Your full name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={120}
              placeholder="As you would like us to address you"
            />
          </Card>
          {kids.length ? (
            <Section title="Added">
              {kids.map((k) => (
                <Card key={k.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt variant="h3">{k.fullName}</Txt>
                    <Txt variant="muted">{SYLLABUSES.find((s) => s.id === k.syllabusId)?.name ?? k.curriculum}</Txt>
                  </Row>
                </Card>
              ))}
            </Section>
          ) : null}
          <AddChildForm key={kids.length} first={kids.length === 0} />
          <ErrorNote error={nameError} />
          <Button title="Next: what you need" variant="gold" loading={saving} disabled={kids.length === 0 || !name.trim()} onPress={next} />
        </>
      ) : (
        <>
          <EnquiryForm
            hideContact
            defaults={{ parentName: name.trim() || (placeholder ? '' : me.fullName), email: me.email, studentName: kids.map((k) => k.fullName.split(' ')[0]).join(', '), curriculum: kids[0]?.curriculum, yearGroup: kids[0]?.yearGroup }}
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
  const [curriculum, setCurriculum] = useState<Curriculum>('IGCSE');
  const [syllabusId, setSyllabusId] = useState('');
  const [school, setSchool] = useState('');
  const [yearGroup, setYearGroup] = useState('');
  const options = SYLLABUSES.filter((s) => s.curriculum === curriculum);

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">{first ? 'Add your child' : 'Add another child'}</Txt>
      <Field label="Child’s full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
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
        {options.map((s) => (
          <Chip key={s.id} label={s.name} selected={syllabusId === s.id} onPress={() => setSyllabusId(s.id)} />
        ))}
      </Row>
      {!syllabusId ? <Banner>Not sure which course? Please choose the closest, and we will confirm it with you.</Banner> : null}
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="School" value={school} onChangeText={setSchool} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="Year 10" />
        </View>
      </Row>
      <ErrorNote error={add.error} />
      <Button
        title="Add child"
        icon="plus"
        loading={add.isPending}
        disabled={!fullName.trim() || !syllabusId}
        onPress={() => add.mutate([{ fullName, curriculum, syllabusId, school: school.trim() || undefined, yearGroup: yearGroup.trim() || undefined }])}
      />
    </Card>
  );
}
