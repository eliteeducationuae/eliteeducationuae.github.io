import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useLookup, usePaymentDetails } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatDate } from '@/domain/dates';
import { formatIban, isValidIban, maskIban, normaliseIban } from '@/domain/tutor-pay';
import type { PaymentDetails } from '@/domain/types';

/** Where tutors are paid. Replaces the Google Form; only the tutor and admins can see it. */
export default function PaymentDetailsScreen() {
  const me = useMe();
  const { tutorId: param } = useLocalSearchParams<{ tutorId?: string }>();
  const tutorId = (me.role === 'admin' && param) || me.tutorId;
  const details = usePaymentDetails(tutorId);
  const lookup = useLookup();
  if (!tutorId) return <Screen><EmptyState title="No tutor profile linked to this account" /></Screen>;
  if (details.isLoading) return <Loading />;
  const own = tutorId === me.tutorId;
  return (
    <Screen>
      <Stack.Screen options={{ title: own ? 'Payment details' : `${lookup.tutor(tutorId)?.fullName.split(' ')[0] ?? 'Tutor'}’s bank details` }} />
      <Banner icon="alert">Your bank details are private. Only you and Elite Education’s administrators can see them, and they are never sent by email.</Banner>
      <Form key={details.data?.updatedAt ?? 'new'} tutorId={tutorId} existing={details.data ?? null} startEditing={own && !details.data} />
    </Screen>
  );
}

function Form({ tutorId, existing, startEditing }: { tutorId: string; existing: PaymentDetails | null; startEditing: boolean }) {
  const save = useAction(source.savePaymentDetails);
  const [editing, setEditing] = useState(startEditing);
  const [revealed, setRevealed] = useState(false);
  const [accountName, setAccountName] = useState(existing?.accountName ?? '');
  const [bankName, setBankName] = useState(existing?.bankName ?? '');
  const [iban, setIban] = useState(existing ? formatIban(existing.iban) : '');
  const [swift, setSwift] = useState(existing?.swift ?? '');
  const ibanOk = isValidIban(iban);

  if (!editing) {
    if (!existing) {
      return (
        <EmptyState icon="money" title="No bank details yet" message="Please add the account into which we should pay you." action={<Button title="Add bank details" variant="gold" onPress={() => setEditing(true)} />} />
      );
    }
    return (
      <Card style={{ gap: Spacing.two }}>
        <Txt variant="label">Account name</Txt>
        <Txt variant="h3">{existing.accountName}</Txt>
        <Txt variant="label">Bank</Txt>
        <Txt>{existing.bankName}</Txt>
        <Txt variant="label">IBAN</Txt>
        <Row gap={Spacing.two}>
          <Txt style={{ fontVariant: ['tabular-nums'], flex: 1 }} selectable={revealed}>
            {revealed ? formatIban(existing.iban) : maskIban(existing.iban)}
          </Txt>
          <Button title={revealed ? 'Hide' : 'Reveal'} size="sm" variant="ghost" onPress={() => setRevealed(!revealed)} />
        </Row>
        {existing.swift ? (
          <>
            <Txt variant="label">SWIFT / BIC</Txt>
            <Txt>{existing.swift}</Txt>
          </>
        ) : null}
        {existing.updatedAt ? <Txt variant="small">Last updated {formatDate(existing.updatedAt)}</Txt> : null}
        <Button title="Update details" variant="secondary" onPress={() => setEditing(true)} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <Field label="Account holder name" value={accountName} onChangeText={setAccountName} autoCapitalize="words" />
      <Field label="Bank" value={bankName} onChangeText={setBankName} placeholder="e.g. Emirates NBD" />
      <Field
        label="IBAN"
        value={iban}
        onChangeText={(t) => setIban(formatIban(t))}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="AE07 0331 2345 6789 0123 456"
        hint={iban && !ibanOk ? 'That IBAN does not look right. Please check it.' : 'UAE IBANs start with AE and have 23 characters.'}
      />
      <Field label="SWIFT / BIC (optional)" value={swift} onChangeText={(t) => setSwift(t.toUpperCase())} autoCapitalize="characters" />
      <ErrorNote error={save.error} />
      <Row gap={Spacing.two}>
        {existing ? <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(false)} /> : null}
        <Button
          title="Save securely"
          variant="gold"
          style={{ flex: 1 }}
          disabled={!accountName.trim() || !bankName.trim() || !ibanOk}
          loading={save.isPending}
          onPress={async () => {
            await save.mutateAsync([{ tutorId, accountName, bankName, iban: normaliseIban(iban), swift: swift.trim() || undefined }]);
            setEditing(false);
          }}
        />
      </Row>
    </Card>
  );
}
