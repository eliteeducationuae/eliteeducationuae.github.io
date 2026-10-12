import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CataloguePicker } from '@/components/catalogue-picker';
import { NoHeader } from '@/components/ops/parts';
import { lessonsCount, OfferForm } from '@/components/payments';
import { Actions, Button, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, PageHeader, Row, Screen, Section, TextLink, Txt, useToast } from '@/components/ui';
import { font, Radius, tabular } from '@/constants/theme';
import { source } from '@/data';
import { useAction, usePackageOffers, useServices } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { cleanChoice, PHASES, SUBJECTS } from '@/domain/catalogue';
import { offerPerLesson, offerSavingPct, sortOffers } from '@/domain/payments';
import type { PackageOffer, Service } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

export default function Services() {
  const services = useServices();
  const offers = usePackageOffers();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [editingOffer, setEditingOffer] = useState<string | 'new' | null>(null);
  if (services.isLoading) return <Loading />;
  const serviceList = services.data ?? [];
  const offerList = sortOffers(offers.data ?? []);
  const nextSort = offerList.reduce((n, o) => Math.max(n, o.sort), 0) + 1;
  const shownOffers = offerList.filter((o) => o.id !== editingOffer);
  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader back kicker="Manage" title="Services and rates" />

      {editing === 'new' ? <ServiceForm onDone={() => setEditing(null)} /> : null}
      <Group title="Lesson types" link={editing === 'new' ? undefined : { label: 'Add a service', onPress: () => setEditing('new') }}>
        {serviceList.map((s) =>
          editing === s.id ? (
            <View key={s.id} style={{ padding: 14 }}>
              <ServiceForm existing={s} onDone={() => setEditing(null)} />
            </View>
          ) : (
            <GroupRow
              key={s.id}
              title={s.name}
              note={[`${s.durationMin} minutes`, s.subject, s.phase].filter(Boolean).join(' · ')}
              onPress={() => setEditing(s.id)}
              accessibilityLabel={`${s.name}, ${formatAED(s.rate)} per student. Edit`}
              right={
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt variant="figure" style={{ fontSize: 20, lineHeight: 24 }}>
                    {formatAED(s.rate)}
                  </Txt>
                  <Txt variant="small">per student</Txt>
                </View>
              }
            />
          ),
        )}
      </Group>
      {serviceList.length === 0 && editing !== 'new' ? <Txt variant="note">No lesson types yet. Add the first one above.</Txt> : null}
      <Txt variant="note">Rates are charged per student per lesson. Group lessons charge each student the group rate. Existing lessons keep their price.</Txt>

      <Section
        title="Packages families can buy"
        action={editingOffer === 'new' ? undefined : <TextLink label="Add a package" onPress={() => setEditingOffer('new')} />}>
        <Txt variant="note">
          Bought from the family’s Billing tab by card. Lessons are added as soon as payment arrives. Prices are before VAT.
        </Txt>
        {editingOffer === 'new' ? <OfferForm services={serviceList} nextSort={nextSort} onDone={() => setEditingOffer(null)} /> : null}
        {editingOffer && editingOffer !== 'new' ? (
          <OfferForm
            key={editingOffer}
            existing={offerList.find((o) => o.id === editingOffer)}
            services={serviceList}
            onDone={() => setEditingOffer(null)}
          />
        ) : null}
        {offers.isLoading ? (
          <Loading />
        ) : shownOffers.length ? (
          <View style={styles.packs}>
            {shownOffers.map((o) => (
              <PackageCard key={o.id} offer={o} service={serviceList.find((s) => s.id === o.serviceId)} onPress={() => setEditingOffer(o.id)} />
            ))}
          </View>
        ) : editingOffer ? null : (
          <Txt variant="note">No packages yet.</Txt>
        )}
        <Row>
          <TextLink label="Sell a package to a family" onPress={() => router.push('/manage/package-new')} />
        </Row>
      </Section>
    </Screen>
  );
}

