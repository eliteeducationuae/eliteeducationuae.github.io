import { router } from 'expo-router';
import { useState } from 'react';

import { NoHeader, RowMeta, SearchField, VETTING_TAG } from '@/components/admin-people/kit';
import { ClosedToggle } from '@/components/closed-accounts';
import { Actions, Button, EmptyState, Group, GroupRow, Loading, PageHeader, Screen } from '@/components/ui';
import { useLoginEmails, useTutorCompliance, useTutors } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { CLOSED_LABEL, closedCount, closedLast, isClosed } from '@/domain/closed-accounts';

export default function Tutors() {
  const tutors = useTutors();
  const logins = new Set(useLoginEmails().data ?? []);
  const compliance = useTutorCompliance();
  const [query, setQuery] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const q = query.trim().toLowerCase();
  const matching = (tutors.data ?? []).filter((t) => !q || `${t.fullName} ${t.subjects.join(' ')} ${t.curricula.join(' ')}`.toLowerCase().includes(q));
  const list = closedLast(matching, showClosed);
  const open = list.filter((t) => !isClosed(t)).length;
  return (
    <Screen topInset onRefresh={() => tutors.refetch()} refreshing={tutors.isRefetching}>
      <NoHeader title="Tutors" />
      <PageHeader back={{ fallback: '/admin' }} kicker="Team" title="Tutors" />
      <SearchField placeholder="Tutor or subject" value={query} onChangeText={setQuery} />
      {tutors.isLoading ? (
        <Loading />
      ) : list.length === 0 && !closedCount(matching) ? (
        <EmptyState icon="people" title="No tutors found" message="Please try another name or subject, or add a new tutor." />
      ) : (
        <Group meta={`${open} ${open === 1 ? 'tutor' : 'tutors'}`}>
          {list.map((t) => {
            const vetting = compliance.data?.find((c) => c.tutorId === t.id)?.vettingStatus;
            const canLogIn = !!t.email && logins.has(t.email.toLowerCase());
            return (
              <GroupRow
                key={t.id}
                avatar={t.fullName}
                avatarColor={t.color}
                title={t.fullName}
                note={
                  isClosed(t)
                    ? 'Kept for past lessons and pay records'
                    : [t.subjects.join(', ') || 'No subjects yet', (t.phases ?? []).join(', '), `${formatAED(t.hourlyPay ?? 0)} an hour`].filter(Boolean).join(' · ')
                }
                right={isClosed(t) ? <RowMeta tag={CLOSED_LABEL} /> : <RowMeta {...(vetting ? VETTING_TAG[vetting] : {})} meta={canLogIn ? 'Can sign in' : 'No login yet'} />}
                onPress={() => router.push({ pathname: '/manage/tutor/[id]', params: { id: t.id } })}
              />
            );
          })}
        </Group>
      )}
      <ClosedToggle count={closedCount(matching)} showing={showClosed} onToggle={() => setShowClosed((s) => !s)} />
      <Actions>
        <Button title="Add a tutor" icon="add" onPress={() => router.push('/manage/tutor-edit')} />
        <Button title="Tutor checks" icon="verified_user" variant="secondary" onPress={() => router.push('/manage/vetting')} />
      </Actions>
    </Screen>
  );
}
