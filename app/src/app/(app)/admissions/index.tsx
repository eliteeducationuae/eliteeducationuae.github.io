import { router } from 'expo-router';
import { useState } from 'react';

import { CaseCard } from '@/components/admissions/case-card';
import { adviserName, firstName } from '@/components/admissions/format';
import { AdmissionsIntro } from '@/components/admissions/intro';
import { Button, EmptyState, ErrorNote, Loading, Screen, Section, Segmented, Txt } from '@/components/ui';
import { useAdmissionsCases, useAdmissionsKeyDates, useAdmissionsTargets, useAdmissionsTasks, useLookup } from '@/data/hooks';
import { useMe } from '@/data/session';
import { CASE_STATUS_LABELS, type AdmissionsCase, type AdmissionsCaseStatus } from '@/domain/admissions';

type Filter = 'active' | 'on-hold' | 'completed' | 'all';
const STATUS_ORDER: AdmissionsCaseStatus[] = ['active', 'on-hold', 'completed', 'closed'];

export default function AdmissionsIndex() {
  const me = useMe();
  const lookup = useLookup();
  const cases = useAdmissionsCases();
  const targets = useAdmissionsTargets();
  const dates = useAdmissionsKeyDates();
  const tasks = useAdmissionsTasks();
  const [now] = useState(() => new Date());
  const [filter, setFilter] = useState<Filter>('active');
  const isAdmin = me.role === 'admin';
  const isFamily = me.role === 'parent' || me.role === 'student';

  if (cases.isLoading || !lookup.ready) return <Loading />;
  const all = cases.data ?? [];

  const card = (c: AdmissionsCase) => (
    <CaseCard
      key={c.id}
      c={c}
      studentName={lookup.student(c.studentId)?.fullName ?? 'Student'}
      adviser={adviserName(c, lookup)}
      targets={(targets.data ?? []).filter((t) => t.caseId === c.id)}
      dates={(dates.data ?? []).filter((d) => d.caseId === c.id)}
      tasks={(tasks.data ?? []).filter((t) => t.caseId === c.id)}
      now={now}
      onPress={() => router.push({ pathname: '/admissions/[id]', params: { id: c.id } })}
    />
  );

  const refresh = () => {
    cases.refetch();
    targets.refetch();
    dates.refetch();
    tasks.refetch();
  };

  if (isFamily && all.length === 0) {
    return (
      <Screen onRefresh={refresh} refreshing={cases.isRefetching}>
        <AdmissionsIntro onSpeak={me.role === 'parent' ? () => router.push('/parent/messages') : undefined} />
      </Screen>
    );
  }

  // Only the office filters by status; advisers and families always see every case they can open.
  const effective: Filter = isAdmin ? filter : 'all';
  const shown = all.filter((c) =>
    effective === 'all' ? true : effective === 'completed' ? c.status === 'completed' || c.status === 'closed' : c.status === effective,
  );
  const groups = STATUS_ORDER.map((s) => ({ status: s, list: shown.filter((c) => c.status === s) })).filter((g) => g.list.length);

  return (
    <Screen onRefresh={refresh} refreshing={cases.isRefetching}>
      {isFamily ? (
        <Txt variant="muted">
          {all.length === 1
            ? `${firstName(lookup.student(all[0].studentId)?.fullName) || 'Your child'}’s applications, key dates and updates from your adviser.`
            : 'Applications, key dates and updates from your adviser, for each of your children.'}
        </Txt>
      ) : me.role === 'tutor' ? (
        <Txt variant="muted">The families you advise on school and university admissions.</Txt>
      ) : null}

      {isAdmin ? (
        <>
          <Button
            title="New case"
            icon="plus"
            variant="gold"
            onPress={() => router.push('/admissions/edit')}
          />
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'on-hold', label: 'On hold' },
              { value: 'completed', label: 'Completed' },
              { value: 'all', label: 'All' },
            ]}
          />
        </>
      ) : null}

      <ErrorNote error={cases.error} />

      {all.length === 0 ? (
        <EmptyState
          icon="school"
          title={isAdmin ? 'No admissions cases yet' : 'No families to advise at present'}
          message={
            isAdmin
              ? 'Open a case for a student to track their shortlist, key dates, tasks, documents and monthly updates.'
              : 'When the office asks you to advise a family on admissions, their case will appear here.'
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="school" title="Nothing to show" message="There are no cases with this status." />
      ) : isAdmin && filter === 'all' ? (
        groups.map((g) => (
          <Section key={g.status} title={CASE_STATUS_LABELS[g.status]}>
            {g.list.map(card)}
          </Section>
        ))
      ) : (
        shown.map(card)
      )}
    </Screen>
  );
}
