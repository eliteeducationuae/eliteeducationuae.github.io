import { router } from 'expo-router';

import { useAdmissionsCases, useAdvisoryUpdates } from '@/data/hooks';
import { useMe } from '@/data/session';
import { CASE_KIND_LABELS, CASE_STATUS_LABELS } from '@/domain/admissions';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from '../icon';
import { Badge, ListItem, Section } from '../ui';

/** Updates awaiting the office's approval, for the admin badge. */
export function useAdvisoryUpdatesToApprove(): number {
  const updates = useAdvisoryUpdates();
  return (updates.data ?? []).filter((u) => u.status === 'submitted').length;
}

/**
 * "Admissions advisory" on the account page, shown only to people with at least one case:
 * families (their children's cases) and tutors (the families they advise).
 */
export function AdmissionsAccountLink() {
  const theme = useTheme();
  const me = useMe();
  const cases = useAdmissionsCases();
  const list = cases.data ?? [];
  if (!list.length) return null;
  const families = new Set(list.map((c) => c.familyId)).size;
  const subtitle =
    me.role === 'tutor'
      ? `${families === 1 ? '1 family' : `${families} families`} you advise`
      : 'Applications, key dates and updates from your adviser';
  const body = (
    <ListItem
      title="Admissions advisory"
      subtitle={subtitle}
      left={<Icon name="school" size={22} color={theme.accent} />}
      onPress={() => router.push('/admissions')}
    />
  );
  // Tutors already have a "My work" section; families get one of their own.
  return me.role === 'tutor' ? body : <Section title="Admissions">{body}</Section>;
}

/** On a student's page (admin and advisers): their admissions cases, or a way for the office to open one. */
export function StudentAdmissionsLinks({ studentId }: { studentId: string }) {
  const theme = useTheme();
  const me = useMe();
  const cases = useAdmissionsCases(studentId);
  if (me.role !== 'admin' && me.role !== 'tutor') return null;
  const list = cases.data ?? [];
  if (!list.length && me.role !== 'admin') return null;
  return (
    <Section title="Admissions">
      {list.map((c) => (
        <ListItem
          key={c.id}
          title={c.title}
          subtitle={`${CASE_KIND_LABELS[c.kind]} · ${CASE_STATUS_LABELS[c.status]}`}
          left={<Icon name="school" size={22} color={theme.accent} />}
          onPress={() => router.push({ pathname: '/admissions/[id]', params: { id: c.id } })}
        />
      ))}
      {!list.length ? (
        <ListItem
          title="Open an admissions case"
          subtitle="School, boarding and university applications"
          left={<Icon name="plus" size={22} color={theme.accent} />}
          right={<Badge label="Advisory" tone="gold" />}
          onPress={() => router.push({ pathname: '/admissions/edit', params: { studentId } })}
        />
      ) : null}
    </Section>
  );
}
