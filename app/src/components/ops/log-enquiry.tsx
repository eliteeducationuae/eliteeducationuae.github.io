import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { source } from '@/data';
import { useAction, useTutors } from '@/data/hooks';
import type { NewEnquiry } from '@/data/source';
import { CURRICULA, PHASES, SUBJECTS } from '@/domain/catalogue';
import { withoutClosed } from '@/domain/closed-accounts';
import { tutorTeaches } from '@/domain/enrolments';

import { CataloguePicker } from '../catalogue-picker';
import { Honeypot } from '../honeypot';
import { FormError } from '../spam';
import { Actions, Button, ChipField, Columns, Field, FieldsCard, PageHeader, Screen, Txt, useToast } from '../ui';
import { tutorChipLabel, useComplianceMap } from '../vetting';
import { NoHeader, SummaryCard } from './parts';

type Origin = Extract<NewEnquiry['source'], 'phone' | 'referral' | 'other'>;
const ORIGINS: { value: Origin; label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Something else' },
];

/**
 * The office's "Log an enquiry" page, for a phone call or a referral. It goes through the same submission as the
 * public form (so the same checks apply), then joins the pipeline as New.
 */
export function LogEnquiry() {
  const toast = useToast();
  const submit = useAction(source.submitEnquiry);
  const tutors = useTutors();
  const vetting = useComplianceMap();
  const [parentName, setParentName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [origin, setOrigin] = useState<Origin>('phone');
  const [studentName, setStudentName] = useState('');
  const [yearGroup, setYearGroup] = useState('');
  const [subject, setSubject] = useState<string | undefined>();
  const [phase, setPhase] = useState<string | undefined>();
  const [curriculum, setCurriculum] = useState<string | undefined>();
  const [times, setTimes] = useState('');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [honeypot, setHoneypot] = useState('');

  const noContact = !email.trim() && !phone.trim();
  const valid = !!parentName.trim() && !noContact;
  const likely = subject ? withoutClosed(tutors.data).filter((t) => tutorTeaches(t, subject)) : [];

  async function send() {
    setTried(true);
    if (!valid) return;
    if (honeypot) {
      router.back();
      return;
    }
    try {
      await submit.mutateAsync([
        {
          parentName: parentName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          studentName: studentName.trim() || undefined,
          subject: subject?.trim() || undefined,
          phase: phase?.trim() || undefined,
          curriculum: curriculum?.trim() || undefined,
          yearGroup: yearGroup.trim() || undefined,
          message: message.trim() || undefined,
          preferredTimes: times.trim() || undefined,
          source: origin,
          elapsedMs: Date.now() - startedAt,
        },
      ]);
    } catch {
      return; // shown by FormError
    }
    if (router.canGoBack()) router.back();
    else router.replace('/manage/enquiries');
    toast(`Enquiry from ${parentName.trim()} logged`);
  }

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader
        back={{ fallback: '/manage/enquiries' }}
        kicker="Growth · New"
        title="Log an enquiry"
        sub="For a phone call or a referral. Website and app enquiries arrive here on their own."
      />
      <Columns>
        <View style={{ gap: 20 }}>
          <FieldsCard title="Parent">
            <Field label="Name" value={parentName} onChangeText={setParentName} autoCapitalize="words" placeholder="For example, Fatima Hassan" error={tried && !parentName.trim()} />
            <Honeypot value={honeypot} onChange={setHoneypot} />
            <Field
              label="Mobile"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+971 50 000 0000"
              error={tried && noContact ? 'Add a mobile number or an email address.' : undefined}
            />
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Optional if you have a mobile number" />
            <ChipField label="How they found us" options={ORIGINS} value={origin} onChange={setOrigin} />
          </FieldsCard>
          <FieldsCard title="Student">
            <Field label="Name" value={studentName} onChangeText={setStudentName} autoCapitalize="words" placeholder="For example, Mariam Hassan" />
            <Field label="Year or grade" value={yearGroup} onChangeText={setYearGroup} placeholder="For example, Year 11 or Grade 11" />
            <CataloguePicker label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} collapsed={10} optional otherPlaceholder="For example, Latin" />
            <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
            <CataloguePicker label="Curriculum" options={CURRICULA} value={curriculum} onChange={setCurriculum} optional collapsed={8} />
            <Field label="Preferred times" value={times} onChangeText={setTimes} placeholder="For example, weekday evenings" />
            <Field label="What they asked for" value={message} onChangeText={setMessage} multiline placeholder="Goals, exam dates, anything said on the call" />
          </FieldsCard>
        </View>
        <View style={{ gap: 20 }}>
          <SummaryCard
            kicker="Likely tutors"
            title={subject ? [phase, subject].filter(Boolean).join(' ') : 'Choose a subject'}
            lines={
              subject
                ? likely.length
                  ? likely.map((t) => ({ k: tutorChipLabel(t.fullName, vetting.get(t.id)), v: 'Teaches it' }))
                  : [{ k: 'No current tutor teaches it', v: 'Post a role' }]
                : undefined
            }
            note="The enquiry starts as New. Move it on as you speak to the family."
          />
          <FormError error={submit.error} />
          <Actions>
            <Button title="Log enquiry" icon="check" loading={submit.isPending} onPress={send} />
          </Actions>
          {tried && !valid ? <Txt variant="small" color="danger">Please add the parent’s name and a way to reach them.</Txt> : null}
        </View>
      </Columns>
    </Screen>
  );
}
