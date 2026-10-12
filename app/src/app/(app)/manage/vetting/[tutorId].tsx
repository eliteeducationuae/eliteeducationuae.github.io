import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader, Tag, VETTING_TAG } from '@/components/admin-people/kit';
import { Actions, Banner, Button, Columns, EmptyState, ErrorNote, Field, Group, GroupRow, Loading, Notice, PageHeader, Row, Screen, Section, Txt } from '@/components/ui';
import { DateKeyField, DocumentRow, DocumentUploadCard, OverrideForm, useToday } from '@/components/vetting';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useHandbookAcks, useTutorCompliance, useTutorDocuments, useTutors, useVettingOverrides } from '@/data/hooks';
import type { TutorDocument } from '@/domain/types';
import { activeOverride, formatLongDate, isCleared, onboardingChecklist, onboardingProgress, validateDocumentDates, vettingSummary } from '@/domain/vetting';
import { useMe } from '@/data/session';
import { confirm } from '@/lib/confirm';

/** Admin: one tutor's police clearance, documents, overrides and handbook acknowledgement. */
export default function TutorChecksDetail() {
  const me = useMe();
  const { tutorId } = useLocalSearchParams<{ tutorId: string }>();
  const today = useToday();
  const tutors = useTutors();
  const compliance = useTutorCompliance();
  const docs = useTutorDocuments(tutorId);
  const overrides = useVettingOverrides(tutorId);
  const acks = useHandbookAcks(tutorId);
  const revoke = useAction(source.revokeVettingOverride);

  if (me.role !== 'admin') {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/' }} kicker="Team" title="Tutor checks" />
        <EmptyState icon="people" title="Administrators only" message="Tutor checks are available to the Elite Education office only." />
      </Screen>
    );
  }
  if (tutors.isLoading || compliance.isLoading || docs.isLoading || overrides.isLoading) return <Loading />;
  const tutor = tutors.data?.find((t) => t.id === tutorId);
  if (!tutor) {
    return (
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/manage/vetting' }} kicker="Tutor checks" title="Tutor not found" />
        <EmptyState title="Tutor not found" />
      </Screen>
    );
  }
  const c = compliance.data?.find((x) => x.tutorId === tutorId);
  const active = activeOverride(overrides.data ?? [], tutorId, today);
  const lastAck = (acks.data ?? []).filter((a) => a.tutorId === tutorId).sort((a, b) => b.version - a.version)[0];
  const first = tutor.fullName.split(' ')[0];
  const items = c ? onboardingChecklist(c, today) : [];
  const progress = c ? onboardingProgress(items) : undefined;
  const vet = c ? VETTING_TAG[c.vettingStatus] : undefined;

  return (
    <Screen topInset onRefresh={() => docs.refetch()} refreshing={docs.isRefetching}>
      <NoHeader title={tutor.fullName} />
      <PageHeader
        back={{ fallback: '/manage/vetting' }}
        kicker="Tutor checks"
        title={tutor.fullName}
        sub={c ? vettingSummary(c, today) : undefined}
        right={vet ? <Tag label={vet.tag} tone={vet.tone} /> : undefined}
      />
      {c && !c.enforced ? <Notice tone="info">Police clearance is not currently enforced, so assignments are not blocked.</Notice> : null}

      <Columns>
        <Group title="Onboarding" meta={progress ? `${progress.done} of ${progress.total} complete` : undefined} note={c ? undefined : 'No checks recorded yet.'}>
          {items.map((i) => (
            <GroupRow
              key={i.key}
              icon={i.done ? 'check_circle' : 'radio_button_unchecked'}
              tone={i.done ? 'good' : 'neutral'}
              title={i.label}
              note={[i.optional ? 'Optional' : null, i.detail].filter(Boolean).join(' · ') || undefined}
              value={i.done ? 'Done' : 'Outstanding'}
              valueTone={i.done ? 'good' : i.optional ? 'muted' : 'warn'}
            />
          ))}
        </Group>
        <View style={{ gap: 26 }}>
          <Group title="Handbook">
            <GroupRow
              icon="menu_book"
              tone={lastAck && !(c?.handbookVersion && lastAck.version < c.handbookVersion) ? 'good' : 'warn'}
              title={lastAck ? `Version ${lastAck.version} acknowledged` : 'Not yet acknowledged'}
              note={
                (lastAck ? `On ${formatLongDate(lastAck.acknowledgedAt)}.` : `${first} has not yet acknowledged the tutor handbook.`) +
                (lastAck && c?.handbookVersion && lastAck.version < c.handbookVersion ? ` Version ${c.handbookVersion} is awaiting acknowledgement.` : '')
              }
              onPress={() => router.push('/handbook')}
            />
          </Group>
          <Group title="Profile">
            <GroupRow avatar={tutor.fullName} avatarColor={tutor.color} title={tutor.fullName} note="Teaching, pay and history" onPress={() => router.push({ pathname: '/manage/tutor/[id]', params: { id: tutor.id } })} />
          </Group>
        </View>
      </Columns>

      <Section title="Documents">
        <View style={{ gap: 12 }}>
          {(docs.data ?? []).length === 0 ? (
            <Txt variant="muted">{first} has not uploaded any documents yet.</Txt>
          ) : (
            (docs.data ?? []).map((d) => (
              <DocumentRow key={d.id} doc={d} today={today} canRemove>
                {d.status === 'pending' ? <ReviewPanel doc={d} today={today} /> : null}
              </DocumentRow>
            ))
          )}
          <DocumentUploadCard tutorId={tutorId} onBehalf />
        </View>
      </Section>

      <Section title="Override">
        <View style={{ gap: 12 }}>
          {active ? (
            <Notice tone="info" title={`Override in place until ${formatLongDate(active.expiresAt)}`}>
              {`${active.reason}. Recorded ${formatLongDate(active.createdAt)}${active.createdByName ? ` by ${active.createdByName}` : ''}.`}
            </Notice>
          ) : null}
          {active ? (
            <Actions>
              <Button
                title="Revoke override"
                variant="danger"
                loading={revoke.isPending}
                onPress={() =>
                  confirm('Revoke this override?', `${tutor.fullName} will not be able to be assigned new work until their police clearance is verified.`, () => revoke.mutate([active.id]), 'Revoke')
                }
              />
            </Actions>
          ) : null}
          <ErrorNote error={revoke.error} />
          {c && isCleared(c.vettingStatus) ? (
            <Txt variant="muted">{first} is cleared, so no override is needed.</Txt>
          ) : !active ? (
            <OverrideForm tutorId={tutorId} tutorName={tutor.fullName} />
          ) : null}
        </View>
      </Section>
      {(overrides.data ?? []).length ? (
        <Group title="Override history">
          {(overrides.data ?? []).map((o) => (
            <GroupRow
              key={o.id}
              icon="history"
              tone={o.revokedAt ? 'bad' : 'neutral'}
              title={o.reason}
              note={`Recorded ${formatLongDate(o.createdAt)}${o.createdByName ? ` by ${o.createdByName}` : ''} · until ${formatLongDate(o.expiresAt)}`}
              value={o.revokedAt ? `Revoked ${formatLongDate(o.revokedAt)}${o.revokedByName ? ` by ${o.revokedByName}` : ''}` : new Date(o.expiresAt) <= today ? 'Expired' : 'In place'}
              valueTone={o.revokedAt ? 'bad' : 'muted'}
              valueSize={12.5}
            />
          ))}
        </Group>
      ) : null}
    </Screen>
  );
}

