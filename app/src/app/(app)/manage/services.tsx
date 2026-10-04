import { useState } from 'react';
import { View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { Button, Card, ErrorNote, Field, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useServices } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { cleanChoice, PHASES, SUBJECTS } from '@/domain/catalogue';
import type { Service } from '@/domain/types';

export default function Services() {
  const services = useServices();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (services.isLoading) return <Loading />;
  return (
    <Screen
      footer={editing ? undefined : <Button title="Add service" icon="plus" variant="gold" style={{ flex: 1 }} onPress={() => setEditing('new')} />}>
      <Txt variant="muted">Rates are charged per student per lesson. Group lessons charge each student the group rate.</Txt>
      {editing === 'new' ? <ServiceForm onDone={() => setEditing(null)} /> : null}
      <View style={{ gap: Spacing.two }}>
        {(services.data ?? []).map((s) =>
          editing === s.id ? (
            <ServiceForm key={s.id} existing={s} onDone={() => setEditing(null)} />
          ) : (
            <Card key={s.id} onPress={() => setEditing(s.id)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="h3">{s.name}</Txt>
                  <Txt variant="muted">{[`${s.durationMin} minutes`, s.subject, s.phase].filter(Boolean).join(' · ')}</Txt>
                </View>
                <Txt variant="h3">{formatAED(s.rate)}</Txt>
              </Row>
            </Card>
          ),
        )}
      </View>
    </Screen>
  );
}

function ServiceForm({ existing, onDone }: { existing?: Service; onDone: () => void }) {
  const save = useAction(source.saveService);
  const [name, setName] = useState(existing?.name ?? '');
  const [duration, setDuration] = useState(existing ? String(existing.durationMin) : '60');
  const [rate, setRate] = useState(existing ? String(existing.rate) : '');
  const [subject, setSubject] = useState<string | undefined>(existing?.subject);
  const [phase, setPhase] = useState<string | undefined>(existing?.phase);
  const valid = name.trim() && Number(duration) > 0 && Number(rate) >= 0 && rate !== '';
  return (
    <Card style={{ gap: Spacing.three }}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="For example, IGCSE and GCSE 1:1" />
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Minutes" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Rate (AED)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        </View>
      </Row>
      <CataloguePicker label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} optional collapsed={10} />
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <ErrorNote error={save.error} />
      <Row gap={Spacing.two}>
        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onDone} />
        <Button
          title="Save"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={save.isPending}
          onPress={async () => {
            await save.mutateAsync([{ id: existing?.id, name: name.trim(), durationMin: Number(duration), rate: Number(rate), subject: cleanChoice(subject), phase: cleanChoice(phase) }]);
            onDone();
          }}
        />
      </Row>
    </Card>
  );
}
