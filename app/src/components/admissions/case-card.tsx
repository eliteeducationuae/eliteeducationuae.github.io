import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
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
  urgencyTone,
  type AdmissionsCase,
  type AdmissionsKeyDate,
  type AdmissionsTarget,
  type AdmissionsTask,
} from '@/domain/admissions';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from '../icon';
import { Badge, Card, Row, Txt } from '../ui';
import { adviserLine, caseStatusTone } from './format';

/** One admissions case in a list: who, what, how far along, and what comes next. */
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
  const overdue = overdueKeyDates(dates, now)[0];
  const next = overdue ?? upcomingKeyDates(dates, now, 3650)[0];
  const familyTasks = openTasks(tasks, 'family').length;
  return (
    <Card onPress={onPress} accessibilityLabel={`${studentName}: ${c.title}`} style={{ gap: Spacing.two + 2 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.two}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label">
            {studentName} · {CASE_KIND_LABELS[c.kind]}
          </Txt>
          <Txt variant="h2" style={{ fontSize: 20, lineHeight: 26 }}>
            {c.title}
          </Txt>
        </View>
        <Badge label={CASE_STATUS_LABELS[c.status]} tone={caseStatusTone(c.status)} />
      </Row>
      <View style={[styles.rule, { backgroundColor: theme.gold }]} />
      <Row gap={Spacing.two}>
        <Icon name="person" size={15} color={theme.textMuted} />
        <Txt variant="muted" style={{ flex: 1 }}>
          {adviserLine(adviser)}
        </Txt>
      </Row>
      <Row gap={Spacing.two}>
        <Icon name="school" size={15} color={theme.textMuted} />
        <Txt variant="muted" style={{ flex: 1 }}>
          {targetSummaryLine(targets, c.kind)}
        </Txt>
      </Row>
      {next ? (
        <Row gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
          <Icon name="calendar" size={15} color={theme.textMuted} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="muted" numberOfLines={2}>
              {keyDateTitle(next, targets)}
            </Txt>
            <View style={{ flexDirection: 'row' }}>
              <Badge label={daysLeftLabel(next.dueOn, now)} tone={urgencyTone(keyDateUrgency(next, now))} />
            </View>
          </View>
        </Row>
      ) : null}
      {familyTasks ? (
        <Row gap={Spacing.two}>
          <Icon name="check" size={15} color={theme.accent} />
          <Txt variant="muted" color="accent" style={{ flex: 1 }}>
            {familyTasks === 1 ? '1 task for the family' : `${familyTasks} tasks for the family`}
          </Txt>
        </Row>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  rule: { width: 28, height: 1.5 },
});
