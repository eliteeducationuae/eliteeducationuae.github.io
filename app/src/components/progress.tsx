import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MasteryColors, Spacing } from '@/constants/theme';
import { topicName } from '@/data/curriculum';
import { focusTopics, RATING_LABELS, summariseSyllabus, type Syllabus, type TopicMastery } from '@/domain/progress';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Badge, Card, ProgressBar, Row, Txt } from './ui';

function luminance(color: string): number {
  const v = color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whichever of a light and a dark text colour reads better on `bg` (both given as six-digit colours). */
export function readableOn(bg: string, light: string, dark: string): string {
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  return contrast(bg, light) >= contrast(bg, dark) ? light : dark;
}

export function masteryColor(rating: number | undefined, fallback: string): string {
  return rating ? MasteryColors[Math.round(rating) - 1] : fallback;
}

/** Headline numbers + "work on next" for a student. */
export function ProgressSummary({ syllabus, mastery }: { syllabus: Syllabus; mastery: Map<string, TopicMastery> }) {
  const theme = useTheme();
  const summary = summariseSyllabus(syllabus, mastery);
  const focus = focusTopics(mastery);
  return (
    <Card style={{ gap: Spacing.three }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h3">{syllabus.name}</Txt>
        <Badge label={`${summary.covered}/${summary.total} topics`} tone="info" />
      </Row>
      <View style={{ gap: Spacing.one }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">Syllabus covered</Txt>
          <Txt variant="h3">{summary.coveragePercent}%</Txt>
        </Row>
        <ProgressBar value={summary.coveragePercent} color={theme.accent} />
      </View>
      <View style={{ gap: Spacing.one }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">Average mastery of covered topics</Txt>
          <Txt variant="h3">{summary.masteryPercent}%</Txt>
        </Row>
        <ProgressBar value={summary.masteryPercent} color={masteryColor(1 + (summary.masteryPercent / 100) * 4, theme.border)} />
      </View>
      {focus.length > 0 ? (
        <View style={{ gap: Spacing.one }}>
          <Txt variant="label">Work on next</Txt>
          {focus.map((t) => (
            <Row key={t.topicId} gap={Spacing.two}>
              <View style={[styles.swatch, { backgroundColor: masteryColor(t.rating, theme.border) }]} />
              <Txt style={{ flex: 1 }} numberOfLines={1}>
                {topicName(t.topicId)}
              </Txt>
              <Txt variant="small">{RATING_LABELS[t.rating]}</Txt>
            </Row>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Units × topics grid coloured by latest rating. Tap a cell for detail. */
export function MasteryHeatmap({ syllabus, mastery }: { syllabus: Syllabus; mastery: Map<string, TopicMastery> }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const summary = summariseSyllabus(syllabus, mastery);
  const sel = selected ? mastery.get(selected) : undefined;

  return (
    <Card style={{ gap: Spacing.three }}>
      {summary.units.map(({ unit, covered, total, average }) => (
        <View key={unit.id} style={{ gap: Spacing.one }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="h3" style={{ fontSize: 14 }}>
              {unit.name}
            </Txt>
            <Txt variant="small">
              {covered}/{total}
              {covered ? ` · ${RATING_LABELS[Math.round(average)]}` : ''}
            </Txt>
          </Row>
          <View style={styles.grid}>
            {unit.topics.map((t) => {
              const m = mastery.get(t.id);
              const isSel = selected === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setSelected(isSel ? null : t.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.name}: ${m ? RATING_LABELS[m.rating] : 'not yet covered'}`}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: masteryColor(m?.rating, theme.surfaceAlt),
                      borderColor: isSel ? theme.text : 'transparent',
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>
      ))}
      {selected ? (
        <View style={[styles.detail, { backgroundColor: theme.surfaceAlt }]}>
          <Txt variant="h3">{topicName(selected)}</Txt>
          {sel ? (
            <Row gap={Spacing.two}>
              <Badge label={RATING_LABELS[sel.rating]} tone={sel.rating >= 4 ? 'success' : sel.rating === 3 ? 'warning' : 'danger'} />
              {sel.trend !== 0 ? (
                <Row gap={2}>
                  <Icon name="trend" size={14} color={sel.trend > 0 ? theme.success : theme.danger} />
                  <Txt variant="small" color={sel.trend > 0 ? 'success' : 'danger'}>
                    {sel.trend > 0 ? 'Improving' : 'Slipping'}
                  </Txt>
                </Row>
              ) : null}
              <Txt variant="small">
                Rated {sel.count} time{sel.count === 1 ? '' : 's'}
              </Txt>
            </Row>
          ) : (
            <Txt variant="muted">Not covered yet.</Txt>
          )}
        </View>
      ) : null}
      <MasteryLegend />
    </Card>
  );
}

export function MasteryLegend() {
  const theme = useTheme();
  return (
    <Row gap={Spacing.two} wrap>
      <Row gap={4}>
        <View style={[styles.swatch, { backgroundColor: theme.surfaceAlt }]} />
        <Txt variant="small">Not covered</Txt>
      </Row>
      {[1, 2, 3, 4, 5].map((r) => (
        <Row key={r} gap={4}>
          <View style={[styles.swatch, { backgroundColor: MasteryColors[r - 1] }]} />
          <Txt variant="small">{RATING_LABELS[r]}</Txt>
        </Row>
      ))}
    </Row>
  );
}

/** 1–5 rating picker. */
export function RatingPicker({ value, onChange, label }: { value?: number; onChange: (v: 1 | 2 | 3 | 4 | 5) => void; label: string }) {
  const theme = useTheme();
  return (
    <Row gap={6}>
      {([1, 2, 3, 4, 5] as const).map((r) => {
        const active = value === r;
        return (
          <Pressable
            key={r}
            onPress={() => onChange(r)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${RATING_LABELS[r]}`}
            accessibilityState={{ selected: active }}
            style={[
              styles.rating,
              { borderColor: active ? MasteryColors[r - 1] : theme.border, backgroundColor: active ? MasteryColors[r - 1] : theme.surface },
            ]}>
            <Txt variant="h3" style={{ color: active ? readableOn(MasteryColors[r - 1], theme.onHero, theme.hero) : theme.textMuted }}>
              {r}
            </Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { width: 26, height: 26, borderRadius: 5, borderWidth: 2 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  detail: { padding: Spacing.three, borderRadius: 10, gap: Spacing.one },
  rating: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
