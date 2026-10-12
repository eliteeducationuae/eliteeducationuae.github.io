import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font, Radius, type Palette } from '@/constants/theme';
import {
  CASE_KIND_LABELS,
  CASE_STATUS_LABELS,
  daysLeftLabel,
  keyDateTitle,
  keyDateUrgency,
  openTasks,
  overdueKeyDates,
  targetSummaryLine,
  upcomingKeyDates,
  type AdmissionsCase,
  type AdmissionsCaseStatus,
  type AdmissionsKeyDate,
  type AdmissionsTarget,
  type AdmissionsTask,
} from '@/domain/admissions';
import { useTheme } from '@/hooks/use-theme';

import { DateChip, Txt } from '../ui';
import { adviserLine, dateKeyToDate } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The colour of a case's status word (palette key, so dark mode follows). */
export function caseStatusColor(status: AdmissionsCaseStatus, theme: Palette): string {
  return status === 'active' ? theme.success : status === 'on-hold' ? theme.warning : theme.textMuted;
}

/**
 * One admissions case in a list: the kind of support and status, the student, the title and adviser, a one-line
 * summary of the shortlist and tasks, and the next key date on a date chip.
 */
export function CaseCard({
  c,
  studentName,
  adviser,
  targets,
  dates,
  tasks,
  now,
  onPress,
}: {
  c: AdmissionsCase;
  studentName: string;
  adviser: string;
  targets: AdmissionsTarget[];
  dates: AdmissionsKeyDate[];
  tasks: AdmissionsTask[];
  now: Date;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const overdue = overdueKeyDates(dates, now)[0];
  const next = overdue ?? upcomingKeyDates(dates, now, 3650)[0];
  const open = openTasks(tasks).length;
  const familyTasks = openTasks(tasks, 'family').length;
  const summary = [
    targetSummaryLine(targets, c.kind),
    open ? `${open} task${open === 1 ? '' : 's'} open` : '',
    familyTasks ? `${familyTasks} for the family` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const nextDay = next ? dateKeyToDate(next.dueOn) : null;
  const urgent = next ? keyDateUrgency(next, now) : null;
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={`${studentName}: ${c.title}, ${CASE_STATUS_LABELS[c.status]}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: hover ? theme.gold : theme.hairline },
        pressed && { opacity: 0.85 },
      ]}>
      <View style={styles.top}>
        <Txt variant="figureLabel" style={{ flex: 1 }} numberOfLines={1}>
          {CASE_KIND_LABELS[c.kind]}
          {c.entryYear ? ` · ${c.entryYear}` : ''}
        </Txt>
        <Text style={[font('sans', 'bold'), styles.status, { color: caseStatusColor(c.status, theme) }]}>{CASE_STATUS_LABELS[c.status]}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Txt variant="groupTitle" style={{ fontSize: 23, lineHeight: 29 }}>
          {studentName}
        </Txt>
        <Txt variant="note">
          {c.title} · {adviserLine(adviser)}
        </Txt>
      </View>
      <View style={[styles.rule, { backgroundColor: theme.gold }]} />
      <Txt variant="note">{summary}</Txt>
      {next && nextDay ? (
        <View style={[styles.next, { borderTopColor: theme.rowDivider }]}>
          <DateChip top={MONTHS[nextDay.getMonth()]} num={String(nextDay.getDate())} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt style={{ fontSize: 14.5, lineHeight: 20 }} numberOfLines={2}>
              {keyDateTitle(next, targets)}
            </Txt>
            <Txt variant="small" color={urgent === 'overdue' ? 'danger' : urgent === 'today' || urgent === 'this-week' ? 'warning' : 'textMuted'} style={{ fontWeight: '700' }}>
              {daysLeftLabel(next.dueOn, now)}
            </Txt>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.card, padding: 20, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  rule: { width: 28, height: 2 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, paddingTop: 14 },
});
