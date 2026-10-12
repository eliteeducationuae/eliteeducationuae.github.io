import { router } from 'expo-router';
import { useState } from 'react';

import { FilterChips, NoHeader, RowMeta, SearchField } from '@/components/admin-people/kit';
import { ClosedToggle } from '@/components/closed-accounts';
import { Actions, Button, EmptyState, Group, GroupRow, Loading, PageHeader, Screen } from '@/components/ui';
import { useFamilies, useInvoices, useLoginEmails, usePackages, useStudents } from '@/data/hooks';
import { formatAED, invoiceTotals, packageRemaining } from '@/domain/billing';
import { CLOSED_LABEL, closedCount, closedLast, isClosed } from '@/domain/closed-accounts';

const FILTERS = ['All', 'Owes money', 'Autopay', 'No login yet', 'Prospects', 'Archived'] as const;
type Filter = (typeof FILTERS)[number];

export default function Families() {
  const families = useFamilies();
  const students = useStudents();
  const packages = usePackages();
  const invoices = useInvoices();
  const logins = new Set(useLoginEmails().data ?? []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [showClosed, setShowClosed] = useState(false);

  // What each family owes on issued invoices.
  const owed = new Map<string, number>();
  for (const i of invoices.data ?? []) {
    if (i.status !== 'sent') continue;
    const b = invoiceTotals(i).balance;
    if (b > 0.005) owed.set(i.familyId, (owed.get(i.familyId) ?? 0) + b);
  }
  const q = query.trim().toLowerCase();
  const kidsOf = (id: string) => (students.data ?? []).filter((s) => s.familyId === id && !isClosed(s));
  const matching = [...(families.data ?? [])]
    .filter((f) => {
      if (filter === 'Owes money') return !!owed.get(f.id);
      if (filter === 'Autopay') return !!f.autopay;
      if (filter === 'No login yet') return !isClosed(f) && !logins.has(f.email.toLowerCase());
      if (filter === 'Prospects') return f.status === 'prospect';
      if (filter === 'Archived') return f.status === 'archived';
      return true;
    })
    .filter((f) => !q || `${f.name} ${f.parentName} ${kidsOf(f.id).map((s) => s.fullName).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.name.localeCompare(b.name));
  const list = closedLast(matching, showClosed);
  const open = list.filter((f) => !isClosed(f)).length;

  return (
    <Screen topInset onRefresh={() => families.refetch()} refreshing={families.isRefetching}>
      <NoHeader title="Families" />
      <PageHeader back={{ fallback: '/admin' }} kicker="People" title="Families" />
      <SearchField placeholder="Family, parent or child" value={query} onChangeText={setQuery} />
      <FilterChips options={[...FILTERS]} value={filter} onChange={setFilter} />
      {families.isLoading ? (
        <Loading />
      ) : list.length === 0 && !closedCount(matching) ? (
        <EmptyState icon="people" title="No families found" message="Please try another name or filter, or add a new family." />
      ) : (
        <Group meta={`${open} ${open === 1 ? 'family' : 'families'}`}>
          {list.map((f) => {
            if (isClosed(f)) {
              return (
                <GroupRow
                  key={f.id}
                  avatar={f.parentName}
                  title={`${f.name} family`}
                  note="Kept for invoices and payment records"
                  right={<RowMeta tag={CLOSED_LABEL} />}
                  onPress={() => router.push({ pathname: '/manage/family/[id]', params: { id: f.id } })}
                />
              );
            }
            const kids = kidsOf(f.id).map((s) => s.fullName.split(' ')[0]);
            const credits = (packages.data ?? []).filter((p) => p.familyId === f.id).reduce((n, p) => n + packageRemaining(p), 0);
            const due = owed.get(f.id);
            const canSignIn = logins.has(f.email.toLowerCase());
            const tag =
              f.status === 'prospect'
                ? { tag: 'Prospect', tone: 'accent' as const }
                : f.status === 'archived'
                  ? { tag: 'Archived', tone: 'muted' as const }
                  : due
                    ? { tag: `${formatAED(due)} due`, tone: 'bad' as const }
                    : f.autopay
                      ? { tag: 'Autopay', tone: 'good' as const }
                      : {};
            return (
              <GroupRow
                key={f.id}
                avatar={f.parentName}
                title={`${f.name} family`}
                note={[f.parentName, kids.join(', ') || 'no students yet', credits ? `${credits} lesson credits` : null].filter(Boolean).join(' · ')}
                right={<RowMeta {...tag} meta={canSignIn ? 'Can sign in' : 'No login yet'} />}
                onPress={() => router.push({ pathname: '/manage/family/[id]', params: { id: f.id } })}
              />
            );
          })}
        </Group>
      )}
      <ClosedToggle count={closedCount(matching)} showing={showClosed} onToggle={() => setShowClosed((v) => !v)} />
      <Actions>
        <Button title="Add a family" icon="add" onPress={() => router.push('/manage/family-edit')} />
      </Actions>
    </Screen>
  );
}
