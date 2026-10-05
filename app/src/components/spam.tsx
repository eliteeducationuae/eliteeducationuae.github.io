import { Alert, Platform, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction } from '@/data/hooks';
import { isRateLimitError, spamReasonPhrase, spamSummary } from '@/domain/spam';
import type { SpamReason, SpamStatus } from '@/domain/types';
import { confirm } from '@/lib/confirm';

import { Badge, Banner, Button, ErrorNote, Row, Txt } from './ui';

type Kind = 'enquiry' | 'application';

interface SpamItem {
  spamStatus?: SpamStatus;
  spamReasons?: SpamReason[];
}

const NOUN: Record<Kind, string> = { enquiry: 'enquiry', application: 'application' };
const PERSON: Record<Kind, string> = { enquiry: 'family', application: 'applicant' };

/** Asks a question with two answers that both go ahead; on the web, Cancel means the second answer. */
function askTwoWays(title: string, message: string, onYes: () => void, yesLabel: string, onNo: () => void, noLabel: string) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}\n\nChoose OK to send it, or Cancel to move it without an email.`)) onYes();
    else onNo();
    return;
  }
  Alert.alert(title, message, [
    { text: noLabel, onPress: onNo },
    { text: yesLabel, onPress: onYes },
  ]);
}

/**
 * A form's error. The polite "please wait" limit is not a fault, so it is shown as a calm notice with its
 * wording unchanged; anything else is shown as an error.
 */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  if (isRateLimitError(error)) {
    return (
      <Banner tone="info" icon="clock">
        {error instanceof Error ? error.message : String(error)}
      </Banner>
    );
  }
  return <ErrorNote error={error} />;
}

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
  const why = spamReasonPhrase(item.spamReasons);
  const text =
    item.spamStatus === 'spam'
      ? `This ${NOUN[kind]} has been marked as spam. It is kept here but left out of your pipeline and statistics.`
      : `This ${NOUN[kind]} may have been sent automatically${why ? ` (${why})` : ''}. The team has not been alerted and no acknowledgement has been sent.`;
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
  // The thank-you email was held back when this was flagged, so offer to send it now.
  const notSpam = () =>
    askTwoWays(
      'Send the usual acknowledgement?',
      `This ${NOUN[kind]} will move into your pipeline. Would you also like to send the ${PERSON[kind]} the usual thank-you email, which was held back when it was flagged?`,
      () => set.mutate([kind, id, false, true]),
      'Send acknowledgement',
      () => set.mutate([kind, id, false, false]),
      'Not now',
    );
  return (
    <View style={{ gap: Spacing.one }}>
      <Row gap={Spacing.two} wrap>
        {possible ? <Button title="Not spam" icon="check" size="sm" variant="secondary" loading={set.isPending} onPress={notSpam} /> : null}
        {status !== 'spam' ? (
          <Button title="Mark as spam" size="sm" variant={compact ? 'ghost' : 'outline'} loading={set.isPending && !possible} onPress={markSpam} />
        ) : null}
      </Row>
      <ErrorNote error={set.error} />
    </View>
  );
}
