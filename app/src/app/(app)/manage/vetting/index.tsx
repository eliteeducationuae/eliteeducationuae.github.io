import { router } from 'expo-router';

import { NoHeader, RowMeta, VETTING_TAG } from '@/components/admin-people/kit';
import { Actions, Button, EmptyState, ErrorNote, Group, GroupRow, Loading, Notice, PageHeader, Screen } from '@/components/ui';
import { useToday } from '@/components/vetting';
import { source } from '@/data';
import { useAction, useTutorCompliance, useTutorDocuments, useTutors, useVettingEnforced } from '@/data/hooks';
import { useMe } from '@/data/session';
import { canAssignTutor, documentTypeLabel, formatLongDate, onboardingChecklist, onboardingProgress, vettingSummary } from '@/domain/vetting';
import { confirm } from '@/lib/confirm';

/** Admin: police clearance and onboarding across every tutor, the one enforcement switch and documents to review. */
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
      <Screen topInset>
        <NoHeader />
        <PageHeader back={{ fallback: '/' }} kicker="Team" title="Tutor checks" />
        <EmptyState icon="people" title="Administrators only" message="Tutor checks are available to the Elite Education office only." />
      </Screen>
    );
  }
  if (tutors.isLoading || compliance.isLoading || docs.isLoading || enforced.isLoading) return <Loading />;
  const byTutor = new Map((compliance.data ?? []).map((c) => [c.tutorId, c]));
  const name = (id: string) => tutors.data?.find((t) => t.id === id)?.fullName ?? 'A tutor';
  const pending = (docs.data ?? []).filter((d) => d.status === 'pending');
  // Who cannot take new work now (enforced), or would be blocked straight away if enforcement were turned on.
  const blocked = (compliance.data ?? []).filter((c) => !canAssignTutor({ ...c, enforced: true }, today).allowed).map((c) => name(c.tutorId));
  const impact =
    blocked.length === 0
      ? 'Every tutor is cleared or has an override, so no one will be blocked straight away.'
      : `${blocked.length === 1 ? '1 tutor' : `${blocked.length} tutors`} (${blocked.join(', ')}) will not be able to be assigned new work until verified.`;
  const open = (tutorId: string) => router.push({ pathname: '/manage/vetting/[tutorId]', params: { tutorId } });
  const list = tutors.data ?? [];

  return (
    <Screen topInset onRefresh={() => compliance.refetch()} refreshing={compliance.isRefetching}>
      <NoHeader title="Tutor checks" />
      <PageHeader
        back={{ fallback: '/admin' }}
        kicker="Team"
        title="Tutor checks"
        sub="Police clearance and onboarding for every tutor. Verifying a certificate needs its issue and expiry dates."
      />

      {enforced.data ? (
        <Group title="Police clearance">
          <GroupRow
            icon="verified_user"
            tone="noir"
            title="Required before any new lesson, student or role."
            note={
              blocked.length
                ? `${blocked.join(', ')} cannot take new work until verified, unless you record an override.`
                : 'Every tutor is cleared or has an override, so no one is blocked.'
            }
            action={{
              label: 'Turn off',
              onPress: () =>
                confirm(
                  'Stop requiring police clearance?',
                  'Tutors without a verified certificate could then be assigned new lessons. We recommend keeping this on.',
                  () => setEnforced.mutate([false]),
                  'Turn off',
                ),
            }}
          />
        </Group>
      ) : (
        <Notice tone="warn" title="Not enforced">
          Police clearance is not yet enforced. Tutors without a verified certificate can still be assigned.
        </Notice>
      )}
      {enforced.data ? null : (
        <Actions>
          <Button
            title="Require police clearance"
            icon="verified_user"
            loading={setEnforced.isPending}
            onPress={() =>
              confirm(
                'Require police clearance?',
                `Tutors without a verified certificate will not be able to be assigned new lessons, students or roles. Existing lessons are unaffected. ${impact}`,
                () => setEnforced.mutate([true]),
                'Require',
              )
            }
          />
        </Actions>
      )}
      <ErrorNote error={setEnforced.error} />

      <Group title="Documents to review" meta={pending.length ? `${pending.length} waiting` : undefined} note={pending.length ? undefined : 'There are no documents waiting for review.'}>
        {pending.map((d) => (
          <GroupRow
            key={d.id}
            icon="description"
            title={name(d.tutorId)}
            accessibilityLabel={name(d.tutorId)}
            note={`${d.type === 'other' && d.title ? d.title : documentTypeLabel(d.type)} · uploaded ${formatLongDate(d.createdAt)}${d.expiryDate ? ` · expires ${formatLongDate(d.expiryDate)}` : ''}`}
            right={<RowMeta tag="To review" tone="accent" />}
            onPress={() => open(d.tutorId)}
          />
        ))}
      </Group>

      <Group title="All tutors" meta={`${list.length} ${list.length === 1 ? 'tutor' : 'tutors'}`} note={list.length ? undefined : 'No tutors yet.'}>
        {list.map((t) => {
          const c = byTutor.get(t.id);
          const progress = c ? onboardingProgress(onboardingChecklist(c, today)) : undefined;
          return (
            <GroupRow
              key={t.id}
              avatar={t.fullName}
              avatarColor={t.color}
              title={t.fullName}
              accessibilityLabel={t.fullName}
              note={c ? vettingSummary(c, today) : 'No checks recorded'}
              right={<RowMeta {...(c ? VETTING_TAG[c.vettingStatus] : {})} meta={progress ? `${progress.done} of ${progress.total} onboarding steps` : undefined} />}
              onPress={() => open(t.id)}
            />
          );
        })}
      </Group>

      <Actions>
        <Button title="Tutor handbook" icon="menu_book" variant="secondary" onPress={() => router.push('/handbook')} />
      </Actions>
    </Screen>
  );
}
