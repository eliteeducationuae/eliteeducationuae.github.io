import { useState } from 'react';

import { RequestCard } from '@/components/requests';
import { EmptyState, Loading, Screen, Segmented } from '@/components/ui';
import { useRequests } from '@/data/hooks';

export default function Requests() {
  const requests = useRequests();
  const [filter, setFilter] = useState<'pending' | 'done'>('pending');
  if (requests.isLoading) return <Loading />;
  const list = (requests.data ?? [])
    .filter((r) => (filter === 'pending' ? r.status === 'pending' : r.status !== 'pending'))
    .sort((a, b) => (filter === 'pending' ? a.start.localeCompare(b.start) : b.createdAt.localeCompare(a.createdAt)));
  return (
    <Screen onRefresh={() => requests.refetch()} refreshing={requests.isRefetching}>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pending', label: `Waiting (${(requests.data ?? []).filter((r) => r.status === 'pending').length})` },
          { value: 'done', label: 'Dealt with' },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon="calendar" title={filter === 'pending' ? 'No requests waiting' : 'Nothing here yet'} message="Families request extra lessons and changes from their app." />
      ) : (
        list.map((r) => <RequestCard key={r.id} r={r} />)
      )}
    </Screen>
  );
}
