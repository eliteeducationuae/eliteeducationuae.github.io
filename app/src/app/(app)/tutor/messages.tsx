import { router } from 'expo-router';

import { HeaderActions } from '@/components/role-tabs';
import { EmptyState, Group, GroupRow, Loading, PageHeader, Screen, Txt } from '@/components/ui';
import { useThreads } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatTime, isSameDay, relativeDay } from '@/domain/dates';

/** The tutor's conversations: one per family they teach. The office can read every family conversation. */
export default function TutorMessages() {
  const me = useMe();
  const threads = useThreads();
  if (threads.isLoading) return <Loading />;
  const list = threads.data ?? [];
  const now = new Date();
  return (
    <Screen topInset onRefresh={() => threads.refetch()} refreshing={threads.isRefetching}>
      <PageHeader kicker="Messages" title="Messages" sub="The families you teach. The office can also see every family conversation." right={<HeaderActions search />} />
      {list.length === 0 ? (
        <EmptyState icon="forum" title="No conversations yet" message="Your conversations with families will appear here." />
      ) : (
        <Group>
          {list.map((t) => {
            const mine = !!t.lastSender && t.lastSender === me.fullName;
            const when = t.lastAt ? (isSameDay(new Date(t.lastAt), now) ? formatTime(t.lastAt) : relativeDay(t.lastAt, now)) : undefined;
            return (
              <GroupRow
                key={t.familyId}
                avatar={t.parentName}
                title={`The ${t.familyName} family`}
                note={
                  <Txt variant="note" numberOfLines={1}>
                    {t.lastBody ? `${mine ? 'You' : (t.lastSender ?? '').split(' ')[0]}: ${t.lastBody}` : `Start a conversation with ${t.parentName}`}
                  </Txt>
                }
                value={t.unread ? `${t.unread} new` : when}
                valueTone={t.unread ? 'accent' : 'muted'}
                valueSize={12.5}
                onPress={() => router.push({ pathname: '/messages/[familyId]', params: { familyId: t.familyId } })}
              />
            );
          })}
        </Group>
      )}
    </Screen>
  );
}
