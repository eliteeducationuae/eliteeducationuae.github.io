import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { APPLICATION_STATUS, teachingFromApplication } from '@/components/hiring';
import { RepeatNote, SpamActions, SpamBanner } from '@/components/spam';
import { TutorChecksSummary } from '@/components/vetting';
import { tutorColorFor } from '@/lib/tutor-colors';
import { FactsGroup, NoHeader } from '@/components/admin-people/kit';
import { Actions, Button, ChipField, Columns, EmptyState, ErrorNote, Field, FieldsCard, Group, Loading, Notice, PageHeader, Screen, Txt } from '@/components/ui';
import { source } from '@/data';
import { useAction, useApplications } from '@/data/hooks';
import { relativeDay } from '@/domain/dates';
import { isPossibleSpam } from '@/domain/spam';
import type { ApplicationStatus, TutorApplication } from '@/domain/types';
import { confirm, notify } from '@/lib/confirm';

const STAGES: ApplicationStatus[] = ['applied', 'interview', 'offer', 'hired', 'rejected'];

export default function ApplicationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const applications = useApplications();
  if (applications.isLoading) return <Loading />;
  const a = applications.data?.find((x) => x.id === id);
  if (!a) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/manage/applications' }} kicker="Hiring" title="Application not found" />
        <EmptyState title="Application not found" />
      </Screen>
    );
  }
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
    router.push({ pathname: '/manage/tutor/[id]', params: { id: tutor.id } });
  }

  const first = a.fullName.split(' ')[0];
  const stage = APPLICATION_STATUS[a.status];
  return (
    <Screen topInset>
      <NoHeader title={a.fullName} />
      <PageHeader
        back={{ fallback: '/manage/applications' }}
        kicker={`Hiring · ${stage.label}`}
        title={a.fullName}
        sub={[a.subjects, a.curricula.join(', '), (a.phases ?? []).join(', ')].filter(Boolean).join(' · ') || undefined}
      />
      <SpamBanner kind="application" id={a.id} item={a} />
      <RepeatNote repeatCount={a.repeatCount} />

      <Columns>
        <FactsGroup
          title="Application"
          facts={[
            { k: 'Applied', v: relativeDay(a.createdAt) },
            { k: 'Email', v: a.email },
            { k: 'Phone', v: a.phone },
            { k: 'Qualifications', v: a.qualifications },
            { k: 'Available', v: a.availability },
          ]}
        />
        <Group title="In their words" note={a.experience || 'They did not add anything about their experience.'} />
      </Columns>

      <Actions>
        {a.cvPath ? <Button title="Open CV" icon="description" variant="secondary" onPress={openCv} /> : null}
        <Button title="Email" icon="mail" variant="secondary" onPress={() => Linking.openURL(`mailto:${a.email}?subject=${encodeURIComponent('Your application to Elite Education')}`)} />
        {phone ? <Button title="WhatsApp" icon="chat_bubble" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/${phone.replace('+', '')}`)} /> : null}
      </Actions>
      {!isPossibleSpam(a) && a.status === 'applied' ? <SpamActions kind="application" id={a.id} status={a.spamStatus} compact /> : null}

      <FieldsCard title="Stage">
        <ChipField
          options={STAGES.filter((s) => s !== 'hired').map((s) => ({ value: s, label: APPLICATION_STATUS[s].label }))}
          value={a.status}
          onChange={(s) => update.mutate([a.id, { status: s }])}
        />
      </FieldsCard>

      {a.status === 'hired' && a.tutorId ? (
        <>
          <Notice tone="good" title="Hired" link={{ label: 'Open their profile', onPress: () => router.push({ pathname: '/manage/tutor/[id]', params: { id: a.tutorId! } }) }}>
            Their tutor profile is set up. Their onboarding checklist has started: police clearance, bank details, availability and the tutor handbook.
          </Notice>
          <TutorChecksSummary tutorId={a.tutorId} />
        </>
      ) : (
        <FieldsCard title={`Hire ${first}`}>
          <Txt variant="muted">This creates their tutor profile. They then create their login in the app with {a.email}, add bank details and set their availability.</Txt>
          <Field label="Pay per hour (AED)" value={pay} onChangeText={setPay} keyboardType="decimal-pad" hint="What the tutor is paid. You can change it later on their profile." />
          <View style={{ flexDirection: 'row' }}>
            <Button
              title="Hire and create tutor profile"
              icon="person_add"
              loading={saveTutor.isPending || update.isPending}
              onPress={() => confirm(`Hire ${a.fullName}?`, 'This creates their tutor profile.', hire, 'Hire')}
            />
          </View>
        </FieldsCard>
      )}

      <FieldsCard title="Notes">
        <Field label="Interview notes (staff only)" value={notes} onChangeText={setNotes} multiline />
        <View style={{ flexDirection: 'row' }}>
          <Button title="Save notes" icon="save" variant="secondary" loading={update.isPending} onPress={() => update.mutate([a.id, { notes: notes.trim() }])} />
        </View>
      </FieldsCard>
      <ErrorNote error={update.error ?? saveTutor.error} />
    </Screen>
  );
}