/** A package offer as the prototype's noir card: saving, name, price and the price per lesson. Tap to edit. */
function PackageCard({ offer, service, onPress }: { offer: PackageOffer; service?: Service; onPress: () => void }) {
  const theme = useTheme();
  const saving = offerSavingPct(offer, service);
  const kicker = !offer.active ? 'Hidden from families' : saving ? `${saving}% saving` : lessonsCount(offer.lessons);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${offer.name}, ${formatAED(offer.price)}. Edit`}
      style={({ pressed }) => [styles.pack, { backgroundColor: theme.hero, borderColor: theme.heroBorder }, pressed && { opacity: 0.85 }]}>
      <Text style={[font('sans', 'bold'), styles.packKicker, { color: offer.active ? theme.gold : theme.onHeroMuted }]}>{kicker}</Text>
      <Text style={[font('serif'), styles.packName, { color: theme.onHero }]}>{offer.name}</Text>
      <Text style={[font('serif'), tabular, styles.packPrice, { color: theme.onHero }]}>{formatAED(offer.price)}</Text>
      <Text style={[font('sans'), styles.packNote, { color: theme.onHeroMuted }]}>
        {formatAED(offerPerLesson(offer))} a lesson · {lessonsCount(offer.lessons)} · {service?.name ?? 'any lesson type'}
      </Text>
    </Pressable>
  );
}

function ServiceForm({ existing, onDone }: { existing?: Service; onDone: () => void }) {
  const save = useAction(source.saveService);
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [duration, setDuration] = useState(existing ? String(existing.durationMin) : '60');
  const [rate, setRate] = useState(existing ? String(existing.rate) : '');
  const [subject, setSubject] = useState<string | undefined>(existing?.subject);
  const [phase, setPhase] = useState<string | undefined>(existing?.phase);
  const [tried, setTried] = useState(false);
  const badDuration = !(Number(duration) > 0);
  const badRate = rate === '' || !(Number(rate) >= 0);
  const valid = !!name.trim() && !badDuration && !badRate;
  return (
    <FieldsCard title={existing ? `Edit ${existing.name}` : 'Add a service'}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="For example, IB Extended Essay support" error={tried && !name.trim()} />
      <Field label="Length (minutes)" value={duration} onChangeText={setDuration} keyboardType="number-pad" error={tried && badDuration ? 'Enter the length in minutes.' : undefined} />
      <Field
        label="Price per lesson (AED, before VAT)"
        value={rate}
        onChangeText={setRate}
        keyboardType="decimal-pad"
        placeholder="For example, 520"
        error={tried && badRate ? 'Enter the price per student.' : undefined}
        hint="Charged per student. Families see the name on invoices; tutors see it on lessons."
      />
      <CataloguePicker label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} optional collapsed={10} />
      <CataloguePicker label="Phase" options={PHASES} value={phase} onChange={setPhase} optional />
      <ErrorNote error={save.error} />
      <Actions>
        <Button
          title={existing ? 'Save' : 'Add service'}
          loading={save.isPending}
          onPress={async () => {
            setTried(true);
            if (!valid) return;
            try {
              await save.mutateAsync([
                { id: existing?.id, name: name.trim(), durationMin: Number(duration), rate: Number(rate), subject: cleanChoice(subject), phase: cleanChoice(phase) },
              ]);
            } catch {
              return; // shown by ErrorNote
            }
            toast(existing ? `${name.trim()} saved` : `${name.trim()} added to services`);
            onDone();
          }}
        />
        <Button title="Cancel" variant="secondary" onPress={onDone} />
      </Actions>
    </FieldsCard>
  );
}

const styles = StyleSheet.create({
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  pack: { flexGrow: 1, flexShrink: 1, flexBasis: 260, borderRadius: Radius.card, borderWidth: 1, padding: 20, gap: 8 },
  packKicker: { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' },
  packName: { fontSize: 21, lineHeight: 27 },
  packPrice: { fontSize: 28, lineHeight: 34 },
  packNote: { fontSize: 13, lineHeight: 18 },
});
