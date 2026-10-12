import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Ledger, SideCard, Split } from '@/components/money/blocks';
import { balanceLine, parseAmount } from '@/components/tax';
import { Button, Chip, EmptyState, ErrorNote, Field, Loading, Notice, PageHeader, Screen, Segmented, Toggle, Txt, useToast } from '@/components/ui';
import { font, Radius } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useCreditNotes, useInvoice, useLookup } from '@/data/hooks';
import type { CreditNoteInput } from '@/data/source';
import { useMe } from '@/data/session';
import { invoiceTotals } from '@/domain/billing';
import { formatLineDescription } from '@/domain/dates';
import { creditableLines, creditRemaining, planCreditFromGross, planCreditNote, round2, type CreditNotePlan } from '@/domain/tax';
import type { CreditNote, Invoice } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { aed } from '@/lib/invoice-pdf';

type Mode = 'lines' | 'amount';

const head = <Stack.Screen options={{ headerShown: false }} />;

/** Admin: credit all or part of an issued invoice. A credit note is a numbered tax record and cannot be undone. */
export default function NewCreditNote() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const me = useMe();
  const invoice = useInvoice(invoiceId);
  const notes = useCreditNotes({ invoiceId });
  if (me.role !== 'admin') {
    return (
      <Screen topInset>
        {head}
        <PageHeader back kicker="Credit note" title="Not available" />
        <EmptyState icon="alert" title="Not available" message="Only the office can issue credit notes." />
      </Screen>
    );
  }
  if (invoice.isLoading || notes.isLoading) {
    return (
      <Screen topInset>
        {head}
        <Loading />
      </Screen>
    );
  }
  if (!invoice.data) {
    return (
      <Screen topInset>
        {head}
        <PageHeader back kicker="Credit note" title="Invoice not found" />
        <EmptyState title="Invoice not found" />
      </Screen>
    );
  }
  return <CreditNoteForm invoice={invoice.data} existing={notes.data ?? []} />;
}

