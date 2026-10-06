import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAdmissionsCases, useAdmissionsKeyDates, useLookup } from '@/data/hooks';
import { keyDateHeading, withKeyDatesInTimeOrder, type AdmissionsKeyDate } from '@/domain/admissions';
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
 * One day's calendar entries with its admissions key dates woven in: a timed key date sits where it falls among the
 * lessons, untimed ones close the day. Each key date is a quiet line, "<time> · <Kind>: <title> · <student>";
 * tapping one opens the case's key dates.
 */
export function DayWithKeyDates<E extends { start: string }>({
  day,
  dates,
  entries,
  renderEntry,
}: {
  day: Date;
  dates: AdmissionsKeyDate[];
  entries: E[];
  renderEntry: (e: E) => ReactNode;
}) {
  const key = toDateKey(day);
  const today = dates.filter((d) => d.dueOn === key);
  return (
    <>
      {withKeyDatesInTimeOrder(entries, today).map((x) =>
        x.kind === 'entry' ? renderEntry(x.entry) : <KeyDateLine key={`adm-${x.date.id}`} d={x.date} />,
      )}
    </>
  );
}

function KeyDateLine({ d }: { d: AdmissionsKeyDate }) {
  const theme = useTheme();
  const lookup = useLookup();
  const cases = useAdmissionsCases();
  const c = cases.data?.find((x) => x.id === d.caseId);
  const who = c ? firstName(lookup.student(c.studentId)?.fullName) : '';
  const label = `${keyDateHeading(d)}${who ? ` · ${who}` : ''}`;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/admissions/[id]', params: { id: d.caseId, tab: 'dates' } })}
      accessibilityRole="link"
      accessibilityLabel={`Admissions: ${d.time ? `${d.time}, ` : ''}${label}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }, pressed && { opacity: 0.7 }]}>
      <Icon name="school" size={14} color={theme.accent} />
      <Txt variant="small" style={[{ flex: 1 }, d.done && { textDecorationLine: 'line-through' }]} numberOfLines={2}>
        {d.time ? `${d.time} · ` : ''}
        {label}
      </Txt>
    </Pressable>
  );
}
