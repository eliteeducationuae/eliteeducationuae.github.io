/** Announcements as a tutor reads them (2026 redesign): one expandable row each, newest first. */
import { Stack } from 'expo-router';

import { EmptyState, Group, GroupRow, Loading, PageHeader, Screen } from '@/components/ui';
import { useAnnouncements } from '@/data/hooks';
import { formatDate } from '@/domain/dates';

export function TutorAnnouncements() {
  const list = useAnnouncements();
  const items = list.data ?? [];
  return (
    <Screen topInset onRefresh={() => list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="From Elite Education" title="Announcements" />
      {list.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon="campaign" title="No announcements yet" message="News from Elite Education will appear here." />
      ) : (
        <Group>
          {items.map((a) => (
            <GroupRow key={a.id} icon="campaign" title={a.title} note={`${formatDate(a.createdAt)} · ${a.authorName}`} body={a.body} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
