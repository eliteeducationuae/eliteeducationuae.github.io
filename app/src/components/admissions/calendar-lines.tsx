import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAdmissionsCases, useAdmissionsKeyDates, useLookup } from '@/data/hooks';
import { KEY_DATE_KIND_LABELS, type AdmissionsKeyDate } from '@/domain/admissions';
import { addDays, toDateKey } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from '../icon';
import { Txt } from '../ui';
import { firstName } from './format';

/** Admissions key dates in the calendar's week (only cases the viewer may see: the office and advisers). */
export function useWeekKeyDates(weekStart: Date): AdmissionsKeyDate[] {
  const dates = useAdmissionsKeyDates({ from: toDateKey(weekStart), to: toDateKey(addDays(weekStart, 6)) });
  return dates.data ?? [];
}

export function hasKeyDatesOn(dates: AdmissionsKeyDate[], day: Date): boolean {
  const key = toDateKey(day);
  return dates.some((d) => d.dueOn === key);
}

/**
 * Quiet lines for the admissions key dates on one day, beneath the lessons:
 * "<Kind>: <title> · <student>". Tapping one opens the case's key dates.
 */
export function AdmissionsDayLines({ day, dates }: { day: Date; dates: AdmissionsKeyDate[] }) {
  const theme = useTheme();
  const lookup = useLookup();
  const cases = useAdmissionsCases();
  const key = toDateKey(day);
  const today = dates.filter((d) => d.dueOn === key);
  if (!today.length) return null;
  return (
    <>
      {today.map((d) => {
        const c = cases.data?.find((x) => x.id === d.caseId);
        const who = c ? firstName(lookup.student(c.studentId)?.fullName) : '';
        const label = `${KEY_DATE_KIND_LABELS[d.kind]}: ${d.title}${who ? ` · ${who}` : ''}`;
        return (
          <Pressable
            key={d.id}
            onPress={() => router.push({ pathname: '/admissions/[id]', params: { id: d.caseId, tab: 'dates' } })}
            accessibilityRole="link"
            accessibilityLabel={`Admissions: ${label}`}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }, pressed && { opacity: 0.7 }]}>
            <Icon name="school" size={14} color={theme.accent} />
            <Txt variant="small" style={[{ flex: 1 }, d.done && { textDecorationLine: 'line-through' }]} numberOfLines={2}>
              {d.time ? `${d.time} · ` : ''}
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </>
  );
}
