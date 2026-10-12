import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { NoHeader } from '@/components/ops/parts';
import {
  Actions,
  Button,
  ChipField,
  ErrorNote,
  Field,
  FieldsCard,
  Loading,
  PageHeader,
  Row,
  Screen,
  Toggle,
  Txt,
  useToast,
  useWide,
} from '@/components/ui';
import { source } from '@/data';
import { useAction, useSettings } from '@/data/hooks';
import { isValidTrn, normaliseTrn, VAT_QUARTER_OPTIONS } from '@/domain/tax';
import type { Settings, VatQuarterStartMonth } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const settings = useSettings();
  if (!settings.data) return <Loading />;
  return <SettingsForm initial={settings.data} />;
}

/** Bank details are shown masked until the office chooses to reveal them. */
function maskBank(s: string): string {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 4 ? `Account ending ${digits.slice(-4)}` : '••••••••';
}

/** A settings block: title and note beside the fields on desktop, above them on a phone. */
function SettingsBlock({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const wide = useWide();
  const theme = useTheme();
  return (
    <View
      style={[
        { borderTopWidth: 1, borderTopColor: theme.hairline, paddingTop: wide ? 26 : 20 },
        wide ? { flexDirection: 'row', gap: 40, alignItems: 'flex-start' } : { gap: 12 },
      ]}>
      <View style={wide ? { width: 300, gap: 6 } : { gap: 4 }}>
        <Txt variant="groupTitle" accessibilityRole="header">
          {title}
        </Txt>
        {note ? <Txt variant="note">{note}</Txt> : null}
      </View>
      <FieldsCard style={wide ? { flex: 1 } : undefined}>{children}</FieldsCard>
    </View>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const save = useAction(source.saveSettings);
  const toast = useToast();
  const [businessName, setBusinessName] = useState(initial.businessName);
  const [hours, setHours] = useState(String(initial.cancellationHours));
  const [lateFee, setLateFee] = useState(String(Math.round(initial.lateCancelFee * 100)));
  const [noShowFee, setNoShowFee] = useState(String(Math.round(initial.noShowFee * 100)));
  const [payTutor, setPayTutor] = useState(initial.payTutorForLateCancel);
  const [vat, setVat] = useState(String(Math.round(initial.vatRate * 100)));
  const [dueDays, setDueDays] = useState(String(initial.invoiceDueDays));
  const [bank, setBank] = useState(initial.bankDetails ?? '');
  const [bankShown, setBankShown] = useState(!initial.bankDetails);
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
  const [captcha, setCaptcha] = useState(initial.captchaRequired ?? false);
  const pct = (s: string) => Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  const trnInvalid = !!trn.trim() && !isValidTrn(trn);

  async function submit() {
    if (trnInvalid) return;
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
        captchaRequired: captcha,
      },
    ]);
    if (router.canGoBack()) router.back();
    toast('Settings saved');
  }

  return (
    <Screen topInset>
      <NoHeader />
      <PageHeader back kicker="Manage" title="Business settings" />

      <SettingsBlock title="Business" note="Shown on invoices, emails and the app.">
        <Field label="Business name" value={businessName} onChangeText={setBusinessName} />
      </SettingsBlock>

      <SettingsBlock title="Cancellation policy" note="Applied automatically when a family or the office cancels a lesson.">
        <Field label="Notice required (hours)" value={hours} onChangeText={setHours} keyboardType="number-pad" />
        <Field label="Late-cancellation charge (%)" value={lateFee} onChangeText={setLateFee} keyboardType="number-pad" />
        <Field label="No-show charge (%)" value={noShowFee} onChangeText={setNoShowFee} keyboardType="number-pad" />
        <Toggle title="Pay tutors for late cancellations" value={payTutor} onValueChange={setPayTutor} />
      </SettingsBlock>

      <SettingsBlock title="Invoicing" note="Payment terms and the bank details printed on every invoice.">
        <Field label="VAT (%)" value={vat} onChangeText={setVat} keyboardType="decimal-pad" hint="UAE standard rate is 5%." />
        <Field label="Payment terms (days)" value={dueDays} onChangeText={setDueDays} keyboardType="number-pad" />
        {bankShown ? (
          <Field label="Bank details on invoices" value={bank} onChangeText={setBank} multiline />
        ) : (
          <View style={{ gap: 8 }}>
            <Txt variant="label">Bank details on invoices</Txt>
            <Row gap={12} style={{ justifyContent: 'space-between' }}>
              <Txt accessibilityLabel="Bank details hidden">{maskBank(bank)}</Txt>
              <Button title="Reveal" icon="visibility" size="sm" variant="secondary" onPress={() => setBankShown(true)} />
            </Row>
          </View>
        )}
      </SettingsBlock>

      <SettingsBlock title="Tax details" note="Once a TRN is set, invoices are issued as tax invoices.">
        <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder={initial.businessName} hint="As registered with the FTA. Leave blank to use the business name." />
        <Field
          label="TRN"
          value={trn}
          onChangeText={setTrn}
          keyboardType="number-pad"
          placeholder="100000000000003"
          error={trnInvalid ? 'Enter the 15-digit TRN from your VAT certificate.' : undefined}
          hint={trnInvalid ? undefined : 'The 15-digit number from your VAT certificate.'}
        />
        <Field label="Registered address" value={address} onChangeText={setAddress} multiline />
        <Field label="Invoice footer (optional)" value={footer} onChangeText={setFooter} multiline hint="Printed at the foot of invoices and credit notes." />
        <ChipField
          label="VAT quarters start in"
          options={VAT_QUARTER_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          value={String(quarterStart)}
          onChange={(v) => setQuarterStart(Number(v) as VatQuarterStartMonth)}
          hint="As shown on your VAT registration certificate."
        />
      </SettingsBlock>

      <SettingsBlock title="Booking" note="Families can only request times at least this far ahead.">
        <Field
          label="Minimum notice for lesson requests (hours)"
          value={notice}
          onChangeText={setNotice}
          keyboardType="number-pad"
          hint="Set tutors’ hours under Tutors → Availability."
        />
      </SettingsBlock>

      <SettingsBlock title="Website forms" note="Spam protection for the enquiry and application forms.">
        <Toggle
          title="Security check on website forms"
          note="Uses Cloudflare Turnstile, which needs to be set up on the website first (see the setup guide). When on, anything sent without the check by someone who is not signed in is kept and marked as possible spam, including the app’s own public forms, which do not show the check."
          value={captcha}
          onValueChange={setCaptcha}
        />
      </SettingsBlock>

      <SettingsBlock
        title="Emails to families"
        note="Families with the app also get push notifications. Booking decisions and announcements are always emailed.">
        <Toggle title="Lesson notes after each lesson" value={emailNotes} onValueChange={setEmailNotes} />
        <Toggle title="New invoices" value={emailInvoices} onValueChange={setEmailInvoices} />
        <Toggle title="Messages from you and tutors" value={emailMessages} onValueChange={setEmailMessages} />
        <Field
          label="Send business alerts to (optional)"
          value={notifyEmail}
          onChangeText={setNotifyEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          hint="New enquiries and lesson requests. Leave blank to use each admin’s login email."
        />
      </SettingsBlock>

      {trnInvalid ? (
        <Txt variant="small" color="danger">
          Enter the 15-digit TRN from your VAT certificate.
        </Txt>
      ) : null}
      <ErrorNote error={save.error} />
      <Actions>
        <Button title="Save settings" loading={save.isPending} disabled={trnInvalid} onPress={() => submit().catch(() => undefined)} />
      </Actions>
    </Screen>
  );
}
