import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { typographic, UPDATE_KIND_LABELS, UPDATE_STATUS_LABELS, type AdvisoryUpdate } from '@/domain/admissions';
import { formatDate } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

import { Badge, Button, Card, Row, Txt } from '../ui';
import { updateStatusTone } from './format';

/** The date that matters for an update: when it was sent, else when it was last moved along. */
export function updateDate(u: AdvisoryUpdate): string {
  return u.publishedAt ?? u.approvedAt ?? u.submittedAt ?? u.createdAt;
}

/** The opening lines of an update, without the salutation ('Dear …,'). */
export function previewText(body: string): string {
  const paragraphs = typographic(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1 && /^Dear\b.*,$/.test(paragraphs[0])) paragraphs.shift();
  return paragraphs.join('\n\n');
}

/**
 * An advisory update as a letter-like card: kind and period in capitals, the title in Georgia,
 * the opening lines, and Read / Download PDF actions.
 */
export function UpdateCard({
  update,
  onRead,
  onDownload,
  showStatus,
  highlight,
  author,
}: {
  update: AdvisoryUpdate;
  /** Who the update is from, as shown to this reader. */
  author?: string;
  onRead: () => void;
  onDownload?: () => void;
  showStatus?: boolean;
  /** A champagne wash for the newest update on the overview. */
  highlight?: boolean;
}) {
  const theme = useTheme();
  const meta = [UPDATE_KIND_LABELS[update.kind], update.period].filter(Boolean).join(' · ');
  return (
    <Card variant={highlight ? 'highlight' : 'default'} onPress={onRead} accessibilityLabel={`Read ${update.title}`} style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.two}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label">{meta}</Txt>
          <Txt variant="h2" style={{ fontSize: 19, lineHeight: 25 }}>
            {update.title}
          </Txt>
        </View>
        {showStatus ? <Badge label={UPDATE_STATUS_LABELS[update.status]} tone={updateStatusTone(update.status)} /> : null}
      </Row>
      <View style={{ width: 28, height: 1.5, backgroundColor: theme.gold }} />
      <Txt variant="muted" numberOfLines={3}>
        {previewText(update.body)}
      </Txt>
      <Txt variant="small">
        {update.status === 'published' ? `Sent ${formatDate(updateDate(update))}` : `Last changed ${formatDate(updateDate(update))}`}
        {author ? ` · ${author}` : ''}
      </Txt>
      <Row gap={Spacing.two} wrap>
        <Button title="Read" size="sm" variant="secondary" icon="doc" onPress={onRead} />
        {onDownload ? <Button title="Download PDF" size="sm" variant="outline" icon="share" onPress={onDownload} /> : null}
      </Row>
    </Card>
  );
}
