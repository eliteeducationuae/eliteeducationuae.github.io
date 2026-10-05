import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useLookup, useSettings } from '@/data/hooks';
import { useMe } from '@/data/session';
import { FEE_PRESETS, feeDescription, type AdmissionsCase, type FeePresetKey } from '@/domain/admissions';
import { formatAED } from '@/domain/billing';

import { Button, Card, Chip, ErrorNote, Field, Row, Screen, Section, Txt } from '../ui';
import { Notice } from './notice';

/** The admissions fee form: a preset, a description, quantity and unit price, and a total with VAT. */
export function BillForm({ c }: { c: AdmissionsCase }) {
  const me = useMe();
  const lookup = useLookup();
  const settings = useSettings();
  const bill = useAction(source.billAdmissionsFee);
  const [preset, setPreset] = useState<FeePresetKey>('package');
  const [description, setDescription] = useState(feeDescription('package', c.title));
  const [edited, setEdited] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');

  if (me.role !== 'admin') {
    return (
      <Screen>
        <Notice icon="alert">Only the office can bill advisory fees.</Notice>
      </Screen>
    );
  }

  const p = FEE_PRESETS.find((x) => x.key === preset) ?? FEE_PRESETS[0];
  const qty = preset === 'hourly' ? Number(quantity.replace(',', '.')) : 1;
  const price = Number(unitPrice.replace(/,/g, ''));
  const subtotal = qty > 0 && price > 0 ? qty * price : 0;
  const vatRate = settings.data?.vatRate ?? 0;
  const vat = subtotal * vatRate;
  const valid = description.trim().length > 0 && qty > 0 && price > 0;
  const family = lookup.family(c.familyId);

  function choose(k: FeePresetKey) {
    setPreset(k);
    if (!edited) setDescription(feeDescription(k, c.title));
  }

  return (
    <Screen
      footer={
        <Button
          title={valid ? `Create and send invoice · ${formatAED(subtotal + vat)}` : 'Create and send invoice'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid}
          loading={bill.isPending}
          onPress={async () => {
            const invoice = await bill.mutateAsync([{ caseId: c.id, description: description.trim(), quantity: qty, unitPrice: price }]);
            router.replace({ pathname: '/invoice/[id]', params: { id: invoice.id } });
          }}
        />
      }>
      <Card style={{ gap: 2 }}>
        <Txt variant="label">{family?.name ?? 'Family'}</Txt>
        <Txt variant="h3">{c.title}</Txt>
        <Txt variant="small">The invoice is sent to the family straight away and linked to this case.</Txt>
      </Card>
      <Section title="Type of fee">
        <Row gap={Spacing.one} wrap>
          {FEE_PRESETS.map((x) => (
            <Chip key={x.key} label={x.label} selected={preset === x.key} onPress={() => choose(x.key)} />
          ))}
        </Row>
        <Txt variant="small">{p.hint}</Txt>
      </Section>
      <Card style={{ gap: Spacing.three }}>
        <Field
          label="Description"
          value={description}
          onChangeText={(t) => {
            setDescription(t);
            setEdited(true);
          }}
          maxLength={200}
          hint="Shown on the invoice."
        />
        <Row gap={Spacing.two} style={{ alignItems: 'flex-start' }}>
          {preset === 'hourly' ? (
            <View style={{ flex: 1 }}>
              <Field label={p.quantityLabel ?? 'Quantity'} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
            </View>
          ) : null}
          <View style={{ flex: 2 }}>
            <Field
              label={preset === 'hourly' ? 'Hourly rate (AED)' : 'Price (AED)'}
              value={unitPrice}
              onChangeText={setUnitPrice}
              keyboardType="decimal-pad"
              placeholder="For example, 15000"
            />
          </View>
        </Row>
      </Card>
      {subtotal > 0 ? (
        <Notice icon="money">
          {preset === 'hourly' ? `${qty} × ${formatAED(price)} = ` : ''}
          {formatAED(subtotal)}
          {vatRate > 0 ? ` plus VAT at ${Math.round(vatRate * 100)}% (${formatAED(vat)}), ${formatAED(subtotal + vat)} in total.` : '. VAT is not charged at present.'}
        </Notice>
      ) : null}
      <ErrorNote error={bill.error} />
    </Screen>
  );
}
