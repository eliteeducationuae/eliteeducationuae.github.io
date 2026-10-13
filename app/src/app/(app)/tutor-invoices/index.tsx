import { Redirect, router, Stack } from 'expo-router';

import { periodLabel, TUTOR_INVOICE_STATUS } from '@/components/tutor-pay';
import { Actions, Button, ErrorNote, Group, GroupRow, Loading, Notice, PageHeader, Screen } from '@/components/ui';
import { source } from '@/data';
import { useAction, usePaymentDetails, useTutorInvoices } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatMonth, toDateKey } from '@/domain/dates';
import { tutorInvoiceTotal } from '@/domain/tutor-pay';

/** Tutors: monthly invoices to Elite Education, filled in from the lessons you taught. */
export default function TutorInvoices() {
  const me = useMe();
  const viewing = !!useViewing();
  const invoices = useTutorInvoices();
  const bank = usePaymentDetails(me.tutorId ?? undefined);
  const create = useAction(source.createTutorInvoice);
  if (me.role === 'admin') return <Redirect href="/manage/tutor-invoices" />;
  if (invoices.isLoading || !me.tutorId) return <Loading />;
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const mine = (invoices.data ?? []).filter((i) => i.tutorId === me.tutorId).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const has = (d: Date) => mine.some((i) => i.periodStart === toDateKey(d));

  async function start(month: Date) {
    const id = await create.mutateAsync([me.tutorId!, toDateKey(month)]);
    router.push({ pathname: '/tutor-invoices/[id]', params: { id } });
  }

  return (
    <Screen topInset onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader back kicker="Pay" title="My invoices" sub="We fill each invoice in from the lessons you taught. Check it, add anything extra and submit." />
      {!bank.isLoading && !bank.data ? (
        <Notice tone="warn" icon="account_balance" link={{ label: 'Add them now', onPress: () => router.push('/payment-details') }}>
          Please add your bank details so that we can pay you.
        </Notice>
      ) : null}
      <Group title="Your invoices" note={mine.length ? undefined : 'Your monthly invoices will appear here once you create them.'}>
        {mine.map((i) => {
          const s = TUTOR_INVOICE_STATUS[i.status];
          const lessons = i.items.filter((x) => x.lessonId).length;
          return (
            <GroupRow
              key={i.id}
              icon="receipt_long"
              tone={i.status === 'paid' ? 'good' : i.status === 'rejected' ? 'bad' : 'gold'}
              title={periodLabel(i)}
              note={`${s.label} · ${i.number} · ${lessons} lesson${lessons === 1 ? '' : 's'}`}
              value={formatAED(tutorInvoiceTotal(i.items))}
              valueTone={i.status === 'paid' ? 'good' : i.status === 'draft' ? 'text' : 'accent'}
              onPress={() => router.push({ pathname: '/tutor-invoices/[id]', params: { id: i.id } })}
            />
          );
        })}
      </Group>
      <ErrorNote error={create.error} />
      {!viewing && (!has(lastMonth) || !has(thisMonth)) ? (
        <Actions>
          {!has(lastMonth) ? <Button title={`Invoice for ${formatMonth(lastMonth)}`} icon="receipt_long" loading={create.isPending} onPress={() => start(lastMonth)} /> : null}
          {!has(thisMonth) ? <Button title={`Start ${formatMonth(thisMonth)} (so far)`} icon="add" variant="secondary" loading={create.isPending} onPress={() => start(thisMonth)} /> : null}
        </Actions>
      ) : null}
    </Screen>
  );
}
