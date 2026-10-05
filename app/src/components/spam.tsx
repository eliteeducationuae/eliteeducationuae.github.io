import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction } from '@/data/hooks';
import { isRateLimitError, spamReasonPhrase, spamSummary } from '@/domain/spam';
import type { SpamReason, SpamStatus } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';

import { Icon } from './icon';
import { Badge, Banner, Button, Chip, ErrorNote, Row, Txt } from './ui';

type Kind = 'enquiry' | 'application';

interface SpamItem {
  spamStatus?: SpamStatus;
  spamReasons?: SpamReason[];
}

const NOUN: Record<Kind, string> = { enquiry: 'enquiry', application: 'application' };
const PERSON: Record<Kind, string> = { enquiry: 'family', application: 'applicant' };

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
      : `This ${NOUN[kind]} may have been sent automatically${why ? `: ${why}` : ''}. The team has not been alerted and no acknowledgement has been sent.`;
  return (
    <View style={{ gap: Spacing.two }}>
      <Banner tone="warning" icon="alert">
        {text}
      </Banner>
      <SpamActions kind={kind} id={id} status={item.spamStatus} />
    </View>
  );
}

/**
 * "Not spam" and "Mark as spam" buttons. Marking as spam asks first. "Not spam" opens an inline choice with three
 * plain answers (send the acknowledgement, move without an email, or cancel), which reads the same on every platform.
 */
export function SpamActions({ kind, id, status, compact }: { kind: Kind; id: string; status?: SpamStatus; compact?: boolean }) {
  const theme = useTheme();
  const set = useAction(source.setSpamStatus);
  const [choosing, setChoosing] = useState(false);
  const possible = status === 'suspected' || status === 'spam';
  const markSpam = () =>
    confirm(
      'Mark as spam',
      `Mark this ${NOUN[kind]} as spam? It will be kept but left out of your pipeline and statistics.`,
      () => set.mutate([kind, id, true]),
      'Mark as spam',
    );
  const release = (sendAck: boolean) => {
    setChoosing(false);
    set.mutate([kind, id, false, sendAck]);
  };
  return (
    <View style={{ gap: Spacing.one }}>
      {choosing ? (
        // The thank-you email was held back when this was flagged, so offer to send it now.
        <View style={[styles.choice, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}>
          <Txt variant="h3">Move to your pipeline?</Txt>
          <Txt variant="muted">
            {`This ${NOUN[kind]} will move into your pipeline. Would you also like to send the ${PERSON[kind]} the usual thank-you email, which was held back when it was flagged?`}
          </Txt>
          <Row gap={Spacing.two} wrap>
            <Button title="Send acknowledgement" icon="mail" size="sm" variant="primary" onPress={() => release(true)} />
            <Button title="Move without email" size="sm" variant="secondary" onPress={() => release(false)} />
            <Button title="Cancel" size="sm" variant="ghost" onPress={() => setChoosing(false)} />
          </Row>
        </View>
      ) : (
        <Row gap={Spacing.two} wrap>
          {possible ? <Button title="Not spam" icon="check" size="sm" variant="secondary" loading={set.isPending} onPress={() => setChoosing(true)} /> : null}
          {status !== 'spam' ? (
            <Button title="Mark as spam" size="sm" variant={compact ? 'ghost' : 'outline'} loading={set.isPending && !possible} onPress={markSpam} />
          ) : null}
        </Row>
      )}
      <ErrorNote error={set.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  reviewLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one, paddingHorizontal: Spacing.one },
  choice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, padding: Spacing.three, gap: Spacing.two },
});

/**
 * A quiet toggle under a list's tabs that switches to the items held as possible spam and back. Kept apart from the
 * pipeline tabs so those stay equal in width and never truncate on a narrow phone.
 */
export function SpamFilterChip({ count, selected, onPress }: { count: number; selected: boolean; onPress: () => void }) {
  if (!count && !selected) return null;
  return (
    <Row gap={Spacing.two} style={{ alignItems: 'center' }}>
      <Chip label={`Possible spam (${count})`} selected={selected} onPress={onPress} />
    </Row>
  );
}

/**
 * A quiet line on the admin home when items are held as possible spam, so a genuine family caught by the checks is
 * not missed. It is deliberately not part of "Needs attention" or its count.
 */
export function SpamReviewLine({ enquiries, applications }: { enquiries: number; applications: number }) {
  const theme = useTheme();
  const total = enquiries + applications;
  if (!total) return null;
  const parts = [
    enquiries ? `${enquiries} ${enquiries === 1 ? 'enquiry' : 'enquiries'}` : '',
    applications ? `${applications} ${applications === 1 ? 'application' : 'applications'}` : '',
  ].filter(Boolean);
  const label = `${parts.join(' and ')} held as possible spam to review`;
  const open = () => router.push({ pathname: enquiries ? '/manage/enquiries' : '/manage/applications', params: { view: 'spam' } });
  return (
    <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={label} style={({ pressed }) => [styles.reviewLine, pressed && { opacity: 0.7 }]}>
      <Icon name="inbox" size={16} color={theme.textMuted} />
      <Txt variant="small" style={{ flex: 1 }}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </Txt>
      <Icon name="chevron" size={14} color={theme.textMuted} />
    </Pressable>
  );
}
