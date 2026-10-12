import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useAdmissionsCases, useAdmissionsKeyDates, useAdmissionsTasks, useLookup } from '@/data/hooks';
import { openTasks, overdueKeyDates, upcomingKeyDates } from '@/domain/admissions';

import { adviserName, OFFICE_ADVISER } from '../admissions/format';
import { Group, GroupRow, useWide } from '../ui';
import { dayMonth, firstName } from './format';

/**
 * Home: each active admissions case as a short group, with its next key date and anything waiting on the family.
 * Nothing renders for families without a case.
 */
export function AdmissionsHomeGroup() {
  const lookup = useLookup();
  const cases = useAdmissionsCases();
  const dates = useAdmissionsKeyDates();
  const tasks = useAdmissionsTasks();
  const [now] = useState(() => new Date());
  const wide = useWide();
  const list = (cases.data ?? []).filter((c) => c.status === 'active' || c.status === 'on-hold');
  if (!list.length) return null;
  const several = list.length > 1;
  const openCase = (id: string) => router.push({ pathname: '/admissions/[id]', params: { id } });

  return (
    <View style={{ gap: wide ? 26 : 20 }}>
      {list.map((c) => {
        const child = firstName(lookup.student(c.studentId)?.fullName) || 'Your child';
        const caseDates = (dates.data ?? []).filter((d) => d.caseId === c.id);
        const next = [...overdueKeyDates(caseDates, now), ...upcomingKeyDates(caseDates, now, 3650)].slice(0, several ? 1 : 2);
        const forYou = openTasks((tasks.data ?? []).filter((t) => t.caseId === c.id), 'family').slice(0, 2);
        const adviser = adviserName(c, lookup);
        return (
          <Group key={c.id} title={`${child}’s ${c.kind === 'uk-university' || c.kind === 'us-university' ? 'university applications' : 'school search'}`} link={{ label: 'Open', onPress: () => openCase(c.id) }}>
            <GroupRow
              icon="travel_explore"
              title={c.title}
              note={[c.entryYear ? `Entry ${c.entryYear}` : '', adviser === OFFICE_ADVISER ? 'with the Elite Education office' : `with ${adviser}`].filter(Boolean).join(' · ')}
              onPress={() => openCase(c.id)}
            />
            {next.map((d) => (
              <GroupRow key={d.id} icon="event" title={d.title} note={dayMonth(d.dueOn)} onPress={() => openCase(c.id)} />
            ))}
            {forYou.map((t) => (
              <GroupRow
                key={t.id}
                icon="assignment"
                tone="warn"
                title={t.title}
                note={t.dueOn ? `For you · by ${dayMonth(t.dueOn)}` : 'For you'}
                onPress={() => openCase(c.id)}
              />
            ))}
          </Group>
        );
      })}
    </View>
  );
}
