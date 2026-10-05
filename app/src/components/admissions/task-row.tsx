import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { daysLeftLabel, keyDateUrgency, urgencyTone, type AdmissionsTarget, type AdmissionsTask } from '@/domain/admissions';
import { formatDate } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from '../icon';
import { Badge, Row, Txt } from '../ui';
import { formatDateKey } from './format';

/**
 * One task with a round tick. `onToggle` is passed only when the viewer may complete it
 * (families: family tasks only; advisers and the office: any task).
 */
export function TaskRow({
  task,
  targets,
  now,
  onToggle,
  onPress,
  busy,
}: {
  task: AdmissionsTask;
  targets: AdmissionsTarget[];
  now: Date;
  onToggle?: () => void;
  onPress?: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  const done = !!task.doneAt;
  const target = task.targetId ? targets.find((t) => t.id === task.targetId) : undefined;
  const due = task.dueOn && !done ? keyDateUrgency({ dueOn: task.dueOn, done: false }, now) : null;
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          disabled={busy}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, busy: !!busy }}
          accessibilityLabel={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
          hitSlop={8}
          style={({ pressed }) => [
            styles.tick,
            { borderColor: done ? theme.success : theme.gold, backgroundColor: done ? theme.successBg : 'transparent' },
            (pressed || busy) && { opacity: 0.6 },
          ]}>
          {done ? <Icon name="check" size={16} color={theme.success} /> : null}
        </Pressable>
      ) : (
        <View style={[styles.tick, { borderColor: done ? theme.success : theme.border }]}>
          {done ? <Icon name="check" size={16} color={theme.success} /> : null}
        </View>
      )}
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `Edit task: ${task.title}` : undefined}
        style={({ pressed }) => [{ flex: 1, gap: 2 }, pressed && { opacity: 0.8 }]}>
        <Txt variant="h3" style={done ? { textDecorationLine: 'line-through', color: theme.textMuted } : undefined}>
          {task.title}
        </Txt>
        {task.details && !done ? (
          <Txt variant="muted" numberOfLines={3}>
            {task.details}
          </Txt>
        ) : null}
        {target ? <Txt variant="small">{target.institution}</Txt> : null}
        {done ? (
          <Txt variant="small">
            Completed {task.doneAt ? formatDate(task.doneAt) : ''}
            {task.doneByName ? ` by ${task.doneByName}` : ''}
          </Txt>
        ) : task.dueOn ? (
          <Row gap={Spacing.one} style={{ marginTop: 2 }} wrap>
            <Txt variant="small">Due {formatDateKey(task.dueOn)}</Txt>
            {due ? <Badge label={daysLeftLabel(task.dueOn, now)} tone={urgencyTone(due)} /> : null}
          </Row>
        ) : null}
      </Pressable>
      {onPress ? <Icon name="chevron" size={16} color={theme.textMuted} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
});
