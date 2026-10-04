import { Redirect, router } from 'expo-router';
import { View } from 'react-native';

import { TutorInvoiceCard } from '@/components/tutor-pay';
import { Banner, Button, Card, EmptyState, ErrorNote, Loading, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, usePaymentDetails, useTutorInvoices } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatMonth, toDateKey } from '@/domain/dates';

/** Tutors: monthly invoices to Elite Education, built from the lessons you taught. */
export default function TutorInvoices() {
  const me = useMe();
  const invoices = useTutorInvoices();
  const bank = usePaymentDetails(me.tutorId);
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
    <Screen onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      {!bank.isLoading && !bank.data ? (
        <Banner tone="warning" icon="money">
          Add your bank details so we can pay you.{' '}
          <Txt variant="muted" color="accent" onPress={() => router.push('/payment-details')}>
            Add now
          </Txt>
        </Banner>
      ) : null}
      <Card style={{ gap: Spacing.two }}>
        <Txt variant="h3">Create an invoice</Txt>
        <Txt variant="muted">We fill it in from the lessons you taught — just check it, add anything extra, and submit.</Txt>
        <View style={{ gap: Spacing.two }}>
          {!has(lastMonth) ? <Button title={`Invoice for ${formatMonth(lastMonth)}`} variant="gold" icon="doc" loading={create.isPending} onPress={() => start(lastMonth)} /> : null}
          {!has(thisMonth) ? <Button title={`Start ${formatMonth(thisMonth)} (so far)`} variant="secondary" loading={create.isPending} onPress={() => start(thisMonth)} /> : null}
        </View>
        <ErrorNote error={create.error} />
      </Card>
      <Section title="Your invoices">
        {mine.length === 0 ? (
          <EmptyState icon="doc" title="No invoices yet" />
        ) : (
          <View style={{ gap: Spacing.two }}>
            {mine.map((i) => (
              <TutorInvoiceCard key={i.id} inv={i} />
            ))}
          </View>
        )}
      </Section>
    </Screen>
  );
}
