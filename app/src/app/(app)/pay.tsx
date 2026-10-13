import { Stack } from 'expo-router';
import { useState } from 'react';

import { tutorCustomRateLines } from '@/components/rates';
import { LessonRow, monthName } from '@/components/tutor/common';
import { TUTOR_INVOICE_STATUS } from '@/components/tutor-pay';
import { EmptyState, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Tabs } from '@/components/ui';
import { useEnrolments, useLessons, useLookup, useSettings, useTutorInvoices } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, tutorEarnings } from '@/domain/billing';
import { startOfMonth, toDateKey } from '@/domain/dates';
import { byStart } from '@/domain/scheduling';
import { plural } from '@/lib/id';

/** The tutor's pay by month: earned, hours and lessons still to teach, with their own rates (never a family's price). */
export default function TutorEarnings() {
  const me = useMe();
  const lookup = useLookup();
  const settings = useSettings();
  const invoices = useTutorInvoices();
  const [now] = useState(() => new Date());
  const months = [-2, -1, 0].map((d) => new Date(now.getFullYear(), now.getMonth() + d, 1));
  const [key, setKey] = useState(() => toDateKey(startOfMonth(now)));
  const month = months.find((m) => toDateKey(m) === key) ?? months[2];
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const lessons = useLessons(month, next);
  const enrolments = useEnrolments();
  const tutor = me.tutorId ? lookup.tutor(me.tutorId) : undefined;

  if (lessons.isLoading || enrolments.isLoading || !settings.data || !lookup.ready) return <Loading />;
  if (!tutor) {
    return (
      <Screen topInset>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader back kicker="Pay" title="My pay" />
        <EmptyState title="No tutor profile linked to this account" />
      </Screen>
    );
  }
  const mine = (lessons.data ?? []).filter((l) => l.tutorId === tutor.id);
  const e = tutorEarnings(tutor, mine, settings.data, enrolments.data ?? []);
  // Only this tutor's own subjects, and only the pay: families' prices never reach a tutor.
  const customRates = me.role === 'tutor' ? tutorCustomRateLines(enrolments.data ?? [], tutor.id, (id) => lookup.student(id)?.fullName) : [];
  const paid = mine.filter((l) => l.status === 'completed' || l.status === 'no-show' || (l.status === 'late-cancel' && settings.data!.payTutorForLateCancel)).sort(byStart).reverse();
  const pending = mine.filter((l) => l.status === 'scheduled');
  const current = toDateKey(month) === toDateKey(startOfMonth(now));
  const invoice = (invoices.data ?? []).find((i) => i.tutorId === tutor.id && i.periodStart === toDateKey(month));
  const status = invoice ? TUTOR_INVOICE_STATUS[invoice.status].label : current ? 'So far' : 'Not invoiced yet';

  return (
    <Screen topInset onRefresh={() => lessons.refetch()} refreshing={lessons.isRefetching}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back
        kicker="Pay"
        title="My pay"
        sub={customRates.length ? `Your usual rate is ${formatAED(tutor.hourlyPay ?? 0)} per hour.` : `Paid at ${formatAED(tutor.hourlyPay ?? 0)} per hour.`}
      />
      <Tabs accessibilityLabel="Month" value={key} onChange={setKey} tabs={months.map((m) => ({ value: toDateKey(m), label: monthName(m) }))} />
      <Figures>
        <Figure label="Earned" value={formatAED(e.amount)} hint={status} tone="good" />
        <Figure label="Hours" value={String(e.hours)} hint={plural(e.lessons, 'lesson')} />
        {current ? <Figure label="Still to teach" value={String(pending.length)} hint="lessons this month" /> : null}
      </Figures>
      {customRates.length ? (
        <Group title="Custom rates" note="These students’ lessons with you are paid at an agreed rate instead of your usual rate.">
          {customRates.map((line) => (
            <GroupRow key={line} icon="payments" title={line} titleWeight="regular" />
          ))}
        </Group>
      ) : null}
      <Group title="Lessons taught" note={paid.length ? undefined : 'No lessons taught yet this month. Completed lessons appear here as soon as they are recorded.'}>
        {paid.map((l) => (
          <LessonRow key={l.id} lesson={l} now={now} />
        ))}
      </Group>
    </Screen>
  );
}
