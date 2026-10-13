import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoHeader, SummaryCard } from '@/components/ops/parts';
import { packagePriceNotes } from '@/components/rates';
import { Actions, Button, ChipField, Columns, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useEnrolments, useFamilies, useServices, useSettings, useStudents } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { withoutClosed } from '@/domain/closed-accounts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Prepaid lesson bundles: the family is invoiced now (a numbered tax invoice) and lessons draw credits automatically. */
export default function NewPackage() {
  const params = useLocalSearchParams<{ familyId?: string }>();
  const toast = useToast();
  const families = useFamilies();
  const services = useServices();
  const students = useStudents();
  const enrolments = useEnrolments();
  const settings = useSettings();
  const sell = useAction(source.sellPackage);
  const [familyId, setFamilyId] = useState(params.familyId ?? '');
  const [serviceId, setServiceId] = useState<string | undefined>();
  const [lessons, setLessons] = useState('10');
  const [discount, setDiscount] = useState('10');
  const [expiresAt, setExpiresAt] = useState('');
  const [tried, setTried] = useState(false);

  if (families.isLoading || services.isLoading) return <Loading />;
  const service = services.data?.find((s) => s.id === serviceId);
  const family = families.data?.find((f) => f.id === familyId);
  const count = parseInt(lessons, 10) || 0;
  const pct = Math.max(0, Math.min(100, Number(discount) || 0));
  const price = service ? Math.round(service.rate * count * (1 - pct / 100)) : 0;
  const priceNotes = familyId ? packagePriceNotes(students.data ?? [], familyId, enrolments.data ?? []) : [];
  const badExpiry = !!expiresAt && !DATE.test(expiresAt);
  const valid = familyId && service && count > 0 && !badExpiry;
  const vatPct = settings.data ? Math.round(settings.data.vatRate * 1000) / 10 : null;

  async function submit() {
    setTried(true);
    // Guarded rather than asserted: the compiled screen reads this while no lesson type is chosen.
    if (!valid || !service) return;
    const inv = await sell.mutateAsync([
      { familyId, serviceId: service.id, name: `${service.name} bundle`, lessonsTotal: count, price, expiresAt: expiresAt || undefined },
    ]);
    router.replace({ pathname: '/invoice/[id]', params: { id: inv.id } });
    toast(family ? `${count} lessons sold to the ${family.name} family. Invoice issued.` : 'Package sold. Invoice issued.');
  }

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader
        back
        kicker="Billing · Package"
        title="Sell a package"
        sub="Issues a numbered tax invoice to the family now. Each lesson then draws on the credits automatically."
      />
      <Columns>
        <View style={{ gap: 20 }}>
          <FieldsCard>
            <ChipField
              label="Family"
              options={withoutClosed(families.data).map((f) => ({ value: f.id, label: f.name }))}
              value={familyId}
              onChange={setFamilyId}
              error={tried && !familyId}
            />
            {priceNotes.map((note) => (
              <Notice key={note} tone="warn">
                {note}
              </Notice>
            ))}
            <ChipField
              label="Lesson type"
              options={(services.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${formatAED(s.rate)}` }))}
              value={serviceId}
              onChange={setServiceId}
              error={tried && !service}
            />
            <Field label="Lessons" value={lessons} onChangeText={setLessons} keyboardType="number-pad" error={tried && count <= 0 ? 'Enter how many lessons.' : undefined} />
            <Field label="Discount (%)" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" />
            <Field
              label="Expires (optional)"
              value={expiresAt}
              onChangeText={setExpiresAt}
              placeholder="YYYY-MM-DD"
              error={badExpiry ? 'Use YYYY-MM-DD for the expiry date.' : undefined}
            />
          </FieldsCard>
        </View>
        <View style={{ gap: 20 }}>
          <SummaryCard
            kicker="The offer"
            title={service ? `${count} lessons${family ? ` for the ${family.name} family` : ''}` : 'Choose a lesson type'}
            lines={
              service
                ? [
                    { k: `${count} × ${formatAED(service.rate)}`, v: formatAED(service.rate * count) },
                    { k: `Discount at ${pct}%`, v: `− ${formatAED(service.rate * count - price)}` },
                    { k: 'Per lesson', v: formatAED(count ? price / count : 0) },
                  ]
                : undefined
            }
            total={service ? { k: 'Package price, before VAT', v: formatAED(price) } : undefined}
            note={
              vatPct !== null
                ? `VAT at ${vatPct}% is added on the invoice.${expiresAt && !badExpiry ? ` Credits expire on ${expiresAt}.` : ''}`
                : undefined
            }
          />
          <ErrorNote error={sell.error} />
          <Actions>
            <Button
              title={valid ? `Sell for ${formatAED(price)} and invoice` : 'Sell package'}
              icon="sell"
              loading={sell.isPending}
              onPress={() => submit().catch(() => undefined)}
            />
          </Actions>
        </View>
      </Columns>
    </Screen>
  );
}
