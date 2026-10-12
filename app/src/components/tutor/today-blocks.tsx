/** The blocks only the tutor's Today screen uses: the "to record" prompt, the next-lesson card and quick tiles. */
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Button, useToast, useWide } from '@/components/ui';
import { font, Radius, tabular } from '@/constants/theme';
import { useEnrolments, useLookup } from '@/data/hooks';
import { formatTime, minutesBetween, relativeDay } from '@/domain/dates';
import { lessonSubject } from '@/domain/enrolments';
import type { Lesson } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { safeMeetingUrl } from '@/lib/safe-url';

import { lessonWhere, studentFirstNames } from './common';

const webStyle = (s: Record<string, unknown>): ViewStyle => (Platform.OS === 'web' ? (s as ViewStyle) : {});

/** A white decision card: a kicker with a gold dot, a Georgia title, a line of context and the actions. */
export function DecisionCard({ kicker, from, title, body, children }: { kicker: string; from?: string; title: string; body: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.decision, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      <View style={styles.kickerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <View style={[styles.dot, { backgroundColor: theme.gold }]} />
          <Text style={[font('sans', 'bold'), styles.kicker, { color: theme.accent }]}>{kicker.toUpperCase()}</Text>
        </View>
        {from ? <Text style={[font('sans'), { fontSize: 12.5, color: theme.textMuted }]}>{from}</Text> : null}
      </View>
      <Text style={[font('serif'), styles.decisionTitle, { color: theme.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[font('sans'), { fontSize: 14.5, lineHeight: 22, color: theme.textBody }]}>{body}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>{children}</View>
    </View>
  );
}

/** The next lesson on noir: the start time large, who and where, then Join and the lesson plan. */
export function NextLessonNoir({ lesson: l, now, viewing }: { lesson: Lesson; now: Date; viewing: boolean }) {
  const theme = useTheme();
  const toast = useToast();
  const wide = useWide();
  const lookup = useLookup();
  const enrolments = useEnrolments();
  const subject = lessonSubject(l, enrolments.data ?? []);
  const service = lookup.service(l.serviceId)?.name;
  const minutes = minutesBetween(new Date(l.start), new Date(l.end));
  const url = l.location === 'online' ? safeMeetingUrl(l.meetingUrl) : null;
  const opensAt = new Date(new Date(l.start).getTime() - 10 * 60_000);
  const joinable = !!url && now >= opensAt;
  const title = [studentFirstNames(l, lookup), subject].filter(Boolean).join(' · ');
  const meta = `${formatTime(l.start)} to ${formatTime(l.end)} · ${lessonWhere(l)} · ${minutes} minutes`;
  const open = () => router.push({ pathname: '/lesson/[id]', params: { id: l.id } });
  return (
    <View style={[styles.next, { backgroundColor: theme.hero, borderColor: theme.heroBorder }]}>
      <View style={styles.kickerRow}>
        <Text style={[font('sans', 'bold'), styles.kicker, { color: theme.gold }]}>{`NEXT LESSON · ${relativeDay(l.start, now).toUpperCase()}`}</Text>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`Open the next lesson, ${relativeDay(l.start, now)} at ${formatTime(l.start)}: ${title}`}
          hitSlop={8}
          style={[{ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center', marginVertical: -12 }, webStyle({ cursor: 'pointer' })]}>
          <Icon name="arrow_forward" size={20} color={theme.onHeroMuted} />
        </Pressable>
      </View>
      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start', gap: wide ? 18 : 6 }}>
        <Text style={[font('serif'), tabular, { fontSize: wide ? 44 : 42, lineHeight: wide ? 50 : 48, color: theme.onHero }]}>{formatTime(l.start)}</Text>
        <View style={{ gap: 3, flexShrink: 1 }}>
          <Text style={[font('sans', 'bold'), { fontSize: 15.5, color: theme.onHero }]}>{[title, service].filter(Boolean).join(' · ')}</Text>
          <Text style={[font('sans'), { fontSize: 13.5, color: theme.onHeroMuted }]}>{meta}</Text>
        </View>
      </View>
      {!viewing ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          {url ? (
            <NoirPill
              gold
              icon="videocam"
              label={joinable ? 'Join the lesson' : `Join opens at ${formatTime(opensAt)}`}
              onPress={() => (joinable ? Linking.openURL(url) : toast(`The link opens at ${formatTime(opensAt)}, ten minutes before the lesson.`))}
            />
          ) : null}
          <NoirPill icon="edit_note" label="Lesson plan" onPress={() => router.push({ pathname: '/plan/[id]', params: { id: l.id } })} />
        </View>
      ) : null}
    </View>
  );
}

function NoirPill({ label, icon, onPress, gold }: { label: string; icon: IconName; onPress: () => void; gold?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        gold ? { backgroundColor: theme.gold, borderColor: theme.gold } : { backgroundColor: 'transparent', borderColor: theme.onHeroMuted },
        pressed && { opacity: 0.8 },
        webStyle({ cursor: 'pointer' }),
      ]}>
      <Icon name={icon} size={18} color={gold ? theme.onGold : theme.onHero} weight={400} />
      <Text style={[font('sans', 'bold'), { fontSize: 14, color: gold ? theme.onGold : theme.onHero }]}>{label}</Text>
    </Pressable>
  );
}

export type QuickTile = { icon: IconName; label: string; onPress: () => void; dot?: boolean; dotLabel?: string };

/** Four shortcut tiles (four across), with a red dot where something is waiting. */
export function QuickTiles({ tiles }: { tiles: QuickTile[] }) {
  const theme = useTheme();
  return (
    <View style={styles.tiles}>
      {tiles.map((t) => (
        <Pressable
          key={t.label}
          onPress={t.onPress}
          accessibilityRole="button"
          accessibilityLabel={t.dot ? `${t.label}, ${t.dotLabel ?? 'something waiting'}` : t.label}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.tile,
            { backgroundColor: hovered || pressed ? theme.rowHover : theme.surface, borderColor: theme.hairline },
            webStyle({ cursor: 'pointer' }),
          ]}>
          <Icon name={t.icon} size={24} color={theme.accent} />
          <Text style={[font('sans', 'bold'), { fontSize: 12.5, color: theme.text, textAlign: 'center' }]}>
            {t.label}
          </Text>
          {t.dot ? <View style={[styles.tileDot, { backgroundColor: theme.danger }]} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** "Record now" for the decision card (hidden while viewing as the tutor). */
export function RecordNowButton({ lessonId }: { lessonId: string }) {
  return <Button title="Record now" icon="edit_note" onPress={() => router.push({ pathname: '/complete/[id]', params: { id: lessonId } })} />;
}

const styles = StyleSheet.create({
  decision: { borderWidth: 1, borderRadius: Radius.card, padding: 20, gap: 10 },
  kickerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  kicker: { fontSize: 11.5, letterSpacing: 2 },
  decisionTitle: { fontSize: 21, lineHeight: 27 },
  next: { borderRadius: 26, padding: 22, gap: 12, borderWidth: 1 },
  pill: { minHeight: 44, borderRadius: 999, borderWidth: 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minWidth: 0, minHeight: 84, borderWidth: 1, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 2, paddingVertical: 14 },
  tileDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
});
