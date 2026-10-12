import { Stack } from 'expo-router';

import { useAnnouncements } from '@/data/hooks';

import { EmptyState, Group, GroupRow, Loading, PageHeader, Screen } from '../ui';
import { dayMonth } from './format';

/** News from Elite Education, newest first; each opens to its full text. */
export function ParentAnnouncements() {
  const list = useAnnouncements();
  const items = list.data ?? [];
  return (
    <Screen topInset onRefresh={() => list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ headerShown: false, title: 'Announcements' }} />
      <PageHeader back={{ fallback: '/parent' }} kicker="From Elite Education" title="Announcements" />
      {list.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon="campaign" title="No announcements yet" message="News from Elite Education will appear here." />
      ) : (
        <Group>
          {items.map((a) => (
            <GroupRow key={a.id} icon="campaign" title={a.title} note={`${dayMonth(a.createdAt)} · ${a.authorName}`} body={a.body} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
