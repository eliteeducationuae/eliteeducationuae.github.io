import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { font } from '@/constants/theme';
import type { Lookup } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { formatTime } from '@/domain/dates';
import type { Lesson } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { safeMeetingUrl } from '@/lib/safe-url';

import { Icon, type IconName } from '../icon';
import { useLessonSubject } from '../lessons';
import { useToast } from '../ui';
import { firstName, joinState, lessonMinutes, placeLabel, shortWhen } from './format';

const web = Platform.OS === 'web';
const webStyle = (s: Record<string, unknown>): ViewStyle => (web ? (s as ViewStyle) : {});

/** "Chemistry with Sarah" (or "Layla's lesson with Sarah" when the subject is not known). */
export function useLessonTitle(lesson: Lesson, lookup: Lookup, showChild: boolean): string {
  const subject = useLessonSubject(lesson);
  const tutor = firstName(lookup.tutor(lesson.tutorId)?.fullName) || 'your tutor';
  const child = lookup.studentNames(lesson.studentIds).split(',')[0]?.trim().split(' ')[0];
  const what = subject ?? 'Lesson';
  return `${showChild && child ? `${child} · ` : ''}${what} with ${tutor}`;
}

/** The video-link pill: "Join lesson" once the link is open, "Join opens at 15:20" before then. */
export function JoinPill({ lesson, now, onDark }: { lesson: Lesson; now: Date; onDark?: boolean }) {
  const theme = useTheme();
  const toast = useToast();
  const url = safeMeetingUrl(lesson.meetingUrl);
  const state = joinState(lesson, !!url, now);
  if (state.kind === 'in-person' || state.kind === 'over') return null;
  const label = state.kind === 'open' ? 'Join lesson' : state.kind === 'later' ? `Join opens at ${state.opensAt}` : 'Link to follow';
  const press = () => {
    if (state.kind === 'open' && url) void Linking.openURL(url);
    else if (state.kind === 'later') toast(`The link opens at ${state.opensAt}, ten minutes before the lesson.`);
    else toast('Your tutor will add the video link before the lesson.');
  };
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: theme.gold, opacity: pressed ? 0.85 : 1 },
        !onDark && { borderWidth: 1, borderColor: theme.gold },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <Icon name="videocam" size={18} color={theme.onGold} weight={400} />
      <Text style={[font('sans', 'bold'), { fontSize: 14, color: theme.onGold }]}>{label}</Text>
    </Pressable>
  );
}

/** The noir "Next lesson" card on Home: day, the start time in Georgia, what and where, Join and Move. */
export function NextLessonPanel({ lesson, lookup, now, showChild }: { lesson: Lesson; lookup: Lookup; now: Date; showChild: boolean }) {
  const theme = useTheme();
  const viewing = useViewing();
  const [hover, setHover] = useState(false);
  const title = useLessonTitle(lesson, lookup, showChild);
  const meta = `${formatTime(lesson.start)} to ${formatTime(lesson.end)} · ${placeLabel(lesson)} · ${lessonMinutes(lesson)} minutes`;
  const open = () => router.push({ pathname: '/lesson/[id]', params: { id: lesson.id } });
  return (
    <Pressable
      onPress={open}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={`Next lesson, ${shortWhen(lesson.start, now)} at ${formatTime(lesson.start)}. ${title}. ${meta}`}
      style={[styles.next, { backgroundColor: theme.hero, borderColor: hover ? theme.gold : theme.heroBorder }, webStyle({ cursor: 'pointer' })]}>
      <View style={styles.nextTop}>
        <Text style={[font('sans', 'bold'), styles.nextKicker, { color: theme.gold }]}>Next lesson · {shortWhen(lesson.start, now)}</Text>
        <Icon name="arrow_forward" size={18} color={theme.onHeroMuted} />
      </View>
      <View style={styles.nextMain}>
        <Text style={[font('serif'), styles.nextTime, { color: theme.onHero }]}>{formatTime(lesson.start)}</Text>
        <View style={{ gap: 3, paddingBottom: 3, flexShrink: 1 }}>
          <Text style={[font('sans', 'bold'), { fontSize: 16.5, lineHeight: 21, color: theme.onHero }]}>{title}</Text>
          <Text style={[font('sans'), { fontSize: 14, lineHeight: 19, color: theme.onHeroMuted }]}>{meta}</Text>
        </View>
      </View>
      <View style={styles.nextActions}>
        <JoinPill lesson={lesson} now={now} onDark />
        {viewing ? null : (
          <Pressable
            onPress={() => router.push({ pathname: '/book', params: { lessonId: lesson.id } })}
            accessibilityRole="button"
            accessibilityLabel="Move this lesson"
            style={({ pressed }) => [styles.pill, styles.ghostPill, { borderColor: pressed ? theme.gold : 'rgba(249,248,245,0.3)' }, webStyle({ cursor: 'pointer' })]}>
            <Text style={[font('sans', 'bold'), { fontSize: 14, color: theme.onHero }]}>Move</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

export type QuickTile = { icon: IconName; label: string; onPress: () => void; dot?: boolean; dotLabel?: string };

/** Four shortcut tiles in a row: Book, Progress, Billing (with a dot when money is due) and Message. */
export function QuickTiles({ tiles }: { tiles: QuickTile[] }) {
  return (
    <View style={styles.tiles}>
      {tiles.map((t) => (
        <Tile key={t.label} tile={t} />
      ))}
    </View>
  );
}

function Tile({ tile }: { tile: QuickTile }) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={tile.onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityLabel={tile.dot ? `${tile.label}, ${tile.dotLabel ?? 'something is waiting'}` : tile.label}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: theme.surface, borderColor: hover || pressed ? theme.gold : theme.hairline },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <Icon name={tile.icon} size={25} color={theme.accent} />
      <Text style={[font('sans', 'bold'), { fontSize: 13, color: theme.text, textAlign: 'center' }]} numberOfLines={1}>
        {tile.label}
      </Text>
      {tile.dot ? <View style={[styles.dot, { backgroundColor: theme.danger }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  next: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20, gap: 14 },
  nextTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextKicker: { fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase' },
  nextMain: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' },
  nextTime: { fontSize: 42, lineHeight: 44, fontVariant: ['tabular-nums'] },
  nextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 44, height: 44, paddingHorizontal: 18, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ghostPill: { borderWidth: 1, paddingHorizontal: 16 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minWidth: 0, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 4, borderRadius: 18, borderWidth: 1, minHeight: 44 },
  dot: { position: 'absolute', top: 9, right: 12, width: 8, height: 8, borderRadius: 4 },
});
