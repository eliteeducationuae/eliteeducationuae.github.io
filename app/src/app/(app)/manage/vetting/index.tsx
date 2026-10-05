import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Banner, Button, Card, EmptyState, ErrorNote, ListItem, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { useToday, VettingBadge } from '@/components/vetting';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useTutorCompliance, useTutorDocuments, useTutors, useVettingEnforced } from '@/data/hooks';
import { documentTypeLabel, formatLongDate, onboardingChecklist, onboardingProgress, vettingSummary } from '@/domain/vetting';
import { useMe } from '@/data/session';
import { confirm } from '@/lib/confirm';

/** Admin: police clearance and onboarding across every tutor. */
export default function TutorChecks() {
  const me = useMe();
  const today = useToday();
  const tutors = useTutors();
  const compliance = useTutorCompliance();
  const docs = useTutorDocuments();
  const enforced = useVettingEnforced();
  const setEnforced = useAction(source.setVettingEnforced);

  if (me.role !== 'admin') {
    return (
      <Screen>
        <EmptyState icon="people" title="Administrators only" message="Tutor checks are available to the Elite Education office only." />
      </Screen>
    );
  }
  if (tutors.isLoading || compliance.isLoading || docs.isLoading || enforced.isLoading) return <Loading />;
  const byTutor = new Map((compliance.data ?? []).map((c) => [c.tutorId, c]));
  const name = (id: string) => tutors.data?.find((t) => t.id === id)?.fullName ?? 'A tutor';
  const pending = (docs.data ?? []).filter((d) => d.status === 'pending');
  const open = (tutorId: string) => router.push({ pathname: '/manage/vetting/[tutorId]', params: { tutorId } });

  return (
    <Screen onRefresh={() => compliance.refetch()} refreshing={compliance.isRefetching}>
      <Card style={{ gap: Spacing.three }}>
        <Txt variant="h3">Police clearance requirement</Txt>
        {enforced.data ? (
          <>
            <Txt>
              Police clearance is required. Tutors without a verified certificate cannot be assigned new lessons, students or roles unless you record an
              override.
            </Txt>
            <Row>
              <Button
                title="Turn off"
                size="sm"
                variant="secondary"
                loading={setEnforced.isPending}
                onPress={() =>
                  confirm(
                    'Stop requiring police clearance?',
                    'Tutors without a verified certificate could then be assigned new lessons. We recommend keeping this on.',
                    () => setEnforced.mutate([false]),
                    'Turn off',
                  )
                }
              />
            </Row>
          </>
        ) : (
          <>
            <Banner tone="warning" icon="alert">
              Police clearance is not yet enforced. Tutors without a verified certificate can still be assigned.
            </Banner>
            <Button
              title="Require police clearance"
              variant="gold"
              loading={setEnforced.isPending}
              onPress={() =>
                confirm(
                  'Require police clearance?',
                  'Tutors without a verified certificate will not be able to be assigned new lessons, students or roles. Existing lessons are unaffected.',
                  () => setEnforced.mutate([true]),
                  'Require',
                )
              }
            />
          </>
        )}
        <ErrorNote error={setEnforced.error} />
      </Card>

      <Section title="Documents to review">
        {pending.length === 0 ? (
          <Txt variant="muted">There are no documents waiting for review.</Txt>
        ) : (
          <View style={{ gap: Spacing.two }}>
            {pending.map((d) => (
              <ListItem
                key={d.id}
                title={`${name(d.tutorId)}: ${d.type === 'other' && d.title ? d.title : documentTypeLabel(d.type)}`}
                subtitle={`Uploaded ${formatLongDate(d.createdAt)}${d.expiryDate ? ` · expires ${formatLongDate(d.expiryDate)}` : ''}`}
                onPress={() => open(d.tutorId)}
              />
            ))}
          </View>
        )}
      </Section>

      <Section title="All tutors">
        {(tutors.data ?? []).length === 0 ? <EmptyState icon="people" title="No tutors yet" /> : null}
        <View style={{ gap: Spacing.two }}>
          {(tutors.data ?? []).map((t) => {
            const c = byTutor.get(t.id);
            const progress = c ? onboardingProgress(onboardingChecklist(c, today)) : undefined;
            return (
              <ListItem
                key={t.id}
                title={t.fullName}
                subtitle={[c ? vettingSummary(c, today) : 'No checks recorded', progress ? `${progress.done} of ${progress.total} onboarding steps` : null].filter(Boolean).join(' · ')}
                left={<Avatar name={t.fullName} color={t.color} />}
                below={c ? <VettingBadge status={c.vettingStatus} /> : undefined}
                onPress={() => open(t.id)}
              />
            );
          })}
        </View>
      </Section>

      <Button title="Tutor handbook" icon="book" variant="outline" onPress={() => router.push('/handbook')} />
    </Screen>
  );
}
