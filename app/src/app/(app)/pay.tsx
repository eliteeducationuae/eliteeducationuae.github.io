import { useState } from 'react';

import { LessonCard } from '@/components/lessons';
import { Button, EmptyState, Loading, Row, Screen, Section, Stat, StatGrid, Txt } from '@/components/ui';
import { useLessons, useLookup, useSettings } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED, tutorEarnings } from '@/domain/billing';
import { formatMonth, startOfMonth } from '@/domain/dates';
import { byStart } from '@/domain/scheduling';

export default function TutorEarnings() {
  const me = useMe();
  const lookup = useLookup();
  const settings = useSettings();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const lessons = useLessons(month, next);
  const tutor = me.tutorId ? lookup.tutor(me.tutorId) : undefined;

  if (lessons.isLoading || !settings.data || !lookup.ready) return <Loading />;
  if (!tutor) return <Screen><EmptyState title="No tutor profile linked to this account" /></Screen>;
  const mine = (lessons.data ?? []).filter((l) => l.tutorId === tutor.id);
  const e = tutorEarnings(tutor, mine, settings.data);
  const paid = mine.filter((l) => l.status === 'completed' || l.status === 'no-show' || (l.status === 'late-cancel' && settings.data!.payTutorForLateCancel)).sort(byStart).reverse();
  const pending = mine.filter((l) => l.status === 'scheduled');

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="Previous" icon="back" size="sm" variant="secondary" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
        <Txt variant="h2">{formatMonth(month)}</Txt>
        <Button title="Next" size="sm" variant="secondary" onPress={() => setMonth(next)} />
      </Row>
      <StatGrid>
        <Stat label="Earned" value={formatAED(e.amount)} tone="success" />
        <Stat label="Hours" value={String(e.hours)} hint={`${e.lessons} lessons`} />
        <Stat label="Still to teach" value={String(pending.length)} hint="lessons this month" />
      </StatGrid>
      <Txt variant="small">Paid at {formatAED(tutor.hourlyPay)} per hour.</Txt>
      <Section title="Lessons taught">
        {paid.length ? paid.map((l) => <LessonCard key={l.id} lesson={l} lookup={lookup} perspective="tutor" showDate />) : <EmptyState title="No lessons taught yet this month" message="Completed lessons will appear here as soon as they are recorded." />}
      </Section>
    </Screen>
  );
}
