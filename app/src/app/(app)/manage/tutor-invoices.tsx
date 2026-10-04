import { useState } from 'react';
import { View } from 'react-native';

import { TutorInvoiceCard } from '@/components/tutor-pay';
import { EmptyState, Loading, Screen, Segmented, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLookup, useTutorInvoices } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { TutorInvoiceStatus } from '@/domain/types';

type Filter = 'submitted' | 'approved' | 'paid' | 'all';

/** Admin: approve tutor invoices, then pay them. */
export default function AdminTutorInvoices() {
  const invoices = useTutorInvoices();
  const lookup = useLookup();
  const [filter, setFilter] = useState<Filter>('submitted');
  if (invoices.isLoading || !lookup.ready) return <Loading />;
  const all = (invoices.data ?? []).filter((i) => i.status !== 'draft');
  const sum = (s: TutorInvoiceStatus) => all.filter((i) => i.status === s).reduce((n, i) => n + tutorInvoiceTotal(i.items), 0);
  const list = all
    .filter((i) => filter === 'all' || i.status === filter || (filter === 'submitted' && i.status === 'rejected'))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.number.localeCompare(b.number));
  return (
    <Screen onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <StatGrid>
        <Stat label="To approve" value={formatAED(sum('submitted'))} hint={`${all.filter((i) => i.status === 'submitted').length} invoices`} tone="warning" onPress={() => setFilter('submitted')} />
        <Stat label="Pay run" value={formatAED(sum('approved'))} hint="approved, not yet paid" tone="info" onPress={() => setFilter('approved')} />
      </StatGrid>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'submitted', label: 'To approve' },
          { value: 'approved', label: 'To pay' },
          { value: 'paid', label: 'Paid' },
          { value: 'all', label: 'All' },
        ]}
      />
      {filter === 'approved' && list.length ? <Txt variant="muted">Pay these by bank transfer, then mark each one paid with the reference.</Txt> : null}
      {list.length === 0 ? (
        <EmptyState icon="doc" title="No invoices in this view" message="Tutors submit their monthly invoices from the app." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((i) => (
            <TutorInvoiceCard key={i.id} inv={i} tutorName={lookup.tutor(i.tutorId)?.fullName} />
          ))}
        </View>
      )}
    </Screen>
  );
}
