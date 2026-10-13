import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader } from '@/components/admin-people/kit';
import { payrollSubtitle } from '@/components/rates';
import { Actions, Button, Figure, Figures, Group, GroupRow, Loading, PageHeader, Screen, Txt } from '@/components/ui';
import { useEnrolments, useLessons, useSettings, useTutors } from '@/data/hooks';
import { formatAED, tutorEarnings } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';
import { formatMonth, minutesBetween, startOfMonth } from '@/domain/dates';

/** Admin: what each tutor has earned this month from recorded lessons, against the hours booked. */
export default function Payroll() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const lessons = useLessons(month, next);
  const tutors = useTutors();
  const settings = useSettings();
  const enrolments = useEnrolments();

  if (lessons.isLoading || tutors.isLoading || enrolments.isLoading || !settings.data) return <Loading />;
  const all = lessons.data ?? [];
  const rows = (tutors.data ?? [])
    .map((t) => {
      // Booked: every lesson in the month that is still going ahead or has happened.
      const booked = all.filter((l) => l.tutorId === t.id && l.status !== 'cancelled').reduce((n, l) => n + minutesBetween(new Date(l.start), new Date(l.end)), 0) / 60;
      return { tutor: t, booked, ...tutorEarnings(t, all, settings.data!, enrolments.data ?? []) };
    })
    // Closed tutors stay only when they were paid for something this month.
    .filter((r) => withoutClosed([r.tutor]).length || r.amount > 0);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const hours = rows.reduce((s, r) => s + r.hours, 0);
  const taught = rows.reduce((s, r) => s + r.lessons, 0);
  const toRecord = all.filter((l) => l.status === 'scheduled' && new Date(l.end) < new Date()).length;

  return (
    <Screen topInset>
      <NoHeader title="Tutor pay" />
      <PageHeader
        back={{ fallback: '/admin' }}
        kicker="Team · Pay"
        title="Tutor pay"
        sub={`Hours taught in ${formatMonth(month)} from recorded lessons. Bars show taught hours against hours booked for the month.`}>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Button title="Previous month" icon="arrow_back" size="sm" variant="secondary" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
          <Button title="Next month" iconAfter="arrow_forward" size="sm" variant="secondary" onPress={() => setMonth(next)} />
        </View>
      </PageHeader>
      <Figures>
        <Figure label="Hours taught" value={hours.toFixed(1)} hint={formatMonth(month)} />
        <Figure label="Pay accrued" value={formatAED(total)} hint="before tutors invoice" />
        <Figure label="Lessons" value={String(taught)} hint="counted for pay" />
      </Figures>
      {toRecord ? (
        <Txt variant="note">{`${toRecord} ${toRecord === 1 ? 'lesson is' : 'lessons are'} waiting to be recorded. They are not counted until recorded.`}</Txt>
      ) : null}
      <Group title={formatMonth(month)} meta="To date">
        {rows.map((r) => (
          <GroupRow
            key={r.tutor.id}
            avatar={r.tutor.fullName}
            avatarColor={r.tutor.color}
            title={r.tutor.fullName}
            note={payrollSubtitle(r, r.tutor.hourlyPay ?? 0)}
            progressLabel="Hours taught of hours booked"
            progress={r.booked ? Math.min(100, Math.round((r.hours / r.booked) * 100)) : 0}
            progressColor={r.tutor.color}
            value={formatAED(r.amount)}
            valueTone="text"
            onPress={() => router.push({ pathname: '/manage/tutor/[id]', params: { id: r.tutor.id } })}
          />
        ))}
      </Group>
      <Txt variant="note">
        Includes completed and no-show lessons{settings.data.payTutorForLateCancel ? ', plus late cancellations' : ''}. Change this in Business settings.
      </Txt>
      <Txt variant="note">Custom rates agreed for a student apply to that student’s lessons with their own tutor. Group lessons pay the highest rate among the students.</Txt>
      <Actions>
        <Button title="Tutor invoices" icon="description" onPress={() => router.push('/manage/tutor-invoices')} />
      </Actions>
    </Screen>
  );
}
