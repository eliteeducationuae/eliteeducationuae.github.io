import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { EmptyState, FieldsCard, Loading, Notice, PageHeader, Screen, Section } from '@/components/ui';
import { DocumentRow, DocumentUploadCard, OnboardingChecklist, useComplianceFor, useToday } from '@/components/vetting';
import { useTutorDocuments, useTutors } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
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
  const viewing = !!useViewing();

  if (!tutorId) {
    return (
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back kicker="Elite Education" title="Checks" />
        <EmptyState icon="person" title="No tutor selected" message="Open a tutor from Tutor checks to see their documents." />
      </Screen>
    );
  }
  if (isLoading || docs.isLoading) return <Loading />;
  const own = !!me.tutorId && tutorId === me.tutorId;
  const name = tutors.data?.find((t) => t.id === tutorId)?.fullName;
  const renewBy = c?.clearanceExpiry ? formatLongDate(c.clearanceExpiry) : undefined;

  const tone = !c ? 'info' : c.vettingStatus === 'cleared' ? 'good' : c.vettingStatus === 'pending' ? 'info' : c.vettingStatus === 'expiring' ? 'warn' : 'danger';
  const detail = !c
    ? ''
    : c.vettingStatus === 'missing'
      ? 'Please upload your police clearance certificate below. Once we have verified it, we can begin to assign you lessons.'
      : c.vettingStatus === 'pending'
        ? 'Thank you. We are reviewing your certificate and will let you know once it has been verified.'
        : c.vettingStatus === 'expired'
          ? 'Your police clearance has expired. Please upload your renewed certificate so that we can continue to assign you lessons.'
          : c.vettingStatus === 'expiring'
            ? `Please upload your renewed certificate before ${renewBy} so that we can continue to assign you lessons.`
            : 'We will remind you before it expires.';

  return (
    <Screen topInset onRefresh={() => docs.refetch()} refreshing={docs.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Elite Education" title={own ? 'My checks and documents' : `${name ?? 'Tutor'}: checks`} />
      {c ? (
        <Notice tone={tone} icon="verified_user" title="Police clearance">
          {`${vettingSummary(c, today)}. ${detail}`}
        </Notice>
      ) : null}

      {c ? (
        <FieldsCard title="Onboarding">
          <OnboardingChecklist compliance={c} today={today} links={own} />
        </FieldsCard>
      ) : null}

      <Section title={own ? 'My documents' : 'Documents'}>
        {(docs.data ?? []).length === 0 ? (
          <EmptyState icon="description" title="No documents yet" message="Documents you upload appear here with their review status." />
        ) : (
          <View style={{ gap: 12 }}>
            {(docs.data ?? []).map((d) => (
              <DocumentRow key={d.id} doc={d} today={today} canRemove={!viewing} />
            ))}
          </View>
        )}
      </Section>

      {!viewing ? (
        <Section title="Upload">
          <DocumentUploadCard tutorId={tutorId} onBehalf={!own} />
        </Section>
      ) : null}
    </Screen>
  );
}
