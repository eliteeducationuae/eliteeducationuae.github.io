import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useMessages, useThreads } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { useMe } from '@/data/session';
import { formatTime, relativeDay } from '@/domain/dates';
import type { Message } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';
import { Avatar, Badge, EmptyState, ErrorNote, ListItem, Loading, Screen, Txt } from './ui';

/** Inbox: one conversation per family. */
export function ThreadList() {
  const threads = useThreads();
  if (threads.isLoading) return <Loading />;
  const list = threads.data ?? [];
  return (
    <Screen onRefresh={() => threads.refetch()} refreshing={threads.isRefetching}>
      {list.length === 0 ? (
        <EmptyState icon="people" title="No conversations yet" message="Messages with families appear here." />
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

/** A family conversation with a composer. */
export function Conversation({ familyId }: { familyId: string }) {
  const theme = useTheme();
  const me = useMe();
  const insets = useSafeAreaInsets();
  const messages = useMessages(familyId);
  const [draft, setDraft] = useState('');
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
            <EmptyState icon="people" title="No messages yet" message="Say hello! Everyone in this conversation will be notified." />
          ) : (
            list.map((m, i) => <Bubble key={m.id} m={m} mine={m.senderId === me.id} showDay={i === 0 || relativeDay(list[i - 1].createdAt) !== relativeDay(m.createdAt)} />)
          )}
        </View>
      </ScrollView>
      <View style={[styles.composerWrap, { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: insets.bottom + Spacing.two }]}>
        <View style={styles.inner}>
          <ErrorNote error={error} />
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              placeholderTextColor={theme.textMuted}
              multiline
              accessibilityLabel="Message"
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={[styles.send, { backgroundColor: draft.trim() ? theme.primary : theme.border }]}>
              <Icon name="forward" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine, showDay }: { m: Message; mine: boolean; showDay: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {showDay ? (
        <Txt variant="small" style={{ textAlign: 'center', marginVertical: Spacing.two }}>
          {relativeDay(m.createdAt)}
        </Txt>
      ) : null}
      <View style={[styles.bubble, mine ? { alignSelf: 'flex-end', backgroundColor: theme.primary } : { alignSelf: 'flex-start', backgroundColor: theme.surface, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]}>
        {!mine ? (
          <Txt variant="small" style={{ fontWeight: '700', color: theme.accent }}>
            {m.senderName}
            {m.senderRole === 'tutor' ? ' · tutor' : m.senderRole === 'admin' ? ' · Elite Education' : ''}
          </Txt>
        ) : null}
        <Txt style={{ color: mine ? '#fff' : theme.text }}>{m.body}</Txt>
        <Txt variant="small" style={{ color: mine ? '#ffffffaa' : theme.textMuted, alignSelf: 'flex-end' }}>
          {formatTime(m.createdAt)}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, alignItems: 'center', padding: Spacing.three },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.two },
  bubble: { maxWidth: '82%', borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, paddingHorizontal: Spacing.three, alignItems: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
