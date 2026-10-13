import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoHeader } from '@/components/admin-people/kit';
import { Conversation } from '@/components/messages';
import { Avatar, CountBadge, EmptyState, Group, GroupRow, Loading, PageHeader, Screen, TextLink, Txt, useWide } from '@/components/ui';
import { Layout } from '@/constants/theme';
import { useThreads } from '@/data/hooks';
import { useMe } from '@/data/session';
import { relativeDay } from '@/domain/dates';
import type { Thread } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * The inbox: one conversation per family. On a phone it is a list that opens each conversation; on a desktop the
 * list and the open conversation sit side by side. Nothing is opened (or marked read) until a family is chosen.
 */
export default function Inbox() {
  const threads = useThreads();
  const wide = useWide();
  const [current, setCurrent] = useState<string | null>(null);
  if (threads.isLoading) return <Loading />;
  const list = threads.data ?? [];
  const unread = list.reduce((n, t) => n + t.unread, 0);
  const header = <PageHeader back={{ fallback: '/' }} kicker="Families" title="Messages" sub={unread ? `${unread} unread` : undefined} />;
  const empty = <EmptyState icon="forum" title="No conversations yet" message="Your conversations with families will appear here." />;

  if (!wide) {
    return (
      <Screen topInset onRefresh={() => threads.refetch()} refreshing={threads.isRefetching}>
        <NoHeader title="Messages" />
        {header}
        {list.length ? <ThreadGroup list={list} onOpen={(id) => router.push({ pathname: '/messages/[familyId]', params: { familyId: id } })} /> : empty}
      </Screen>
    );
  }
  return <WideInbox header={header} list={list} empty={empty} current={current} onOpen={setCurrent} />;
}

function WideInbox({ header, list, empty, current, onOpen }: { header: ReactNode; list: Thread[]; empty: ReactNode; current: string | null; onOpen: (id: string) => void }) {
  const theme = useTheme();
  const me = useMe();
  const insets = useSafeAreaInsets();
  const open = list.find((t) => t.familyId === current);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <NoHeader title="Messages" />
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: Layout.maxWidth,
          paddingHorizontal: Layout.desktopPadX,
          paddingTop: Layout.desktopPadTop + insets.top,
          paddingBottom: 28,
          gap: Layout.desktopGap,
        }}>
        {header}
        {list.length ? (
          <View style={{ flex: 1, flexDirection: 'row', gap: 26, minHeight: 0 }}>
            <ScrollView style={{ width: 340, flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 12 }}>
              <ThreadGroup list={list} current={current} onOpen={onOpen} />
            </ScrollView>
            <View style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: theme.hairline, borderRadius: 18, overflow: 'hidden', backgroundColor: theme.background }}>
              {open ? (
                <>
                  <View
                    style={{
                      paddingHorizontal: 18,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.hairline,
                      backgroundColor: theme.surface,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                    }}>
                    <Avatar name={open.parentName} size={38} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="groupTitle">{`${open.familyName} family`}</Txt>
                      <Txt variant="note">{`${open.parentName} and the family’s other contacts`}</Txt>
                    </View>
                    {me.role === 'admin' ? (
                      <TextLink label="Open the family" onPress={() => router.push({ pathname: '/manage/family/[id]', params: { id: open.familyId } })} />
                    ) : null}
                  </View>
                  <Conversation key={open.familyId} familyId={open.familyId} />
                </>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
                  <EmptyState icon="forum" title="Choose a conversation" message="Pick a family on the left to read and reply." />
                </View>
              )}
            </View>
          </View>
        ) : (
          empty
        )}
      </View>
    </View>
  );
}

function ThreadGroup({ list, current, onOpen }: { list: Thread[]; current?: string | null; onOpen: (familyId: string) => void }) {
  return (
    <Group>
      {list.map((t) => (
        <GroupRow
          key={t.familyId}
          avatar={t.parentName}
          title={`${t.familyName} family`}
          accessibilityLabel={`${t.familyName} family${t.unread ? `, ${t.unread} unread` : ''}${current === t.familyId ? ', open' : ''}`}
          note={
            <Txt variant="note" numberOfLines={2}>
              {t.lastBody ? `${t.lastSender?.split(' ')[0]}: ${t.lastBody}` : `Start a conversation with ${t.parentName}`}
            </Txt>
          }
          right={
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              {t.lastAt ? <Txt variant="small">{relativeDay(t.lastAt)}</Txt> : null}
              {t.unread ? <CountBadge count={t.unread} size={20} /> : null}
            </View>
          }
          titleWeight={t.unread || current === t.familyId ? 'bold' : 'regular'}
          onPress={() => onOpen(t.familyId)}
        />
      ))}
    </Group>
  );
}
