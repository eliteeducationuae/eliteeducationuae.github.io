import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, elevation, font } from '@/constants/theme';
import type { Lookup } from '@/data/hooks';
import { formatDay, formatTime, relativeDay } from '@/domain/dates';
import type { Lesson } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from './icon';
import { Row, Txt } from './ui';

/**
 * The noir panel at the top of every dashboard: date, greeting and a one-line summary.
 * Gold appears only as the short rule (never as a fill), as the brand guide asks.
 */
export function GreetingCard({ title, subtitle, date, right }: { title: string; subtitle?: string; date?: Date; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: theme.hero, borderColor: theme.heroBorder },
        elevation(theme, 1),
      ]}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
        <View style={{ flex: 1, gap: Spacing.two }}>
          {date ? (
            <Text style={[styles.dateLabel, font('sans', 'bold'), { color: theme.onHero }]}>{formatDay(date)}</Text>
          ) : null}
          <Text style={[styles.heroTitle, font('serif', 'bold'), { color: theme.onHero }]} accessibilityRole="header">
            {title}
          </Text>
          <View style={[styles.rule, { backgroundColor: theme.gold }]} />
          {subtitle ? <Text style={[styles.heroSubtitle, font('sans'), { color: theme.onHero }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </Row>
    </View>
  );
}

/** The next lesson, lifted out of the list so it is the first thing anyone sees. */
export function NextLessonCard({
  lesson,
  lookup,
  perspective,
  now,
}: {
  lesson: Lesson;
  lookup: Lookup;
  perspective: 'admin' | 'tutor' | 'family';
  /** Reference time for "Today" and "Tomorrow"; pass the screen's own clock. */
  now?: Date;
}) {
  const theme = useTheme();
  const tutor = lookup.tutor(lesson.tutorId);
  const service = lookup.service(lesson.serviceId);
  const students = lookup.studentNames(lesson.studentIds);
  const when = `${relativeDay(lesson.start, now)}, ${formatTime(lesson.start)} to ${formatTime(lesson.end)}`;
  const who =
    perspective === 'tutor'
      ? `${students}${service ? ` · ${service.name}` : ''}`
      : perspective === 'family'
        ? `${students} with ${tutor?.fullName ?? 'your tutor'}${service ? ` · ${service.name}` : ''}`
        : `${students} with ${tutor?.fullName ?? 'a tutor'}${service ? ` · ${service.name}` : ''}`;
  const online = lesson.location === 'online';
  const where = online ? (lesson.meetingUrl ? 'Online · video link ready' : 'Online · link to follow') : lesson.address || 'In person';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Next lesson: ${when}. ${who}.`}
      style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
      <View
        style={[
          styles.next,
          { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.gold },
          elevation(theme, 1),
        ]}>
        <Txt variant="label" color="accent">
          Next lesson
        </Txt>
        <Text style={[styles.nextWhen, font('serif'), { color: theme.text }]}>{when}</Text>
        <Txt variant="muted" numberOfLines={2}>
          {who}
        </Txt>
        <Row gap={Spacing.one} style={{ marginTop: Spacing.one }}>
          <Icon name={online ? 'video' : 'pin'} size={16} color={theme.accent} />
          <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
            {where}
          </Txt>
          <Icon name="chevron" size={16} color={theme.textMuted} />
        </Row>
      </View>
    </Pressable>
  );
}

export type QuickAction = { icon: IconName; label: string; onPress: () => void; badge?: number };

/** A wrapping grid of shortcuts: two across on a phone, up to four on a wide screen. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const gap = Spacing.three - 4;
  const cols = Math.max(1, Math.min(actions.length, width >= 600 ? 4 : 2));
  const tileWidth = width ? Math.floor((width - gap * (cols - 1)) / cols) : undefined;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.grid, { gap }]}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={a.onPress}
          accessibilityRole="button"
          accessibilityLabel={a.badge ? `${a.label}, ${a.badge} waiting` : a.label}
          style={({ pressed }) => [{ width: tileWidth ?? '47%' }, pressed && { opacity: 0.8 }]}>
          <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }, elevation(theme, 1)]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.champagne }]}>
              <Icon name={a.icon} size={20} color={theme.accent} />
            </View>
            <Text style={[styles.tileLabel, font('sans', 'bold'), { color: theme.text }]} numberOfLines={2}>
              {a.label}
            </Text>
            {a.badge ? (
              <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                <Text style={[styles.badgeText, font('sans', 'bold'), { color: theme.onPrimary }]}>{a.badge}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.four, paddingVertical: Spacing.four + 4 },
  dateLabel: { fontSize: 12, lineHeight: 16, letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.75 },
  heroTitle: { fontSize: 28, lineHeight: 36 },
  rule: { width: 32, height: 1.5, marginVertical: 2 },
  heroSubtitle: { fontSize: 16, lineHeight: 23, opacity: 0.85 },
  next: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, padding: Spacing.three, gap: Spacing.one },
  nextWhen: { fontSize: 20, lineHeight: 27 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two + 2,
    minHeight: 96,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 15, lineHeight: 20 },
  badge: { position: 'absolute', top: Spacing.three, right: Spacing.three, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12 },
});
