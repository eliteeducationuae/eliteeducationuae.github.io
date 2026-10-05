import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar, Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, SectionLabel, Txt } from '@/components/ui';
import { DateKeyField, DocumentRow, DocumentUploadCard, OnboardingChecklist, OverrideForm, useToday, VettingBadge } from '@/components/vetting';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useHandbookAcks, useTutorCompliance, useTutorDocuments, useTutors, useVettingOverrides } from '@/data/hooks';
import type { TutorDocument } from '@/domain/types';
import { activeOverride, formatLongDate, isCleared, validateDocumentDates, vettingSummary } from '@/domain/vetting';
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
      <Screen>
        <EmptyState icon="people" title="Administrators only" message="Tutor checks are available to the Elite Education office only." />
      </Screen>
    );
  }
  if (tutors.isLoading || compliance.isLoading || docs.isLoading || overrides.isLoading) return <Loading />;
  const tutor = tutors.data?.find((t) => t.id === tutorId);
  if (!tutor) {
    return (
      <Screen>
        <EmptyState title="Tutor not found" />
      </Screen>
    );
  }
  const c = compliance.data?.find((x) => x.tutorId === tutorId);
  const active = activeOverride(overrides.data ?? [], tutorId, today);
  const lastAck = (acks.data ?? []).filter((a) => a.tutorId === tutorId).sort((a, b) => b.version - a.version)[0];
  const first = tutor.fullName.split(' ')[0];

  return (
    <Screen onRefresh={() => docs.refetch()} refreshing={docs.isRefetching}>
      <Stack.Screen options={{ title: tutor.fullName }} />
      <Card style={{ gap: Spacing.two }}>
        <Row gap={Spacing.three}>
          <Avatar name={tutor.fullName} color={tutor.color} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h2">{tutor.fullName}</Txt>
            {c ? <Txt variant="muted">{vettingSummary(c, today)}</Txt> : null}
          </View>
        </Row>
        {c ? <VettingBadge status={c.vettingStatus} /> : null}
        {c && !c.enforced ? <Txt variant="small">Police clearance is not currently enforced, so assignments are not blocked.</Txt> : null}
      </Card>

      {c ? (
        <Section title="Onboarding">
          <Card>
            <OnboardingChecklist compliance={c} today={today} />
          </Card>
        </Section>
      ) : null}

      <Section title="Documents">
        {(docs.data ?? []).length === 0 ? (
          <Txt variant="muted">{first} has not uploaded any documents yet.</Txt>
        ) : (
          <View style={{ gap: Spacing.two }}>
            {(docs.data ?? []).map((d) => (
              <DocumentRow key={d.id} doc={d} today={today} canRemove>
                {d.status === 'pending' ? <ReviewPanel doc={d} today={today} /> : null}
              </DocumentRow>
            ))}
          </View>
        )}
        <DocumentUploadCard tutorId={tutorId} onBehalf />
      </Section>

      <Section title="Override">
        {active ? (
          <Card style={{ gap: Spacing.two }}>
            <Banner tone="info" icon="alert">
              Override in place until {formatLongDate(active.expiresAt)}: {active.reason}
            </Banner>
            <Txt variant="small">
              Recorded {formatLongDate(active.createdAt)}
              {active.createdByName ? ` by ${active.createdByName}` : ''}
            </Txt>
            <Row>
              <Button
                title="Revoke override"
                size="sm"
                variant="danger"
                loading={revoke.isPending}
                onPress={() =>
                  confirm('Revoke this override?', `${tutor.fullName} will not be able to be assigned new work until their police clearance is verified.`, () => revoke.mutate([active.id]), 'Revoke')
                }
              />
            </Row>
            <ErrorNote error={revoke.error} />
          </Card>
        ) : null}
        {c && isCleared(c.vettingStatus) ? (
          <Txt variant="muted">{first} is cleared, so no override is needed.</Txt>
        ) : !active ? (
          <OverrideForm tutorId={tutorId} tutorName={tutor.fullName} />
        ) : null}
        {(overrides.data ?? []).length ? (
          <View style={{ gap: Spacing.two }}>
            <SectionLabel>Override history</SectionLabel>
            {(overrides.data ?? []).map((o) => (
              <Card key={o.id} style={{ gap: 2 }}>
                <Txt>{o.reason}</Txt>
                <Txt variant="small">
                  Recorded {formatLongDate(o.createdAt)}
                  {o.createdByName ? ` by ${o.createdByName}` : ''} · until {formatLongDate(o.expiresAt)}
                </Txt>
                {o.revokedAt ? (
                  <Txt variant="small" color="danger">
                    Revoked {formatLongDate(o.revokedAt)}
                    {o.revokedByName ? ` by ${o.revokedByName}` : ''}
                  </Txt>
                ) : new Date(o.expiresAt) <= today ? (
                  <Txt variant="small">Expired</Txt>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title="Handbook">
        <Card>
          <Txt>
            {lastAck
              ? `Version ${lastAck.version} acknowledged on ${formatLongDate(lastAck.acknowledgedAt)}.`
              : `${first} has not yet acknowledged the tutor handbook.`}
            {lastAck && c?.handbookVersion && lastAck.version < c.handbookVersion ? ` Version ${c.handbookVersion} is awaiting acknowledgement.` : ''}
          </Txt>
        </Card>
      </Section>
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
              title="Confirm not accepted"
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
