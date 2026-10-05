import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Button, Card, Chip, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useSettings } from '@/data/hooks';
import { isValidTrn, normaliseTrn, VAT_QUARTER_OPTIONS } from '@/domain/tax';
import type { Settings, VatQuarterStartMonth } from '@/domain/types';

export default function SettingsScreen() {
  const settings = useSettings();
  if (!settings.data) return <Loading />;
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const save = useAction(source.saveSettings);
  const [businessName, setBusinessName] = useState(initial.businessName);
  const [hours, setHours] = useState(String(initial.cancellationHours));
  const [lateFee, setLateFee] = useState(String(Math.round(initial.lateCancelFee * 100)));
  const [noShowFee, setNoShowFee] = useState(String(Math.round(initial.noShowFee * 100)));
  const [payTutor, setPayTutor] = useState(initial.payTutorForLateCancel);
  const [vat, setVat] = useState(String(Math.round(initial.vatRate * 100)));
  const [dueDays, setDueDays] = useState(String(initial.invoiceDueDays));
  const [bank, setBank] = useState(initial.bankDetails ?? '');
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail ?? '');
  const [emailNotes, setEmailNotes] = useState(initial.emailLessonNotes);
  const [emailInvoices, setEmailInvoices] = useState(initial.emailInvoices);
  const [emailMessages, setEmailMessages] = useState(initial.emailMessages);
  const [notice, setNotice] = useState(String(initial.bookingNoticeHours));
  const [legalName, setLegalName] = useState(initial.legalName ?? '');
  const [trn, setTrn] = useState(initial.trn ?? '');
  const [address, setAddress] = useState(initial.registeredAddress ?? '');
  const [footer, setFooter] = useState(initial.invoiceFooter ?? '');
  const [quarterStart, setQuarterStart] = useState<VatQuarterStartMonth>(initial.vatQuarterStartMonth ?? 1);
  const pct = (s: string) => Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  const trnInvalid = !!trn.trim() && !isValidTrn(trn);

  return (
    <Screen
      footer={
        <Button
          title="Save settings"
          variant="gold"
          style={{ flex: 1 }}
          loading={save.isPending}
          disabled={trnInvalid}
          onPress={async () => {
            await save.mutateAsync([
              {
                businessName: businessName.trim() || initial.businessName,
                cancellationHours: Math.max(0, parseInt(hours, 10) || 0),
                lateCancelFee: pct(lateFee),
                noShowFee: pct(noShowFee),
                payTutorForLateCancel: payTutor,
                vatRate: pct(vat),
                invoiceDueDays: Math.max(0, parseInt(dueDays, 10) || 0),
                bankDetails: bank.trim() || undefined,
                notifyEmail: notifyEmail.trim() || undefined,
                emailLessonNotes: emailNotes,
                emailInvoices: emailInvoices,
                emailMessages: emailMessages,
                bookingNoticeHours: Math.max(0, parseInt(notice, 10) || 0),
                // Tax details: a blank clears the field.
                legalName: legalName.trim(),
                trn: normaliseTrn(trn),
                registeredAddress: address.trim(),
                invoiceFooter: footer.trim(),
                vatQuarterStartMonth: quarterStart,
              },
            ]);
            router.back();
          }}
        />
      }>
      <Field label="Business name" value={businessName} onChangeText={setBusinessName} />
      <Section title="Cancellation policy">
        <Card style={{ gap: Spacing.three }}>
          <Field label="Notice required (hours)" value={hours} onChangeText={setHours} keyboardType="number-pad" />
          <Row gap={Spacing.two}>
            <View style={{ flex: 1 }}>
              <Field label="Late cancel charge %" value={lateFee} onChangeText={setLateFee} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="No-show charge %" value={noShowFee} onChangeText={setNoShowFee} keyboardType="number-pad" />
            </View>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt style={{ flex: 1 }}>Pay tutors for late cancellations</Txt>
            <Switch value={payTutor} onValueChange={setPayTutor} accessibilityLabel="Pay tutors for late cancellations" />
          </Row>
        </Card>
      </Section>
      <Section title="Invoicing">
        <Card style={{ gap: Spacing.three }}>
          <Row gap={Spacing.two}>
            <View style={{ flex: 1 }}>
              <Field label="VAT %" value={vat} onChangeText={setVat} keyboardType="decimal-pad" hint="UAE standard rate is 5%." />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Payment terms (days)" value={dueDays} onChangeText={setDueDays} keyboardType="number-pad" />
            </View>
          </Row>
          <Field label="Bank details on invoices" value={bank} onChangeText={setBank} multiline />
        </Card>
      </Section>
      <Section title="Tax details (shown on tax invoices)">
        <Card style={{ gap: Spacing.three }}>
          <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder={initial.businessName} hint="As registered with the FTA. Leave blank to use the business name." />
          <Field
            label="TRN"
            value={trn}
            onChangeText={setTrn}
            keyboardType="number-pad"
            placeholder="100000000000003"
            hint={trnInvalid ? 'Enter the 15-digit TRN from your VAT certificate.' : 'Once set, invoices are issued as tax invoices.'}
          />
          <Field label="Registered address" value={address} onChangeText={setAddress} multiline />
          <Field label="Invoice footer (optional)" value={footer} onChangeText={setFooter} multiline hint="Printed at the foot of invoices and credit notes." />
          <View style={{ gap: Spacing.one }}>
            <Txt variant="label">VAT quarters start in</Txt>
            <Row gap={Spacing.one} wrap>
              {VAT_QUARTER_OPTIONS.map((o) => (
                <Chip key={o.value} label={o.label} selected={quarterStart === o.value} onPress={() => setQuarterStart(o.value)} />
              ))}
            </Row>
            <Txt variant="small">As shown on your VAT registration certificate.</Txt>
          </View>
        </Card>
      </Section>
      <Section title="Booking">
        <Card style={{ gap: Spacing.three }}>
          <Field
            label="Minimum notice for lesson requests (hours)"
            value={notice}
            onChangeText={setNotice}
            keyboardType="number-pad"
            hint="Families can only request times at least this far ahead. Set tutors’ hours under Tutors → Availability."
          />
        </Card>
      </Section>
      <Section title="Emails to families">
        <Card style={{ gap: Spacing.three }}>
          {(
            [
              ['Lesson notes after each lesson', emailNotes, setEmailNotes],
              ['New invoices', emailInvoices, setEmailInvoices],
              ['Messages from you and tutors', emailMessages, setEmailMessages],
            ] as const
          ).map(([label, value, set]) => (
            <Row key={label} style={{ justifyContent: 'space-between' }}>
              <Txt style={{ flex: 1 }}>{label}</Txt>
              <Switch value={value} onValueChange={set} accessibilityLabel={label} />
            </Row>
          ))}
          <Txt variant="small">Families with the app also get push notifications. Booking decisions and announcements are always emailed.</Txt>
          <Field
            label="Send business alerts to (optional)"
            value={notifyEmail}
            onChangeText={setNotifyEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            hint="New enquiries and lesson requests. Leave blank to use each admin’s login email."
          />
        </Card>
      </Section>
      {trnInvalid ? <Txt variant="small" color="danger">Enter the 15-digit TRN from your VAT certificate.</Txt> : null}
      <ErrorNote error={save.error} />
    </Screen>
  );
}
