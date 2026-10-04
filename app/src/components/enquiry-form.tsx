import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import type { NewEnquiry } from '@/data/source';

import { Banner, Button, Card, Chip, ErrorNote, Field, Row, Section, Txt } from './ui';

const CURRICULA = ['IB', 'IGCSE', 'A-Level', 'Other'];
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
  const [curriculum, setCurriculum] = useState(defaults?.curriculum ?? '');
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
        curriculum: curriculum || undefined,
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
          <Field label="Year group" value={yearGroup} onChangeText={setYearGroup} placeholder="e.g. Year 11" />
        </View>
      </Row>
      <Section title="Curriculum">
        <Row gap={Spacing.one} wrap>
          {CURRICULA.map((c) => (
            <Chip key={c} label={c} selected={curriculum === c} onPress={() => setCurriculum(curriculum === c ? '' : c)} />
          ))}
        </Row>
      </Section>
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
        placeholder="e.g. Predicted a 5 and aiming for a 7. Finds essay structure difficult. Mock examinations in January."
      />
      <ErrorNote error={error} />
      <Button title={submitLabel} variant="gold" onPress={send} loading={busy} disabled={!valid} />
      {!hideContact ? <Txt variant="small">We use your details only to reply to this enquiry.</Txt> : null}
    </Card>
  );
}
