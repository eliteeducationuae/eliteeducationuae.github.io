import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Actions, Button, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, PageHeader, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useLookup, usePaymentDetails } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
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
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back
        kicker="Pay"
        title={own ? 'Payment details' : `${lookup.tutor(tutorId)?.fullName.split(' ')[0] ?? 'Tutor'}’s bank details`}
        sub="Private: only you and Elite Education’s administrators can see them, and they are never sent by email."
      />
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
  const [tried, setTried] = useState(false);
  const toast = useToast();
  const viewing = !!useViewing();

  if (!editing) {
    if (!existing) {
      return (
        <EmptyState
          icon="account_balance"
          title="No bank details yet"
          message="Please add the account into which we should pay you."
          action={!viewing ? <Button title="Add bank details" onPress={() => setEditing(true)} /> : undefined}
        />
      );
    }
    return (
      <>
        <Group>
          <GroupRow icon="person" title="Account name" note={existing.accountName} />
          <GroupRow icon="account_balance" title="Bank" note={existing.bankName} />
          <GroupRow
            icon="lock"
            title="IBAN"
            note={revealed ? formatIban(existing.iban) : maskIban(existing.iban)}
            action={{ label: revealed ? 'Hide' : 'Reveal', onPress: () => setRevealed(!revealed), accessibilityLabel: revealed ? 'Hide the IBAN' : 'Reveal the IBAN' }}
          />
          {existing.swift ? <GroupRow icon="account_balance" title="SWIFT / BIC" note={existing.swift} /> : null}
          {existing.updatedAt ? <GroupRow icon="schedule" title="Last updated" note={formatDate(existing.updatedAt)} titleWeight="regular" /> : null}
        </Group>
        {!viewing ? (
          <Actions>
            <Button title="Update details" icon="edit" variant="secondary" onPress={() => setEditing(true)} />
          </Actions>
        ) : null}
      </>
    );
  }

  return (
    <>
      <FieldsCard>
        <Field label="Account holder name" value={accountName} onChangeText={setAccountName} autoCapitalize="words" error={tried && !accountName.trim()} />
        <Field label="Bank" value={bankName} onChangeText={setBankName} placeholder="e.g. Emirates NBD" error={tried && !bankName.trim()} />
        <Field
          label="IBAN"
          value={iban}
          onChangeText={(t) => setIban(formatIban(t))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="AE07 0331 2345 6789 0123 456"
          error={(tried || !!iban) && !ibanOk ? 'That IBAN does not look right. Please check it.' : undefined}
          hint="UAE IBANs start with AE and have 23 characters."
        />
        <Field label="SWIFT / BIC (optional)" value={swift} onChangeText={(t) => setSwift(t.toUpperCase())} autoCapitalize="characters" />
      </FieldsCard>
      <ErrorNote error={save.error} />
      {!viewing ? (
        <Actions>
          <Button
            title="Save securely"
            icon="lock"
            loading={save.isPending}
            onPress={async () => {
              setTried(true);
              if (!accountName.trim() || !bankName.trim() || !ibanOk) return;
              await save.mutateAsync([{ tutorId, accountName, bankName, iban: normaliseIban(iban), swift: swift.trim() || undefined }]);
              setEditing(false);
              toast('Payment details saved');
            }}
          />
          {existing ? <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} /> : null}
        </Actions>
      ) : null}
    </>
  );
}
