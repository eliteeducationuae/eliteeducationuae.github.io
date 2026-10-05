import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AmountLine, balanceLine, parseAmount, Rule, SwitchRow } from '@/components/tax';
import { Banner, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice } from '@/data/hooks';
import { useMe } from '@/data/session';
import { invoiceTotals } from '@/domain/billing';
import { creditableLines, creditRemaining, planCreditFromGross, planCreditNote, round2, type CreditNotePlan } from '@/domain/tax';
import type { CreditNote, Invoice } from '@/domain/types';
import { aed } from '@/lib/invoice-pdf';

type Mode = 'lines' | 'amount';

/** Admin: credit all or part of an issued invoice. */
export default function NewCreditNote() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const me = useMe();
  const invoice = useInvoice(invoiceId);
  const notes = useCreditNotes({ invoiceId });
  if (me.role !== 'admin') {
    return (
      <Screen>
        <EmptyState icon="alert" title="Not available" message="Only the office can issue credit notes." />
      </Screen>
    );
  }
  if (invoice.isLoading || notes.isLoading) return <Loading />;
  if (!invoice.data) {
    return (
      <Screen>
        <EmptyState title="Invoice not found" />
      </Screen>
    );
  }
  return <CreditNoteForm invoice={invoice.data} existing={notes.data ?? []} />;
}

function CreditNoteForm({ invoice, existing }: { invoice: Invoice; existing: CreditNote[] }) {
  const issue = useAction(source.issueCreditNote);
  const [mode, setMode] = useState<Mode>('lines');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [gross, setGross] = useState('');
  const [reason, setReason] = useState('');
  const [release, setRelease] = useState(false);

  const lines = creditableLines(invoice, existing);
  const remaining = creditRemaining(invoice, existing);
  const issued = invoice.status === 'sent' || invoice.status === 'paid';

  const preview = ((): { plan?: CreditNotePlan; error?: string; lines?: { description: string; invoiceLine?: number; net: number }[] } => {
    try {
      if (mode === 'lines') {
        const chosen = lines
          .map((l) => ({ description: l.description, invoiceLine: l.index, net: parseAmount(amounts[l.index] ?? '') }))
          .filter((l) => !Number.isNaN(l.net) && l.net !== 0);
        if (chosen.length === 0) return {};
        const plan = planCreditNote(invoice, existing, chosen);
        return { plan, lines: chosen };
      }
      const g = parseAmount(gross);
      if (Number.isNaN(g)) return {};
      const description = reason.trim() ? `Credit: ${reason.trim()}` : 'Credit';
      const plan = planCreditFromGross(invoice, existing, g, description);
      // Sent as one line of the planned net; the data layer works out the same VAT.
      return { plan, lines: [{ description, net: plan.subtotal }] };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  const totals = invoiceTotals(invoice);
  const balanceAfter = preview.plan ? balanceLine(round2(totals.balance - preview.plan.total)) : undefined;
  const ready = !!preview.plan && !!reason.trim() && issued;

  async function submit() {
    if (!preview.lines) return;
    const note = await issue.mutateAsync([{ invoiceId: invoice.id, reason: reason.trim(), lines: preview.lines, releaseCharges: release }]);
    router.replace({ pathname: '/credit-note/[id]', params: { id: note.id } });
  }

  return (
    <Screen
      footer={
        <Button
          title={preview.plan ? `Issue credit note for ${aed(preview.plan.total)}` : 'Issue credit note'}
          variant="gold"
          icon="doc"
          style={{ flex: 1 }}
          disabled={!ready}
          loading={issue.isPending}
          onPress={() => void submit().catch(() => undefined)}
        />
      }>
      <Card style={{ gap: Spacing.one }}>
        <Txt variant="label">Against {invoice.number}</Txt>
        <Txt variant="h2">{aed(remaining.gross)} left to credit</Txt>
        <Txt variant="muted">
          Invoice total {aed(totals.total)}
          {totals.credited > 0 ? `, of which ${aed(totals.credited)} has already been credited` : ''}.
        </Txt>
      </Card>
      {!issued ? <Banner tone="warning" icon="alert">Only sent or paid invoices can take a credit note.</Banner> : null}

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'lines', label: 'By line' },
          { value: 'amount', label: 'An amount' },
        ]}
      />

      {mode === 'lines' ? (
        <Section title="Lines to credit (excluding VAT)">
          {lines.map((l) => (
            <Card key={l.index} style={{ gap: Spacing.two }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
                <Txt style={{ flex: 1 }}>{l.description}</Txt>
                <Txt variant="muted">{aed(l.net)}</Txt>
              </Row>
              {l.remaining > 0 ? (
                <Row gap={Spacing.two} style={{ alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Net to credit (AED)"
                      value={amounts[l.index] ?? ''}
                      onChangeText={(v) => setAmounts((a) => ({ ...a, [l.index]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      hint={l.credited > 0 ? `${aed(l.credited)} already credited; ${aed(l.remaining)} left.` : undefined}
                    />
                  </View>
                  <Chip label="Full" selected={parseAmount(amounts[l.index] ?? '') === l.remaining} onPress={() => setAmounts((a) => ({ ...a, [l.index]: l.remaining.toFixed(2) }))} />
                </Row>
              ) : (
                <Txt variant="small">This line has been credited in full.</Txt>
              )}
            </Card>
          ))}
        </Section>
      ) : (
        <Card style={{ gap: Spacing.two }}>
          <Field
            label="Amount to credit, including VAT (AED)"
            value={gross}
            onChangeText={setGross}
            keyboardType="decimal-pad"
            placeholder="0.00"
            hint={`Up to ${aed(remaining.gross)}. The VAT is worked out for you.`}
          />
        </Card>
      )}

      <Field label="Reason" value={reason} onChangeText={setReason} multiline placeholder="For example: lesson on 12 September cancelled by the tutor." hint="Printed on the credit note. Required." />
      <SwitchRow
        label="Invoice these lessons again"
        value={release}
        onChange={setRelease}
        hint="Use this when correcting an invoice: the credited lessons return to the family's unbilled list."
      />

      {preview.error ? <Banner tone="danger" icon="alert">{preview.error}</Banner> : null}
      {preview.plan ? (
        <Section title="Preview">
          <Card style={{ gap: Spacing.one }}>
            <AmountLine label="Credit excluding VAT" value={aed(preview.plan.subtotal)} />
            <AmountLine label="VAT" value={aed(preview.plan.vat)} />
            <AmountLine label="Total credit" value={aed(preview.plan.total)} strong />
            <Rule />
            {balanceAfter ? <AmountLine label={`${balanceAfter.label} afterwards`} value={balanceAfter.value} /> : null}
            {preview.plan.full ? <Txt variant="small">This credits everything left on the invoice, so it will be marked as credited.</Txt> : null}
          </Card>
        </Section>
      ) : null}
      <ErrorNote error={issue.error} />
    </Screen>
  );
}
