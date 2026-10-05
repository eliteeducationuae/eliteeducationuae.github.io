import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Chip, ErrorNote, Field, Loading, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useFamilies, useServices } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';

/** Prepaid lesson bundles: the family is invoiced now and lessons draw credits automatically. */
export default function NewPackage() {
  const params = useLocalSearchParams<{ familyId?: string }>();
  const families = useFamilies();
  const services = useServices();
  const sell = useAction(source.sellPackage);
  const [familyId, setFamilyId] = useState(params.familyId ?? '');
  const [serviceId, setServiceId] = useState<string | undefined>();
  const [lessons, setLessons] = useState('10');
  const [discount, setDiscount] = useState('10');
  const [expiresAt, setExpiresAt] = useState('');

  if (families.isLoading || services.isLoading) return <Loading />;
  const service = services.data?.find((s) => s.id === serviceId);
  const count = parseInt(lessons, 10) || 0;
  const pct = Math.max(0, Math.min(100, Number(discount) || 0));
  const price = service ? Math.round(service.rate * count * (1 - pct / 100)) : 0;
  const valid = familyId && service && count > 0 && (!expiresAt || /^\d{4}-\d{2}-\d{2}$/.test(expiresAt));

  return (
    <Screen
      footer={
        <Button
          title={valid ? `Sell for ${formatAED(price)} & invoice` : 'Sell package'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={sell.isPending}
          onPress={async () => {
            const inv = await sell.mutateAsync([
              { familyId, serviceId, name: `${service!.name} ${count}-lesson bundle`, lessonsTotal: count, price, expiresAt: expiresAt || undefined },
            ]);
            router.replace({ pathname: '/invoice/[id]', params: { id: inv.id } });
          }}
        />
      }>
      <Section title="Family">
        <Row gap={Spacing.one} wrap>
          {withoutClosed(families.data).map((f) => (
            <Chip key={f.id} label={f.name} selected={familyId === f.id} onPress={() => setFamilyId(f.id)} />
          ))}
        </Row>
      </Section>
      <Section title="Lesson type">
        <Row gap={Spacing.one} wrap>
          {(services.data ?? []).map((s) => (
            <Chip key={s.id} label={`${s.name} · ${formatAED(s.rate)}`} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />
          ))}
        </Row>
      </Section>
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Lessons" value={lessons} onChangeText={setLessons} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Discount %" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" />
        </View>
      </Row>
      <Field label="Expires (optional)" value={expiresAt} onChangeText={setExpiresAt} placeholder="YYYY-MM-DD" />
      {service ? (
        <Banner icon="tag">
          {count} × {formatAED(service.rate)} = {formatAED(service.rate * count)}, less {pct}% → {formatAED(price)} ({formatAED(count ? price / count : 0)} per lesson).
        </Banner>
      ) : null}
      <ErrorNote error={sell.error} />
    </Screen>
  );
}