function CreditNoteForm({ invoice, existing }: { invoice: Invoice; existing: CreditNote[] }) {
  const theme = useTheme();
  const toast = useToast();
  const lookup = useLookup();
  const issue = useAction(source.issueCreditNote);
  const [mode, setMode] = useState<Mode>('lines');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [gross, setGross] = useState('');
  const [reason, setReason] = useState('');
  const [release, setRelease] = useState(false);

  const lines = creditableLines(invoice, existing);
  const remaining = creditRemaining(invoice, existing);
  const issued = invoice.status === 'sent' || invoice.status === 'paid';
  const family = lookup.family(invoice.familyId);

  // Per line: what was typed, and whether it credits the rest of the line (only those lessons can be invoiced again).
  const typed = lines.map((l) => {
    const value = parseAmount(amounts[l.index] ?? '');
    const given = !Number.isNaN(value) && value !== 0;
    return {
      index: l.index,
      error: given && round2(value) > l.remaining ? `Only ${aed(l.remaining)} is left on this line.` : undefined,
      inFull: given && l.remaining > 0 && round2(value) === l.remaining,
    };
  });
  const anyInFull = mode === 'lines' && typed.some((t) => t.inFull && !!invoice.items[t.index]?.chargeId);
  const releasing = release && anyInFull;

  const preview = ((): { plan?: CreditNotePlan; error?: string; input?: Pick<CreditNoteInput, 'lines' | 'gross'> } => {
    try {
      if (mode === 'lines') {
        const chosen = lines
          .map((l) => ({ description: l.description, invoiceLine: l.index, net: parseAmount(amounts[l.index] ?? '') }))
          .filter((l) => !Number.isNaN(l.net) && l.net !== 0);
        if (chosen.length === 0) return {};
        const plan = planCreditNote(invoice, existing, chosen);
        return { plan, input: { lines: chosen } };
      }
      const g = parseAmount(gross);
      if (Number.isNaN(g)) return {};
      const description = reason.trim() ? `Credit: ${reason.trim()}` : 'Credit';
      const plan = planCreditFromGross(invoice, existing, g, description);
      // Sent as the gross itself, so the data layer splits it the same way and the total is exactly this amount.
      return { plan, input: { lines: [], gross: round2(g) } };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  const totals = invoiceTotals(invoice);
  const plan = preview.plan;
  const after = balanceLine(round2(totals.balance - (plan?.total ?? 0)));
  const ready = !!plan && !!reason.trim() && issued;

  async function submit() {
    if (!preview.input || !plan) return;
    const note = await issue.mutateAsync([{ invoiceId: invoice.id, reason: reason.trim(), ...preview.input, releaseCharges: releasing }]);
    router.replace({ pathname: '/credit-note/[id]', params: { id: note.id } });
    toast(`Credit note for ${aed(plan.total)} issued.${releasing ? ' Those lessons are ready to invoice again.' : ''}`);
  }

  function confirmIssue() {
    if (!plan) return;
    confirm(
      `Issue a credit note for ${aed(plan.total)}?`,
      [
        `${aed(plan.subtotal)} plus ${aed(plan.vat)} VAT will be credited against ${invoice.number}, and it will show in the family’s billing.`,
        releasing ? 'The lessons on the lines credited in full will return to the unbilled list to be invoiced again.' : '',
        plan.full ? 'This credits everything left, so the invoice will be marked as credited.' : '',
        'A credit note is a permanent tax record and cannot be undone.',
      ]
        .filter(Boolean)
        .join(' '),
      () => void submit().catch(() => undefined),
      'Issue',
    );
  }

  return (
    <Screen topInset>
      {head}
      <PageHeader
        back
        kicker={`Credit note · against ${invoice.number}`}
        title={`${aed(remaining.gross)} left to credit`}
        sub={`${family ? `${family.name} family. ` : ''}Invoice total ${aed(totals.total)}${totals.credited > 0 ? `, of which ${aed(totals.credited)} is already credited` : ''}.`}
      />
      {!issued ? <Notice tone="warn">Only sent or paid invoices can take a credit note.</Notice> : null}

      <Split>
        <View style={{ gap: 22 }}>
          <View style={{ width: '100%', maxWidth: 320 }}>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'lines', label: 'By line' },
                { value: 'amount', label: 'An amount' },
              ]}
            />
          </View>

          {mode === 'lines' ? (
            <View style={{ gap: 14 }}>
              <Txt variant="label">Lines to credit, excluding VAT</Txt>
              <View style={{ borderTopWidth: 1, borderTopColor: theme.text }}>
                {lines.map((l) => {
                  const t = typed[l.index];
                  const full = parseAmount(amounts[l.index] ?? '') === l.remaining && l.remaining > 0;
                  return (
                    <View key={l.index} style={{ paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: 2 }}>
                          <Txt style={{ fontSize: 15 }}>{formatLineDescription(l.description)}</Txt>
                          <Txt variant="small">
                            {l.remaining <= 0
                              ? `${aed(l.net)} net · credited in full`
                              : l.credited > 0
                                ? `${aed(l.net)} net · ${aed(l.credited)} already credited, ${aed(l.remaining)} left`
                                : `${aed(l.net)} net`}
                          </Txt>
                        </View>
                        {l.remaining > 0 ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <TextInput
                              value={amounts[l.index] ?? ''}
                              onChangeText={(v) => setAmounts((a) => ({ ...a, [l.index]: v }))}
                              keyboardType="decimal-pad"
                              placeholder="0.00"
                              placeholderTextColor={theme.textMuted}
                              accessibilityLabel="Net to credit (AED)"
                              accessibilityHint={formatLineDescription(l.description)}
                              aria-invalid={t?.error ? true : undefined}
                              style={[
                                font('sans'),
                                {
                                  width: 110,
                                  height: 44,
                                  borderWidth: 1,
                                  borderRadius: Radius.input,
                                  paddingHorizontal: 10,
                                  fontSize: 15.5,
                                  textAlign: 'right',
                                  color: theme.text,
                                  backgroundColor: theme.inputFill,
                                  borderColor: t?.error ? theme.errorBorder : theme.border,
                                  fontVariant: ['tabular-nums'],
                                },
                              ]}
                            />
                            <Chip label="Full" selected={full} onPress={() => setAmounts((a) => ({ ...a, [l.index]: l.remaining.toFixed(2) }))} />
                          </View>
                        ) : null}
                      </View>
                      {t?.error ? (
                        <Txt variant="small" color="danger" accessibilityRole="alert" style={{ fontWeight: '700' }}>
                          {t.error}
                        </Txt>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <View style={{ gap: 6 }}>
                <Toggle title="Invoice these lessons again" value={releasing} onValueChange={setRelease} disabled={!anyInFull} />
                <Txt variant="note">
                  {anyInFull
                    ? 'For correcting an invoice. Only the lessons on lines credited in full return to the family’s unbilled list and are marked re-invoiced; any other line on this note stays a credit.'
                    : 'Available when a lesson line is credited in full. A partial credit lowers the price and is not invoiced again.'}
                </Txt>
              </View>
            </View>
          ) : (
            <Field
              label="Amount to credit, including VAT (AED)"
              value={gross}
              onChangeText={setGross}
              keyboardType="decimal-pad"
              placeholder="0.00"
              hint={`Up to ${aed(remaining.gross)}. The VAT is worked out for you.`}
            />
          )}
          {preview.error && !typed.some((t) => t.error) ? <Notice tone="danger">{preview.error}</Notice> : null}

          <Field
            label="Reason"
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="For example, lesson on 16 September cancelled by the tutor."
            hint={reason.trim() ? 'Printed on the credit note.' : 'Printed on the credit note. Required.'}
          />
        </View>

        <SideCard label="Preview">
          <Ledger
            lines={[
              { label: 'Credit excluding VAT', value: aed(plan?.subtotal ?? 0) },
              { label: 'VAT', value: aed(plan?.vat ?? 0) },
              { label: 'Total credit', value: aed(plan?.total ?? 0), strong: true },
              { label: `${after.label} afterwards`, value: after.value },
            ]}
          />
          {plan?.full ? <Txt variant="small">This credits everything left on the invoice, so it will be marked as credited.</Txt> : null}
          <Txt variant="small" style={{ lineHeight: 19 }}>
            A credit note is a permanent tax record and cannot be undone. It shows in the family’s billing once issued.
          </Txt>
          <ErrorNote error={issue.error} />
          <Button
            title={plan ? `Issue credit note for ${aed(plan.total)}` : 'Issue credit note'}
            icon="receipt_long"
            disabled={!ready}
            loading={issue.isPending}
            onPress={confirmIssue}
          />
        </SideCard>
      </Split>
    </Screen>
  );
}
