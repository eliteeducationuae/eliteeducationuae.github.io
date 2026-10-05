import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import {
  daysLeftLabel,
  keyDateTitle,
  keyDateUrgency,
  urgencyTone,
  type AdmissionsKeyDate,
  type AdmissionsTarget,
} from '@/domain/admissions';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from '../icon';
import { Badge, Row, Txt } from '../ui';
import { dateKeyToDate } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A small calendar leaf: day number in Georgia over the month in tracked capitals. */
export function DateLeaf({ dateKey, muted }: { dateKey: string; muted?: boolean }) {
  const theme = useTheme();
  const d = dateKeyToDate(dateKey);
  return (
    <View
      style={[
        styles.leaf,
        { borderColor: muted ? theme.border : theme.gold, backgroundColor: muted ? theme.surfaceAlt : theme.surface },
      ]}>
      <Txt variant="label" style={{ fontSize: 9.5, lineHeight: 12 }}>
        {MONTHS[d.getMonth()]}
      </Txt>
      <Txt variant="h3" style={{ fontSize: 19, lineHeight: 22 }}>
        {d.getDate()}
      </Txt>
    </View>
  );
}

/**
 * One key date: leaf, title (with the institution when linked), when it falls and how long is left.
 * Managers get a tick to mark it done; tapping the row opens it for editing when `onPress` is given.
 */
export function KeyDateRow({
  date,
  targets,
  now,
  onPress,
  onToggleDone,
  caption,
}: {
  date: AdmissionsKeyDate;
  targets: AdmissionsTarget[];
  now: Date;
  onPress?: () => void;
  onToggleDone?: () => void;
  /** Extra line under the date, e.g. the student's name on a combined list. */
  caption?: string;
}) {
  const theme = useTheme();
  const urgency = keyDateUrgency(date, now);
  const d = dateKeyToDate(date.dueOn);
  const when = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${date.time ? ` at ${date.time}` : ''}`;
  const title = keyDateTitle(date, targets);
  const body = (
    <Row gap={Spacing.three} style={{ alignItems: 'center' }}>
      <DateLeaf dateKey={date.dueOn} muted={date.done} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt
          variant="h3"
          numberOfLines={2}
          style={date.done ? { textDecorationLine: 'line-through', color: theme.textMuted } : undefined}>
          {title}
        </Txt>
        <Txt variant="small">{when}</Txt>
        {caption ? <Txt variant="small">{caption}</Txt> : null}
        <Row gap={Spacing.one} style={{ marginTop: 2 }} wrap>
          {date.done ? (
            <Badge label="Done" tone="success" />
          ) : (
            <Badge label={urgency === 'overdue' ? `Overdue · ${daysLeftLabel(date.dueOn, now)}` : daysLeftLabel(date.dueOn, now)} tone={urgencyTone(urgency)} />
          )}
          {date.lessonId || date.enrolmentId ? <Badge label="Preparation planned" tone="neutral" /> : null}
        </Row>
      </View>
    </Row>
  );
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.surface,
          borderColor: urgency === 'overdue' ? theme.danger : theme.border,
        },
      ]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`${title}, ${when}`}
        style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}>
        {body}
      </Pressable>
      {onToggleDone ? (
        <Pressable
          onPress={onToggleDone}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: date.done }}
          accessibilityLabel={date.done ? `Mark ${date.title} as not done` : `Mark ${date.title} as done`}
          hitSlop={8}
          style={({ pressed }) => [
            styles.tick,
            { borderColor: date.done ? theme.success : theme.gold, backgroundColor: date.done ? theme.successBg : 'transparent' },
            pressed && { opacity: 0.7 },
          ]}>
          {date.done ? <Icon name="check" size={16} color={theme.success} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  leaf: {
    width: 48,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.sm - 2,
    borderWidth: 1,
    alignItems: 'center',
  },
  tick: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
