import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useClosures } from '@/data/hooks';
import { formatDate, toDateKey } from '@/domain/dates';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Term breaks and public holidays: recurring lessons skip them and families can't book them. */
export default function Closures() {
  const closures = useClosures();
  const save = useAction(source.saveClosure);
  const remove = useAction(source.deleteClosure);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  if (closures.isLoading) return <Loading />;
  const today = toDateKey(new Date());
  const list = [...(closures.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const upcoming = list.filter((c) => c.endDate >= today);
  const valid = name.trim() && DATE.test(start) && DATE.test(end || start) && (end || start) >= start;

  return (
    <Screen>
      <Txt variant="muted">
        When you schedule weekly lessons, dates in these breaks are skipped automatically and families can’t request lessons on them.
        Lessons already booked on these days are not cancelled.
      </Txt>
      <Section title="Upcoming">
        {upcoming.length === 0 ? <EmptyState icon="sun" title="No holidays set" /> : null}
        {upcoming.map((c) => (
          <Card key={c.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{c.name}</Txt>
                <Txt variant="muted">
                  {formatDate(c.startDate)}
                  {c.endDate !== c.startDate ? ` – ${formatDate(c.endDate)}` : ''}
                </Txt>
              </View>
              <Button title="Remove" size="sm" variant="ghost" onPress={() => remove.mutate([c.id])} />
            </Row>
          </Card>
        ))}
      </Section>
      <Section title="Add a break or holiday">
        <Card style={{ gap: Spacing.three }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Eid al-Fitr, Spring break" />
          <Row gap={Spacing.two}>
            <View style={{ flex: 1 }}>
              <Field label="From" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="To (optional)" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" />
            </View>
          </Row>
          <ErrorNote error={save.error} />
          <Button
            title="Add"
            variant="gold"
            disabled={!valid}
            loading={save.isPending}
            onPress={async () => {
              await save.mutateAsync([{ name: name.trim(), startDate: start, endDate: end || start }]);
              setName('');
              setStart('');
              setEnd('');
            }}
          />
        </Card>
      </Section>
    </Screen>
  );
}
