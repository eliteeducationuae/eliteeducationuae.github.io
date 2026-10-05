import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction } from '@/data/hooks';
import { spamSummary } from '@/domain/spam';
import type { SpamReason, SpamStatus } from '@/domain/types';
import { confirm } from '@/lib/confirm';

import { Badge, Banner, Button, ErrorNote, Row, Txt } from './ui';

type Kind = 'enquiry' | 'application';

interface SpamItem {
  spamStatus?: SpamStatus;
  spamReasons?: SpamReason[];
}

const NOUN: Record<Kind, string> = { enquiry: 'enquiry', application: 'application' };

/** A badge and the reasons, for an item kept as possible spam. Nothing for a genuine one. */
export function SpamNote({ item }: { item: SpamItem }) {
  if (item.spamStatus !== 'suspected' && item.spamStatus !== 'spam') return null;
  const why = spamSummary(item.spamReasons);
  return (
    <Row gap={Spacing.two} wrap style={{ alignItems: 'center' }}>
      {item.spamStatus === 'spam' ? <Badge label="Marked as spam" tone="neutral" /> : <Badge label="Possible spam" tone="warning" />}
      {why ? <Txt variant="small">{why}</Txt> : null}
    </Row>
  );
}

/** "Received 3 times" when repeat submissions were merged into this one. */
export function RepeatNote({ repeatCount }: { repeatCount?: number }) {
  if (!repeatCount) return null;
  return <Txt variant="small">Received {repeatCount + 1} times</Txt>;
}

/** Explains why an item is held back, on its detail screen, with the actions to settle it. */
export function SpamBanner({ kind, id, item }: { kind: Kind; id: string; item: SpamItem }) {
  if (item.spamStatus !== 'suspected' && item.spamStatus !== 'spam') return null;
  const why = spamSummary(item.spamReasons);
  const text =
    item.spamStatus === 'spam'
      ? `This ${NOUN[kind]} has been marked as spam. It is kept here but left out of your pipeline and statistics.`
      : `This ${NOUN[kind]} looks automated${why ? `: ${why}` : ''}. It has not been announced to the team.`;
  return (
    <View style={{ gap: Spacing.two }}>
      <Banner tone="warning" icon="alert">
        {text}
      </Banner>
      <SpamActions kind={kind} id={id} status={item.spamStatus} />
    </View>
  );
}

/** "Not spam" and "Mark as spam" buttons. Marking as spam asks first. */
export function SpamActions({ kind, id, status, compact }: { kind: Kind; id: string; status?: SpamStatus; compact?: boolean }) {
  const set = useAction(source.setSpamStatus);
  const possible = status === 'suspected' || status === 'spam';
  const markSpam = () =>
    confirm(
      'Mark as spam',
      `Mark this ${NOUN[kind]} as spam? It will be kept but left out of your pipeline and statistics.`,
      () => set.mutate([kind, id, true]),
      'Mark as spam',
    );
  return (
    <View style={{ gap: Spacing.one }}>
      <Row gap={Spacing.two} wrap>
        {possible ? <Button title="Not spam" icon="check" size="sm" variant="secondary" loading={set.isPending} onPress={() => set.mutate([kind, id, false])} /> : null}
        {status !== 'spam' ? (
          <Button title="Mark as spam" size="sm" variant={compact ? 'ghost' : 'outline'} loading={set.isPending && !possible} onPress={markSpam} />
        ) : null}
      </Row>
      <ErrorNote error={set.error} />
    </View>
  );
}
