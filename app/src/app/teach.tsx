import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { pickFile } from '@/components/file-pick';
import { Banner, Button, Card, Chip, ErrorNote, Field, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import type { PickedFile } from '@/data/source';

/** Public "Teach with Elite Education" application — no account needed. */
export default function Apply() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [curricula, setCurricula] = useState<string[]>([]);
  const [subjects, setSubjects] = useState('');
  const [experience, setExperience] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [availability, setAvailability] = useState('');
  const [cv, setCv] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const cvPath = cv && source.uploadFile ? await source.uploadFile('applications', 'cv', cv) : undefined;
      await source.submitTutorApplication({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        curricula,
        subjects: subjects.trim() || undefined,
        experience: experience.trim() || undefined,
        qualifications: qualifications.trim() || undefined,
        availability: availability.trim() || undefined,
        cvPath,
      });
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Teach with Elite Education' }} />
      {sent ? (
        <Banner tone="success" icon="check">
          Thank you for applying. We review every application personally and will be in touch shortly.
        </Banner>
      ) : (
        <>
          <Txt variant="muted">
            We are always pleased to hear from outstanding tutors in every subject, phase and curriculum. Please tell us about yourself and we will be in touch.
          </Txt>
          <Card style={{ gap: Spacing.three }}>
            <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" />
            <Row gap={Spacing.two}>
              <View style={{ flex: 1 }}>
                <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Mobile or WhatsApp number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              </View>
            </Row>
            <Section title="What can you teach?">
              <Row gap={Spacing.one} wrap>
                {['IB', 'IGCSE', 'A-Level'].map((c) => (
                  <Chip key={c} label={c} selected={curricula.includes(c)} onPress={() => setCurricula((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} />
                ))}
              </Row>
            </Section>
            <Field label="Subjects" value={subjects} onChangeText={setSubjects} placeholder="e.g. Mathematics, Physics, English Literature" />
            <Field label="Teaching experience" value={experience} onChangeText={setExperience} multiline placeholder="Schools, years of experience, results and any examining work" />
            <Field label="Qualifications" value={qualifications} onChangeText={setQualifications} placeholder="e.g. MSc, PGCE, QTS" />
            <Field label="Availability" value={availability} onChangeText={setAvailability} placeholder="e.g. Weekday evenings, Saturday mornings" />
            <Row gap={Spacing.two} style={{ justifyContent: 'space-between' }}>
              <Txt variant="muted" style={{ flex: 1 }} numberOfLines={1}>
                {cv ? `CV: ${cv.name}` : 'CV (optional, PDF or Word)'}
              </Txt>
              <Button title={cv ? 'Change' : 'Attach your CV'} icon="doc" size="sm" variant="secondary" onPress={async () => setCv((await pickFile()) ?? cv)} />
            </Row>
            <ErrorNote error={error} />
            <Button title="Send application" variant="gold" loading={busy} disabled={!fullName.trim() || !email.includes('@') || curricula.length === 0} onPress={submit} />
          </Card>
        </>
      )}
    </Screen>
  );
}
