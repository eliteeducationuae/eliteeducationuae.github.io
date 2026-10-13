import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { FormWithSummary, NoHeader, SummaryCard } from '@/components/admin-people/kit';
import { LoginHint } from '@/components/login-hint';
import { Actions, Button, ChipField, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useFamilies, useSettings } from '@/data/hooks';
import { isClosed } from '@/domain/closed-accounts';
import { formatPercent } from '@/domain/billing';
import { isValidTrn, normaliseTrn } from '@/domain/tax';
import type { Family, FamilyStatus } from '@/domain/types';

/**
 * Add a family, or edit one family's name, status and billing details (`?id=…&edit=1`). Everything else about a
 * family (children, contacts, packages, card, View as, calendar link, history) is on its page, `/manage/family/[id]`;
 * an old link to this form without `edit` (notifications, the card portal's return address) opens that page.
 */
export default function EditFamily() {
  const { id, edit } = useLocalSearchParams<{ id?: string; edit?: string }>();
  const families = useFamilies();
  if (id && !edit) return <Redirect href={{ pathname: '/manage/family/[id]', params: { id } }} />;
  if (families.isLoading) return <Loading />;
  const existing = id ? families.data?.find((f) => f.id === id) : undefined;
  // A closed family has nothing to edit; its page explains what is kept.
  if (existing && isClosed(existing)) return <Redirect href={{ pathname: '/manage/family/[id]', params: { id: existing.id } }} />;
  return <FamilyForm key={existing?.id ?? 'new'} existing={existing} />;
}

const STATUSES: { value: FamilyStatus; label: string }[] = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

function FamilyForm({ existing }: { existing?: Family }) {
  const save = useAction(source.saveFamily);
  const settings = useSettings();
  const toast = useToast();
  const [tried, setTried] = useState(false);
  const [name, setName] = useState(existing?.name ?? '');
  const [parentName, setParentName] = useState(existing?.parentName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [status, setStatus] = useState<FamilyStatus>(existing?.status ?? 'active');
  const [billingName, setBillingName] = useState(existing?.billingName ?? '');
  const [billingAddress, setBillingAddress] = useState(existing?.billingAddress ?? '');
  const [trn, setTrn] = useState(existing?.trn ?? '');
  const trnInvalid = !!trn.trim() && !isValidTrn(trn);
  const emailInvalid = !existing && !/\S+@\S+/.test(email);
  // An existing family's contacts are edited on its page; the form keeps its main contact as it is.
  const valid = !!name.trim() && (existing ? true : !!parentName.trim() && !emailInvalid) && !trnInvalid;
  // Only sent when filled in or being cleared, so a family without billing details stays without them.
  const optional = (value: string, before?: string) => value.trim() || (before ? '' : undefined);
  const vat = settings.data?.vatRate;
  const back = () => (router.canGoBack() ? router.back() : router.replace(existing ? { pathname: '/manage/family/[id]', params: { id: existing.id } } : '/manage/families'));

  async function submit() {
    setTried(true);
    if (!valid) return;
    const saved = await save.mutateAsync([
      {
        ...(existing
          ? // The main contact's details are kept as they are now, so a change made in Contacts meanwhile is not undone.
            { id: existing.id, parentName: existing.parentName, email: existing.email, phone: existing.phone }
          : { parentName: parentName.trim(), email: email.trim(), phone: phone.trim() || undefined }),
        name: name.trim(),
        status,
        billingName: optional(billingName, existing?.billingName),
        billingAddress: optional(billingAddress, existing?.billingAddress),
        trn: optional(normaliseTrn(trn), existing?.trn),
      },
    ]);
    if (existing) {
      back();
      toast(`The ${saved.name} family’s details are saved.`);
    } else {
      // Straight on to the first child, as before.
      router.replace({ pathname: '/students/edit', params: { familyId: saved.id } });
      toast(`The ${saved.name} family is added. Now add their first child.`);
    }
  }

  return (
    <Screen topInset>
      <NoHeader title={existing ? `${existing.name} family` : 'New family'} />
      <PageHeader
        back={{ label: 'Cancel', onPress: back }}
        kicker={existing ? 'People · Edit' : 'People · New'}
        title={existing ? `The ${existing.name} family` : 'Add a family'}
        sub={
          existing
            ? 'Name, status and billing details. Contacts, children and packages are on the family’s page.'
            : 'The main contact receives lesson notes, reports and invoices. Add their children afterwards.'
        }
      />
      {tried && !valid ? (
        <Notice tone="danger" title="Not saved yet">
          A few details are missing. They are marked below.
        </Notice>
      ) : null}
      <FormWithSummary
        summary={
          <SummaryCard
            kicker="Summary"
            title={name.trim() ? `${name.trim()} family` : 'New family'}
            lines={[
              { k: 'Status', v: STATUSES.find((s) => s.value === status)!.label },
              { k: 'Billed to', v: billingName.trim() || parentName.trim() || existing?.parentName || '–' },
              { k: 'Customer TRN', v: trn.trim() ? normaliseTrn(trn) : 'None' },
            ]}
            note={
              vat !== undefined
                ? `Invoices include VAT at ${formatPercent(vat)} and the cancellation policy from Business settings.`
                : 'Invoices follow the VAT rate and cancellation policy in Business settings.'
            }
          />
        }>
        <FieldsCard title={existing ? 'Family' : 'Main contact'}>
          <Field label="Family name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="For example, Al Mansoori" error={tried && !name.trim()} />
          {existing ? null : (
            <>
              <Field label="Main contact name" value={parentName} onChangeText={setParentName} autoCapitalize="words" placeholder="For example, Mariam Al Hashimi" error={tried && !parentName.trim()} />
              <Field
                label="Main contact email (invoices, reports and sign-in)"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="name@example.com"
                error={tried && emailInvalid ? (email.trim() ? 'Please enter a full email address.' : true) : undefined}
              />
              <Field label="Main contact phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+971 50 000 0000" />
              <LoginHint email={email} who="parent" name={parentName} />
            </>
          )}
          <ChipField label="Status" options={STATUSES} value={status} onChange={setStatus} hint="Prospects have enquired but not yet started lessons." />
        </FieldsCard>
        <FieldsCard title="Billing details (optional)">
          <Field
            label="Billed to (company or legal name)"
            value={billingName}
            onChangeText={setBillingName}
            autoCapitalize="words"
            placeholder={parentName.trim() || existing?.parentName || undefined}
            hint="Printed as the customer on tax invoices. Leave blank to use the parent’s name."
          />
          <Field label="Billing address" value={billingAddress} onChangeText={setBillingAddress} multiline />
          <Field
            label="Customer TRN"
            value={trn}
            onChangeText={setTrn}
            keyboardType="number-pad"
            hint={trnInvalid ? undefined : 'Only for VAT-registered companies.'}
            error={trnInvalid ? 'Enter the 15-digit TRN from the VAT certificate.' : undefined}
          />
        </FieldsCard>
      </FormWithSummary>
      <ErrorNote error={save.error} />
      <Actions>
        <Button title={existing ? 'Save changes' : 'Add family'} icon="check" loading={save.isPending} onPress={() => void submit().catch(() => undefined)} />
        <Button title="Cancel" variant="secondary" onPress={back} />
      </Actions>
    </Screen>
  );
}
