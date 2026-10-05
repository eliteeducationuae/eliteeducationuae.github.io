import { useState } from 'react';
import { View } from 'react-native';

import { payrollSubtitle } from '@/components/rates';
import { Avatar, Button, Card, Loading, Row, Screen, Stat, StatGrid, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useEnrolments, useLessons, useSettings, useTutors } from '@/data/hooks';
import { formatAED, tutorEarnings } from '@/domain/billing';
import { formatMonth, startOfMonth } from '@/domain/dates';

export default function Payroll() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const lessons = useLessons(month, next);
  const tutors = useTutors();
  const settings = useSettings();
  const enrolments = useEnrolments();

  if (lessons.isLoading || tutors.isLoading || enrolments.isLoading || !settings.data) return <Loading />;
  const rows = (tutors.data ?? []).map((t) => ({ tutor: t, ...tutorEarnings(t, lessons.data ?? [], settings.data!, enrolments.data ?? []) }));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const hours = rows.reduce((s, r) => s + r.hours, 0);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="Previous" icon="back" size="sm" variant="secondary" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
        <Txt variant="h2">{formatMonth(month)}</Txt>
        <Button title="Next" iconAfter="forward" size="sm" variant="secondary" onPress={() => setMonth(next)} />
      </Row>
      <StatGrid>
        <Stat label="Total pay" value={formatAED(total)} />
        <Stat label="Hours taught" value={hours.toFixed(1)} />
      </StatGrid>
      <View style={{ gap: Spacing.two }}>
        {rows.map((r) => (
          <Card key={r.tutor.id}>
            <Row gap={Spacing.three}>
              <Avatar name={r.tutor.fullName} color={r.tutor.color} />
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{r.tutor.fullName}</Txt>
                <Txt variant="muted">{payrollSubtitle(r, r.tutor.hourlyPay)}</Txt>
              </View>
              <Txt variant="h3">{formatAED(r.amount)}</Txt>
            </Row>
          </Card>
        ))}
      </View>
      <Txt variant="small">
        Includes completed and no-show lessons{settings.data.payTutorForLateCancel ? ', plus late cancellations' : ''}. Change this in Business settings.
      </Txt>
      <Txt variant="small">Custom rates agreed for a student apply to that student’s lessons with their own tutor. Group lessons pay the highest rate among the students.</Txt>
    </Screen>
  );
}
