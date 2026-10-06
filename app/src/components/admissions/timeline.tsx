import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { keyDateTitle, type AdmissionsEvent, type AdmissionsKeyDate, type AdmissionsTarget } from '@/domain/admissions';
import { formatDate, formatTime } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Icon, type IconName } from '../icon';
import { Badge, Row, Txt } from '../ui';
import { EVENT_ICONS, formatDateKey } from './format';

interface Entry {
  key: string;
  icon: IconName;
  when: string;
  title: string;
  detail?: string;
  upcoming?: boolean;
  privateNote?: boolean;
}

/**
 * The case's story so far: upcoming key dates first (marked "Upcoming"), then events newest first,
 * joined by a fine champagne-gold rule.
 */
export function CaseTimeline({
  events,
  upcoming,
  targets,
  showPrivate,
}: {
  events: AdmissionsEvent[];
  upcoming: AdmissionsKeyDate[];
  targets: AdmissionsTarget[];
  /** Managers: mark events the family cannot see. */
  showPrivate?: boolean;
}) {
  const theme = useTheme();
  const entries: Entry[] = [
    ...upcoming.map((d) => ({
      key: `d-${d.id}`,
      icon: 'calendar' as IconName,
      when: `${formatDateKey(d.dueOn)}${d.time ? ` at ${d.time}` : ''}`,
      title: keyDateTitle(d, targets),
      upcoming: true,
    })),
    ...events.map((e) => ({
      key: `e-${e.id}`,
      icon: EVENT_ICONS[e.kind] ?? 'sparkle',
      when: `${formatDate(e.at)} · ${formatTime(e.at)}`,
      title: e.title,
      detail: e.detail,
      privateNote: showPrivate && !e.familyVisible,
    })),
  ];
  return (
    <View>
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        return (
          <View key={e.key} style={styles.entry}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  {
                    borderColor: theme.gold,
                    backgroundColor: e.upcoming ? theme.surface : theme.champagne,
                  },
                ]}>
                <Icon name={e.icon} size={14} color={theme.accent} />
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: theme.gold }]} /> : null}
            </View>
            <View style={[styles.body, last && { paddingBottom: 0 }]}>
              <Row gap={Spacing.one} wrap>
                <Txt variant="label">{e.when}</Txt>
                {e.upcoming ? <Badge label="Upcoming" tone="gold" /> : null}
                {e.privateNote ? <Badge label="Not shown to the family" tone="neutral" /> : null}
              </Row>
              <Txt variant="h3">{e.title}</Txt>
              {e.detail ? <Txt variant="muted">{e.detail}</Txt> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  entry: { flexDirection: 'row', gap: Spacing.three },
  rail: { width: 30, alignItems: 'center' },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { width: StyleSheet.hairlineWidth * 2, flex: 1, minHeight: 16, opacity: 0.7 },
  body: { flex: 1, gap: 2, paddingTop: 4, paddingBottom: Spacing.four },
});