function ReviewPanel({ doc, today }: { doc: TutorDocument; today: Date }) {
  const review = useAction(source.reviewTutorDocument);
  const [issueDate, setIssueDate] = useState(doc.issueDate ?? '');
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate ?? '');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function verify() {
    const problem = validateDocumentDates({ type: doc.type, issueDate, expiryDate }, today);
    setError(problem);
    if (problem) return;
    review.mutate([doc.id, { approve: true, issueDate: issueDate.trim() || undefined, expiryDate: expiryDate.trim() || undefined }]);
  }

  return (
    <View style={{ gap: Spacing.three, marginTop: Spacing.two }}>
      <Txt variant="label">Review</Txt>
      <Txt variant="muted">Please check the dates against the certificate before verifying it.</Txt>
      <Row gap={Spacing.two} wrap style={{ alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <DateKeyField label="Issue date" value={issueDate} onChange={setIssueDate} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <DateKeyField label="Expiry date" value={expiryDate} onChange={setExpiryDate} />
        </View>
      </Row>
      {rejecting ? (
        <Field
          label="Note to the tutor"
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="For example, the certificate is not legible. Please upload a clearer scan."
          hint="The tutor sees this note with the document."
        />
      ) : null}
      {error ? <Banner tone="danger" icon="alert">{error}</Banner> : null}
      <ErrorNote error={review.error} />
      <Row gap={Spacing.two} wrap>
        {rejecting ? (
          <>
            <Button
              title="Return to tutor"
              variant="danger"
              size="sm"
              disabled={note.trim().length < 3}
              loading={review.isPending}
              onPress={() => review.mutate([doc.id, { approve: false, note: note.trim() }])}
            />
            <Button title="Cancel" variant="ghost" size="sm" onPress={() => setRejecting(false)} />
          </>
        ) : (
          <>
            <Button title="Verify" icon="check" variant="gold" size="sm" loading={review.isPending} onPress={verify} />
            <Button title="Not accepted" variant="secondary" size="sm" onPress={() => setRejecting(true)} />
          </>
        )}
      </Row>
    </View>
  );
}
