import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAdmissionsCases, useAdmissionsKeyDates, useAdmissionsTasks, useAdvisoryUpdates, useLookup } from '@/data/hooks';
import {
  daysLeftLabel,
  keyDateUrgency,
  openTasks,
  overdueKeyDates,
  upcomingKeyDates,
  urgencyTone,
} from '@/domain/admissions';
import { addDays } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from '../icon';
import { Badge, Card, Row, Txt } from '../ui';
import { firstName } from './format';

const FRESH_DAYS = 14;

/**
 * The parent home's admissions panel: per child, the next two key dates, tasks waiting on the family,
 * and a note when a new update has been sent. Renders nothing when the family has no cases.
 */
export function AdmissionsSummaryCard() {
  const theme = useTheme();
  const lookup = useLookup();
  const cases = useAdmissionsCases();
  const dates = useAdmissionsKeyDates();
  const tasks = useAdmissionsTasks();
  const updates = useAdvisoryUpdates();
  const [now] = useState(() => new Date());
  const list = (cases.data ?? []).filter((c) => c.status === 'active' || c.status === 'on-hold');
  if (!list.length) return null;
  const freshSince = addDays(now, -FRESH_DAYS).toISOString();
  const open = () =>
    list.length === 1 ? router.push({ pathname: '/admissions/[id]', params: { id: list[0].id } }) : router.push('/admissions');

  return (
    <Card onPress={open} accessibilityLabel="Admissions" style={{ gap: Spacing.three }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ gap: 6 }}>
          <Txt variant="h2">Admissions</Txt>
          <View style={[styles.rule, { backgroundColor: theme.gold }]} />
        </View>
        <Icon name="school" size={22} color={theme.accent} />
      </Row>
      {list.map((c, i) => {
        const caseDates = (dates.data ?? []).filter((d) => d.caseId === c.id);
        const next = [...overdueKeyDates(caseDates, now), ...upcomingKeyDates(caseDates, now, 3650)].slice(0, 2);
        const familyTasks = openTasks((tasks.data ?? []).filter((t) => t.caseId === c.id), 'family').length;
        const fresh = (updates.data ?? []).some((u) => u.caseId === c.id && u.status === 'published' && (u.publishedAt ?? '') >= freshSince);
        return (
          <View key={c.id} style={[{ gap: Spacing.one + 2 }, i > 0 && [styles.divider, { borderTopColor: theme.border }]]}>
            <Txt variant="label">
              {firstName(lookup.student(c.studentId)?.fullName) || 'Your child'} · {c.title}
            </Txt>
            {next.map((d) => (
              <Row key={d.id} gap={Spacing.two} style={{ justifyContent: 'space-between' }}>
                <Txt variant="muted" numberOfLines={1} style={{ flex: 1 }}>
                  {d.title}
                </Txt>
                <Badge label={daysLeftLabel(d.dueOn, now)} tone={urgencyTone(keyDateUrgency(d, now))} />
              </Row>
            ))}
            {familyTasks ? (
              <Row gap={Spacing.two}>
                <Icon name="check" size={14} color={theme.accent} />
                <Txt variant="small" color="accent">
                  {familyTasks === 1 ? '1 task for you' : `${familyTasks} tasks for you`}
                </Txt>
              </Row>
            ) : null}
            {fresh ? (
              <Row gap={Spacing.two}>
                <Icon name="mail" size={14} color={theme.accent} />
                <Txt variant="small" color="accent">
                  A new update is ready
                </Txt>
              </Row>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  rule: { width: 28, height: 1.5 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
});
