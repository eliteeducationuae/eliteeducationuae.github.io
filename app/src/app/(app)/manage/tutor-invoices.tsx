import { router } from 'expo-router';
import { useState } from 'react';

import { NoHeader, RowMeta, type TagTone } from '@/components/admin-people/kit';
import { periodLabel, TUTOR_INVOICE_STATUS } from '@/components/tutor-pay';
import { Actions, Button, EmptyState, ErrorNote, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Tabs, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useLookup, useTutorInvoices } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { TutorInvoice, TutorInvoiceStatus } from '@/domain/types';
import { confirm } from '@/lib/confirm';

type Filter = 'submitted' | 'approved' | 'paid' | 'all';

const TONE: Record<TutorInvoiceStatus, TagTone> = { draft: 'muted', submitted: 'warn', approved: 'accent', rejected: 'bad', paid: 'good' };

/** Admin: approve tutor invoices, then pay them by bank transfer and mark each one paid. */
export default function AdminTutorInvoices() {
  const invoices = useTutorInvoices();
  const lookup = useLookup();
  const viewing = useViewing();
  const toast = useToast();
  const review = useAction(source.reviewTutorInvoice);
  const [filter, setFilter] = useState<Filter>('submitted');
  if (invoices.isLoading || !lookup.ready) return <Loading />;
  const all = (invoices.data ?? []).filter((i) => i.status !== 'draft');
  const of = (s: TutorInvoiceStatus) => all.filter((i) => i.status === s);
  const sum = (l: TutorInvoice[]) => l.reduce((n, i) => n + tutorInvoiceTotal(i.items), 0);
  const toApprove = of('submitted');
  const latestPaid = of('paid').sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  const paidMonth = latestPaid ? of('paid').filter((i) => i.periodStart === latestPaid.periodStart) : [];
  const list = all
    .filter((i) => filter === 'all' || i.status === filter || (filter === 'submitted' && i.status === 'rejected'))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.number.localeCompare(b.number));
  const first = (i: TutorInvoice) => lookup.tutor(i.tutorId)?.fullName.split(' ')[0] ?? 'The tutor';
  const open = (i: TutorInvoice) => router.push({ pathname: '/tutor-invoices/[id]', params: { id: i.id } });

  async function approveAll() {
    const n = toApprove.length;
    for (const i of toApprove) await review.mutateAsync([i.id, true]);
    toast(`${n} ${n === 1 ? 'invoice' : 'invoices'} approved.`);
  }

  return (
    <Screen topInset onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <NoHeader title="Tutor invoices" />
      <PageHeader
        back={{ fallback: '/admin' }}
        kicker="Team · Pay"
        title="Tutor invoices"
        sub="Each invoice lists the lessons the tutor recorded, plus any extras. Approve, pay by bank transfer, then mark it paid with the reference."
      />
      <Figures>
        <Figure label="To approve" value={formatAED(sum(toApprove))} hint={`${toApprove.length} ${toApprove.length === 1 ? 'invoice' : 'invoices'}`} tone={toApprove.length ? 'warn' : undefined} onPress={() => setFilter('submitted')} />
        <Figure label="Approved, unpaid" value={formatAED(sum(of('approved')))} hint={`${of('approved').length} to pay`} onPress={() => setFilter('approved')} />
        <Figure
          label={latestPaid ? `Paid for ${periodLabel(latestPaid)}` : 'Paid'}
          value={formatAED(sum(paidMonth))}
          hint="by bank transfer"
          tone="good"
          onPress={() => setFilter('paid')}
        />
      </Figures>
      <Tabs
        accessibilityLabel="Tutor invoices"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'submitted', label: 'To approve', badge: toApprove.length || undefined },
          { value: 'approved', label: 'To pay' },
          { value: 'paid', label: 'Paid' },
          { value: 'all', label: 'All' },
        ]}
      />
      <ErrorNote error={review.error} />
      {list.length === 0 ? (
        <EmptyState icon="description" title="No invoices in this view" message="Tutors submit their monthly invoices from the app." />
      ) : (
        <Group>
          {list.map((i) => {
            const lessons = i.items.filter((x) => x.lessonId).length;
            const extras = i.items.length - lessons;
            const name = lookup.tutor(i.tutorId)?.fullName ?? 'Tutor';
            return (
              <GroupRow
                key={i.id}
                avatar={name}
                avatarColor={lookup.tutor(i.tutorId)?.color}
                title={`${name} · ${periodLabel(i)}`}
                accessibilityLabel={`${name} ${periodLabel(i)}`}
                note={[i.number, `${lessons} recorded ${lessons === 1 ? 'lesson' : 'lessons'}${extras ? ` + ${extras} extra` : ''}`, i.submittedAt ? `submitted ${formatDate(i.submittedAt)}` : null].filter(Boolean).join(' · ')}
                right={<RowMeta tag={TUTOR_INVOICE_STATUS[i.status].label} tone={TONE[i.status]} meta={formatAED(tutorInvoiceTotal(i.items))} />}
                action={
                  i.status === 'submitted' && !viewing
                    ? {
                        label: 'Approve',
                        variant: 'primary',
                        accessibilityLabel: `Approve ${name}’s invoice`,
                        onPress: () =>
                          review.mutate([i.id, true], { onSuccess: () => toast(`${first(i)}’s invoice is approved.`) }),
                      }
                    : undefined
                }
                onPress={() => open(i)}
              />
            );
          })}
        </Group>
      )}
      {!viewing ? (
        <Actions>
          {filter === 'submitted' && toApprove.length > 1 ? (
            <Button
              title={`Approve all ${toApprove.length}`}
              icon="task_alt"
              loading={review.isPending}
              onPress={() => confirm(`Approve ${toApprove.length} invoices?`, 'They then wait under To pay until you pay them by bank transfer.', approveAll, 'Approve')}
            />
          ) : null}
          <Button title="Hours this month" icon="schedule" variant="secondary" onPress={() => router.push('/manage/payroll')} />
        </Actions>
      ) : null}
    </Screen>
  );
}
