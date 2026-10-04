import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Button, Card, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useSettings } from '@/data/hooks';
import type { Settings } from '@/domain/types';

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
  const pct = (s: string) => Math.max(0, Math.min(100, Number(s) || 0)) / 100;

  return (
    <Screen
      footer={
        <Button
          title="Save settings"
          variant="gold"
          style={{ flex: 1 }}
          loading={save.isPending}
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
              <Field label="VAT %" value={vat} onChangeText={setVat} keyboardType="decimal-pad" hint="5 once VAT-registered" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Payment terms (days)" value={dueDays} onChangeText={setDueDays} keyboardType="number-pad" />
            </View>
          </Row>
          <Field label="Bank details on invoices" value={bank} onChangeText={setBank} multiline />
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
      <ErrorNote error={save.error} />
    </Screen>
  );
}
