import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { APPLICATION_STATUS, teachingFromApplication } from '@/components/hiring';
import { TutorChecksSummary } from '@/components/vetting';
import { tutorColorFor } from '@/lib/tutor-colors';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useApplications } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import type { ApplicationStatus, TutorApplication } from '@/domain/types';
import { confirm, notify } from '@/lib/confirm';

const STAGES: ApplicationStatus[] = ['applied', 'interview', 'offer', 'hired', 'rejected'];

export default function ApplicationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const applications = useApplications();
  if (applications.isLoading) return <Loading />;
  const a = applications.data?.find((x) => x.id === id);
  if (!a) return <Screen><EmptyState title="Application not found" /></Screen>;
  return <Detail key={a.id} a={a} />;
}

function Detail({ a }: { a: TutorApplication }) {
  const update = useAction(source.updateApplication);
  const saveTutor = useAction(source.saveTutor);
  const [notes, setNotes] = useState(a.notes ?? '');
  const [pay, setPay] = useState('200');
  const phone = a.phone?.replace(/[^\d+]/g, '');

  async function openCv() {
    const url = a.cvPath && source.fileUrl ? await source.fileUrl('applications', a.cvPath) : null;
    if (url) Linking.openURL(url);
    else notify('CV', a.cvPath ? `Stored as ${a.cvPath} (files are not stored in demo mode).` : 'No CV attached.');
  }

  async function hire() {
    const tutor = await saveTutor.mutateAsync([
      {
        fullName: a.fullName,
        email: a.email,
        phone: a.phone,
        hourlyPay: Number(pay) || 0,
        ...teachingFromApplication(a),
        color: tutorColorFor(a.fullName),
      },
    ]);
    await update.mutateAsync([a.id, { status: 'hired', tutorId: tutor.id }]);
    router.push({ pathname: '/manage/tutor-edit', params: { id: tutor.id } });
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: a.fullName }} />
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{a.fullName}</Txt>
            <Txt variant="muted">
              Applied {relativeDay(a.createdAt).toLowerCase()} · {a.email}
              {a.phone ? ` · ${a.phone}` : ''}
            </Txt>
          </View>
          <Badge label={APPLICATION_STATUS[a.status].label} tone={APPLICATION_STATUS[a.status].tone} />
        </Row>
        {a.subjects ? (
          <Txt>
            <Txt style={{ fontWeight: '700' }}>Subjects: </Txt>
            {a.subjects}
          </Txt>
        ) : null}
        {a.curricula.length ? (
          <Txt>
            <Txt style={{ fontWeight: '700' }}>Curricula: </Txt>
            {a.curricula.join(', ')}
          </Txt>
        ) : null}
        {a.phases?.length ? (
          <Txt>
            <Txt style={{ fontWeight: '700' }}>Phases: </Txt>
            {a.phases.join(', ')}
          </Txt>
        ) : null}
        {a.qualifications ? <Txt variant="muted">Qualifications: {a.qualifications}</Txt> : null}
        {a.experience ? <Txt>{a.experience}</Txt> : null}
        {a.availability ? <Txt variant="muted">Available: {a.availability}</Txt> : null}
        <Row gap={Spacing.two} wrap>
          {a.cvPath ? <Button title="Open CV" icon="doc" size="sm" variant="secondary" onPress={openCv} /> : null}
          <Button title="Email" icon="mail" size="sm" variant="secondary" onPress={() => Linking.openURL(`mailto:${a.email}?subject=${encodeURIComponent('Your application to Elite Education')}`)} />
          {phone ? <Button title="WhatsApp" icon="chat" size="sm" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/${phone.replace('+', '')}`)} /> : null}
        </Row>
      </Card>

      <Section title="Stage">
        <Row gap={Spacing.one} wrap>
          {STAGES.filter((s) => s !== 'hired').map((s) => (
            <Chip key={s} label={APPLICATION_STATUS[s].label} selected={a.status === s} onPress={() => update.mutate([a.id, { status: s }])} />
          ))}
        </Row>
      </Section>

      {a.status === 'hired' && a.tutorId ? (
        <View style={{ gap: Spacing.two }}>
          <Banner tone="success" icon="check">
            Hired — their tutor profile is set up.{' '}
            <Txt variant="muted" color="accent" onPress={() => router.push({ pathname: '/manage/tutor-edit', params: { id: a.tutorId! } })}>
              Open profile and send invitation
            </Txt>
          </Banner>
          <Txt variant="muted">Their onboarding checklist has started: police clearance, bank details, availability and the tutor handbook.</Txt>
          <TutorChecksSummary tutorId={a.tutorId} />
        </View>
      ) : (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="h3">Hire {a.fullName.split(' ')[0]}</Txt>
          <Txt variant="muted">This creates their tutor profile. You can then send an invitation so that they can create their login, add bank details and set their availability.</Txt>
          <Field label="Pay per hour (AED)" value={pay} onChangeText={setPay} keyboardType="decimal-pad" />
          <Button title="Hire and create tutor profile" variant="gold" loading={saveTutor.isPending || update.isPending} onPress={() => confirm(`Hire ${a.fullName}?`, 'This creates their tutor profile.', hire, 'Hire')} />
        </Card>
      )}

      <Section title="Notes">
        <Field label="Interview notes (staff only)" value={notes} onChangeText={setNotes} multiline />
        <Button title="Save notes" variant="secondary" loading={update.isPending} onPress={() => update.mutate([a.id, { notes: notes.trim() }])} />
      </Section>
      <ErrorNote error={update.error ?? saveTutor.error} />
    </Screen>
  );
}
