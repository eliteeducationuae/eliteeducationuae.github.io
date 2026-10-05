import { useState } from 'react';

import { looksLikeEmail } from '@/components/tax';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, ListItem, Loading, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAccountants, useAction } from '@/data/hooks';
import { formatDate } from '@/domain/dates';
import { confirm, notify } from '@/lib/confirm';

/** Admin: invite the accountant to read the books, and withdraw access. */
export default function Accountants() {
  const accountants = useAccountants();
  const invite = useAction(source.inviteAccountant);
  const remove = useAction(source.removeAccountant);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = looksLikeEmail(email);

  async function send() {
    setTouched(true);
    if (!valid) return;
    const address = email.trim().toLowerCase();
    const result = await invite.mutateAsync([address, name.trim() || undefined]);
    notify(
      result === 'linked' ? 'Access given' : 'Invitation sent',
      result === 'linked' ? `${address} can now sign in.` : `An invitation has been sent to ${address}.`,
    );
    setEmail('');
    setName('');
    setTouched(false);
  }

  return (
    <Screen onRefresh={() => accountants.refetch()} refreshing={accountants.isRefetching}>
      <Card variant="highlight" style={{ gap: Spacing.one }}>
        <Txt variant="h3">What your accountant can see</Txt>
        <Txt variant="muted">
          Money, invoices, credit notes, payments, refunds, expenses and receipts, tutor invoice totals and VAT returns, read only. They never see
          students, lesson notes, messages or tutors’ bank details.
        </Txt>
      </Card>

      <Section title="Accountants">
        {accountants.isLoading ? <Loading /> : null}
        {accountants.data?.length === 0 ? (
          <EmptyState icon="person" title="No accountant yet" message="Invite your accountant below to give them read-only access." />
        ) : null}
        {(accountants.data ?? []).map((a) => (
          <ListItem
            key={a.email}
            title={a.fullName || a.email}
            subtitle={a.fullName ? a.email : undefined}
            below={
              a.acceptedAt ? (
                <Badge label={`Active since ${formatDate(a.acceptedAt)}`} tone="success" />
              ) : (
                <Badge label={`Invited ${formatDate(a.invitedAt)}`} tone="warning" />
              )
            }
            right={
              <Button
                title="Remove"
                variant="ghost"
                size="sm"
                onPress={() =>
                  confirm(
                    `Remove ${a.fullName || a.email}?`,
                    'They will no longer be able to sign in to see your accounts.',
                    () => remove.mutate([a.email]),
                    'Remove',
                  )
                }
              />
            }
          />
        ))}
        <ErrorNote error={remove.error ?? accountants.error} />
      </Section>

      <Section title="Invite an accountant">
        <Card style={{ gap: Spacing.three }}>
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            onBlur={() => setTouched(true)}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            hint={touched && !valid ? 'Please enter a valid email address.' : 'They sign in with this address.'}
          />
          <Field label="Name (optional)" value={name} onChangeText={setName} autoComplete="name" />
          <ErrorNote error={invite.error} />
          <Button title="Send invitation" icon="mail" variant="gold" disabled={!email.trim()} loading={invite.isPending} onPress={() => void send().catch(() => undefined)} />
        </Card>
      </Section>
    </Screen>
  );
}
