import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { CatalogueMultiPicker } from '@/components/catalogue-picker';
import { pickFile } from '@/components/file-pick';
import { Honeypot } from '@/components/honeypot';
import { FormError } from '@/components/spam';
import { Actions, Button, Field, FieldsCard, Notice, PageHeader, Row, Screen, Txt } from '@/components/ui';
import { source } from '@/data';
import type { PickedFile } from '@/data/source';
import { CURRICULA, PHASES, SUBJECTS } from '@/domain/catalogue';

/** Public "Teach with Elite Education" application — no account needed. */
export default function Apply() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [curricula, setCurricula] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [phases, setPhases] = useState<string[]>([]);
  const [experience, setExperience] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [availability, setAvailability] = useState('');
  const [cv, setCv] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  // Spam protection: when the form opened, and a hidden field only bots fill in.
  const [startedAt] = useState(() => Date.now());
  const [honeypot, setHoneypot] = useState('');
  const [tried, setTried] = useState(false);
  const valid = !!fullName.trim() && email.includes('@') && curricula.length > 0;

  async function submit() {
    setTried(true);
    if (!valid) return;
    if (honeypot) {
      // Almost certainly a bot: show the usual thank-you and send nothing.
      setSent(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cvPath = cv && source.uploadFile ? await source.uploadFile('applications', 'cv', cv) : undefined;
      await source.submitTutorApplication({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        curricula,
        subjects: subjects.join(', ') || undefined,
        phases,
        experience: experience.trim() || undefined,
        qualifications: qualifications.trim() || undefined,
        availability: availability.trim() || undefined,
        cvPath,
        elapsedMs: Date.now() - startedAt,
      });
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen topInset narrow>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back={{ fallback: '/sign-in' }}
        kicker="Teach with us"
        title="Teach with Elite Education"
        sub="We are always pleased to hear from outstanding tutors in every subject, phase and curriculum. Please tell us about yourself and we will be in touch."
      />
      {sent ? (
        <Notice tone="good" title="Thank you for applying" link={{ label: 'Back to sign in', onPress: () => router.replace('/sign-in') }}>
          We review every application personally and will be in touch shortly.
        </Notice>
      ) : (
        <>
          <FieldsCard title="About you">
            <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" error={tried && !fullName.trim()} />
            <Honeypot value={honeypot} onChange={setHoneypot} />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={tried && !email.includes('@') ? (email.trim() ? 'Please enter a full email address.' : true) : undefined}
            />
            <Field label="Mobile or WhatsApp number (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </FieldsCard>
          <FieldsCard title="What can you teach?">
            <CatalogueMultiPicker
              label="Subjects"
              options={SUBJECTS}
              values={subjects}
              onChange={setSubjects}
              collapsed={12}
              otherPlaceholder="For example, Chemistry, English Literature, Arabic"
            />
            <CatalogueMultiPicker label="Curricula" options={CURRICULA} values={curricula} onChange={setCurricula} otherPlaceholder="For example, Australian or German Abitur" />
            {tried && curricula.length === 0 ? <Notice tone="danger">Please choose at least one curriculum.</Notice> : null}
            <CatalogueMultiPicker label="Phases" options={PHASES} values={phases} onChange={setPhases} otherPlaceholder="For example, postgraduate" />
          </FieldsCard>
          <FieldsCard title="Your experience">
            <Field label="Teaching experience" value={experience} onChangeText={setExperience} multiline placeholder="Schools, years of experience, results and any examining work" />
            <Field label="Qualifications" value={qualifications} onChangeText={setQualifications} placeholder="For example, MSc, PGCE, QTS" />
            <Field label="Availability" value={availability} onChangeText={setAvailability} placeholder="For example, weekday evenings and Saturday mornings" />
            <Row gap={10} style={{ justifyContent: 'space-between' }}>
              <Txt variant="note" style={{ flex: 1 }} numberOfLines={1}>
                {cv ? `CV: ${cv.name}` : 'CV (optional, PDF or Word)'}
              </Txt>
              <Button title={cv ? 'Change' : 'Attach your CV'} icon="attach" size="sm" variant="secondary" onPress={async () => setCv((await pickFile()) ?? cv)} />
            </Row>
          </FieldsCard>
          <FormError error={error} />
          <Actions>
            <Button title="Send application" icon="send" loading={busy} onPress={submit} />
          </Actions>
        </>
      )}
    </Screen>
  );
}
