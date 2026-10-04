import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import type { NewEnquiry } from '@/data/source';
import { CURRICULA, PHASES, SUBJECTS } from '@/domain/catalogue';

import { CataloguePicker } from './catalogue-picker';
import { Banner, Button, Card, Chip, ErrorNote, Field, Row, Section, Txt } from './ui';

const TIMES = ['Weekday afternoons', 'Weekday evenings', 'Weekends', 'Flexible'];

/** "Book a free consultation" — used without an account, by new parents in onboarding, and by admins for phone enquiries. */
export function EnquiryForm({
  defaults,
  source: origin = 'app',
  onSent,
  submitLabel = 'Send enquiry',
  hideContact,
}: {
  defaults?: Partial<NewEnquiry>;
  source?: NewEnquiry['source'];
  onSent?: () => void;
  submitLabel?: string;
  /** For signed-in parents, whose contact details we already have. */
  hideContact?: boolean;
}) {
  const [parentName, setParentName] = useState(defaults?.parentName ?? '');
  const [email, setEmail] = useState(defaults?.email ?? '');
  const [phone, setPhone] = useState(defaults?.phone ?? '');
  const [studentName, setStudentName] = useState(defaults?.studentName ?? '');
  const [subject, setSubject] = useState<string | undefined>(defaults?.subject);
  const [phase, setPhase] = useState<string | undefined>(defaults?.phase);
  const [curriculum, setCurriculum] = useState<string | undefined>(defaults?.curriculum);
  const [yearGroup, setYearGroup] = useState(defaults?.yearGroup ?? '');
  const [message, setMessage] = useState(defaults?.message ?? '');
  const [times, setTimes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Banner tone="success" icon="check">
        Thank you. We have received your enquiry and will be in touch within one working day to arrange a complimentary consultation.
      </Banner>
    );
  }

  const valid = parentName.trim() && (hideContact || email.trim() || phone.trim());

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await source.submitEnquiry({
        parentName: parentName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        studentName: studentName.trim() || undefined,
        subject: subject?.trim() || undefined,
        phase: phase?.trim() || undefined,
        curriculum: curriculum?.trim() || undefined,
        yearGroup: yearGroup.trim() || undefined,
        message: message.trim() || undefined,
        preferredTimes: times.join(', ') || undefined,
        source: origin,
      });
      setSent(true);
      onSent?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="muted">Please tell us a little about your child and the support you are looking for.</Txt>
      {!hideContact ? (
        <>
          <Field label="Your name" value={parentName} onChangeText={setParentName} autoCapitalize="words" />
          <Row gap={Spacing.two}>
            <View style={{ flex: 1 }}>
              <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Mobile or WhatsApp number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </View>
          </Row>
        </>
      ) : null}
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Student’s first name" value={studentName} onChangeText={setStudentName} autoCapitalize="words" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="For example Year 11" />
        </View>
      </Row>
      <CataloguePicker
        label="Subject"
        options={SUBJECTS}
        value={subject}
        onChange={setSubject}
        collapsed={10}
        optional
        otherPlaceholder="For example Latin or Music theory"
      />
      <Txt variant="small">One subject is enough here; please mention any others in your message below.</Txt>
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <CataloguePicker label="Curriculum" options={CURRICULA} value={curriculum} onChange={setCurriculum} optional collapsed={8} />
      <Section title="Best times">
        <Row gap={Spacing.one} wrap>
          {TIMES.map((t) => (
            <Chip key={t} label={t} selected={times.includes(t)} onPress={() => setTimes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} />
          ))}
        </Row>
      </Section>
      <Field
        label="How can we help?"
        value={message}
        onChangeText={setMessage}
        multiline
        placeholder="For example: predicted a 5 and aiming for a 7; finds essay structure difficult; mock examinations in January."
      />
      <ErrorNote error={error} />
      <Button title={submitLabel} variant="gold" onPress={send} loading={busy} disabled={!valid} />
      {!hideContact ? <Txt variant="small">We use your details only to reply to this enquiry.</Txt> : null}
    </Card>
  );
}
