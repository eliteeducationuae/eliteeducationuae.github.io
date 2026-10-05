import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Card, EmptyState, Loading, Row, Screen, Section, Txt, Banner } from '@/components/ui';
import { DocumentRow, DocumentUploadCard, OnboardingChecklist, useComplianceFor, useToday, VettingBadge } from '@/components/vetting';
import { Spacing } from '@/constants/theme';
import { useTutorDocuments, useTutors } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatLongDate, vettingSummary } from '@/domain/vetting';

/** A tutor's police clearance, onboarding steps and documents. Admins may pass ?tutorId= to act for a tutor. */
export default function MyChecks() {
  const me = useMe();
  const params = useLocalSearchParams<{ tutorId?: string }>();
  // An admin who also tutors (Craig) sees their own checks when no tutor is named, e.g. from a notification link.
  const tutorId = me.role === 'admin' ? (params.tutorId ?? me.tutorId ?? undefined) : me.tutorId;
  const today = useToday();
  const tutors = useTutors();
  const { compliance: c, isLoading } = useComplianceFor(tutorId);
  const docs = useTutorDocuments(tutorId);

  if (!tutorId) {
    return (
      <Screen>
        <EmptyState icon="person" title="No tutor selected" message="Open a tutor from Tutor checks to see their documents." />
      </Screen>
    );
  }
  if (isLoading || docs.isLoading) return <Loading />;
  const own = !!me.tutorId && tutorId === me.tutorId;
  const name = tutors.data?.find((t) => t.id === tutorId)?.fullName;
  const renewBy = c?.clearanceExpiry ? formatLongDate(c.clearanceExpiry) : undefined;

  return (
    <Screen onRefresh={() => docs.refetch()} refreshing={docs.isRefetching}>
      {!own && name ? <Stack.Screen options={{ title: `${name}: checks` }} /> : null}
      {c ? (
        <Card style={{ gap: Spacing.two }}>
          <Row style={{ justifyContent: 'space-between' }} wrap>
            <Txt variant="h2">Police clearance</Txt>
            <VettingBadge status={c.vettingStatus} />
          </Row>
          <Txt variant="muted">{vettingSummary(c, today)}</Txt>
          {c.vettingStatus === 'missing' ? (
            <Txt>Please upload your police clearance certificate below. Once we have verified it, we can begin to assign you lessons.</Txt>
          ) : null}
          {c.vettingStatus === 'pending' ? <Txt>Thank you. We are reviewing your certificate and will let you know once it has been verified.</Txt> : null}
        </Card>
      ) : null}
      {c && (c.vettingStatus === 'expiring' || c.vettingStatus === 'expired') ? (
        <Banner tone={c.vettingStatus === 'expired' ? 'danger' : 'warning'} icon="alert">
          {c.vettingStatus === 'expired'
            ? 'Your police clearance has expired. Please upload your renewed certificate so that we can continue to assign you lessons.'
            : `Please upload your renewed certificate before ${renewBy} so that we can continue to assign you lessons.`}
        </Banner>
      ) : null}

      {c ? (
        <Section title="Onboarding">
          <Card>
            <OnboardingChecklist compliance={c} today={today} links={own} />
          </Card>
        </Section>
      ) : null}

      <Section title={own ? 'My documents' : 'Documents'}>
        {(docs.data ?? []).length === 0 ? (
          <EmptyState icon="doc" title="No documents yet" message="Documents you upload appear here with their review status." />
        ) : (
          <View style={{ gap: Spacing.two }}>
            {(docs.data ?? []).map((d) => (
              <DocumentRow key={d.id} doc={d} today={today} canRemove />
            ))}
          </View>
        )}
      </Section>

      <Section title="Upload">
        <DocumentUploadCard tutorId={tutorId} onBehalf={!own} />
      </Section>
    </Screen>
  );
}
