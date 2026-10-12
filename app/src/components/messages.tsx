import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useFamilyContacts, useMessages, useThreads } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe } from '@/data/session';
import { RELATIONSHIP_LABELS } from '@/domain/contacts';
import { formatTime, relativeDay } from '@/domain/dates';
import type { Message } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Avatar, Badge, EmptyState, ErrorNote, ListItem, Loading, Screen, Txt } from './ui';

/** The width of a message thread's column. */
const MESSAGE_COLUMN = 720;

/** Inbox: one conversation per family. */
export function ThreadList() {
  const threads = useThreads();
  if (threads.isLoading) return <Loading />;
  const list = threads.data ?? [];
  return (
    <Screen onRefresh={() => threads.refetch()} refreshing={threads.isRefetching}>
      {list.length === 0 ? (
        <EmptyState icon="people" title="No conversations yet" message="Your conversations with families will appear here." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((t) => (
            <ListItem
              key={t.familyId}
              title={`${t.familyName} family`}
              subtitle={t.lastBody ? `${t.lastSender?.split(' ')[0]}: ${t.lastBody}` : `Start a conversation with ${t.parentName}`}
              left={<Avatar name={t.parentName} />}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {t.lastAt ? <Txt variant="small">{relativeDay(t.lastAt)}</Txt> : null}
                  {t.unread ? <Badge label={String(t.unread)} tone="gold" /> : null}
                </View>
              }
              onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: t.familyId } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

/** A family conversation with a composer. `initialDraft` pre-fills the composer (e.g. a tutor's "I can't make it"). */
export function Conversation({ familyId, initialDraft }: { familyId: string; initialDraft?: string }) {
  const theme = useTheme();
  const me = useMe();
  const insets = useSafeAreaInsets();
  const messages = useMessages(familyId);
  const contacts = useFamilyContacts(familyId);
  // A parent sender's relationship (Mother, Father…), by login. Tutors never see profile ids, so they see the name alone.
  const relationshipBySender = new Map((contacts.data ?? []).filter((c) => c.profileId).map((c) => [c.profileId!, RELATIONSHIP_LABELS[c.relationship]]));
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const scroll = useRef<ScrollView>(null);
  const count = messages.data?.length ?? 0;

  // Mark read whenever new messages arrive while the conversation is open.
  useEffect(() => {
    if (!count) return;
    source
      .markThreadRead(familyId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['threads'] }))
      .catch(() => undefined);
  }, [familyId, count]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await source.sendMessage(familyId, body);
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['messages', familyId] });
      await queryClient.invalidateQueries({ queryKey: ['threads'] });
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  }

  const list = messages.data ?? [];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <View style={styles.inner}>
          {messages.isLoading ? (
            <Loading />
          ) : list.length === 0 ? (
            <EmptyState icon="people" title="No messages yet" message="Write your first message below. Everyone in this conversation will be notified." />
          ) : (
            list.map((m, i) => <Bubble key={m.id} m={m} relationship={m.senderId ? relationshipBySender.get(m.senderId) : undefined} mine={m.senderId === me.id} showDay={i === 0 || relativeDay(list[i - 1].createdAt) !== relativeDay(m.createdAt)} />)
          )}
        </View>
      </ScrollView>
      <View style={[styles.composerWrap, { backgroundColor: theme.background, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.inner}>
          <ErrorNote error={error} />
          <MessageComposer value={draft} onChangeText={setDraft} onSend={send} sending={sending} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine, showDay, relationship }: { m: Message; mine: boolean; showDay: boolean; relationship?: string }) {
  const who = mine
    ? undefined
    : `${m.senderName}${
        m.senderRole === 'tutor' ? ' · tutor' : m.senderRole === 'admin' ? ' · Elite Education' : m.senderRole === 'parent' && relationship ? ` · ${relationship}` : ''
      }`;
  return (
    <View style={{ gap: 6 }}>
      {showDay ? <DaySeparator label={relativeDay(m.createdAt)} /> : null}
      <MessageBubble mine={mine} who={who} time={formatTime(m.createdAt)}>
        {m.body}
      </MessageBubble>
    </View>
  );
}

/** "Today", "Monday"…: a small capitals label centred between messages. */
export function DaySeparator({ label }: { label: string }) {
  return (
    <Txt variant="label" style={{ textAlign: 'center', paddingTop: 10, paddingBottom: 4 }}>
      {label}
    </Txt>
  );
}

/**
 * One message: mine in a noir bubble (radius 20 20 6 20) on the right; theirs in a white bordered bubble
 * (20 20 20 6) on the left, with the sender above. Up to 82% wide, 15.5px text, the time underneath.
 */
export function MessageBubble({ mine = false, who, time, children }: { mine?: boolean; who?: string; time?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {who ? <Txt variant="small" style={{ fontSize: 12.5, paddingHorizontal: 4 }}>{who}</Txt> : null}
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: theme.primary, borderColor: theme.primary, borderBottomRightRadius: 6 }
            : { backgroundColor: theme.surface, borderColor: theme.border, borderBottomLeftRadius: 6 },
        ]}>
        <Text style={[font('sans'), styles.bubbleText, { color: mine ? theme.onPrimary : theme.text }]}>{children}</Text>
      </View>
      {time ? <Text style={[font('sans'), { fontSize: 11.5, color: theme.timestamp, paddingHorizontal: 4 }]}>{time}</Text> : null}
    </View>
  );
}

/**
 * The message composer: an auto-growing input (46 tall, radius 23) and a 46px send button, noir when there is
 * something to send and a quiet stone when empty. Pass `onAttach` only where attachments really work.
 */
export function MessageComposer({
  value,
  onChangeText,
  onSend,
  sending,
  onAttach,
  placeholder = 'Write a message',
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  sending?: boolean;
  onAttach?: () => void;
  placeholder?: string;
}) {
  const theme = useTheme();
  const ready = !!value.trim() && !sending;
  return (
    <View style={styles.composer}>
      {onAttach ? (
        <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Attach a photo or file" style={[styles.round, { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
          <Icon name="attach_file" size={21} color={theme.textMuted} />
        </Pressable>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline
        accessibilityLabel="Message"
        style={[styles.input, font('sans'), { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
      />
      <Pressable
        onPress={onSend}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !ready, busy: !!sending }}
        style={[styles.round, { backgroundColor: ready ? theme.primary : theme.sendDisabled }]}>
        <Icon name="arrow_upward" size={20} color={ready ? theme.onPrimary : theme.background} weight={400} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingHorizontal: 18, paddingVertical: Spacing.three },
  // Threads read best in a 720 column (the prototypes' width).
  inner: { width: '100%', maxWidth: MESSAGE_COLUMN, gap: 10 },
  bubble: { maxWidth: '82%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12 },
  bubbleText: { fontSize: 15.5, lineHeight: 22.5 },
  composerWrap: { paddingTop: 12, paddingHorizontal: 18 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 46, maxHeight: 140, borderRadius: 23, borderWidth: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12, fontSize: 15.5 },
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
