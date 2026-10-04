import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { periodLabel, TUTOR_INVOICE_STATUS } from '@/components/tutor-pay';
import { Badge, Banner, Button, Card, EmptyState, ErrorNote, Field, Loading, Row, Screen, Section, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useLookup, usePaymentDetails, useSettings, useTutorInvoices } from '@/data/hooks';
import { useMe } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatDate, relativeDay } from '@/domain/dates';
import { formatIban, maskIban, tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { TutorInvoice } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { shareTutorInvoice } from '@/lib/tutor-invoice-pdf';

export default function TutorInvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoices = useTutorInvoices();
  if (invoices.isLoading) return <Loading />;
  const inv = invoices.data?.find((i) => i.id === id);
  if (!inv) return <Screen><EmptyState title="Invoice not found" /></Screen>;
  return <Detail key={`${inv.id}-${inv.status}-${inv.items.length}`} inv={inv} />;
}

type Extra = { description: string; quantity: string; unitPrice: string };

function Detail({ inv }: { inv: TutorInvoice }) {
  const theme = useTheme();
  const me = useMe();
  const lookup = useLookup();
  const settings = useSettings();
  const bank = usePaymentDetails(inv.tutorId);
  const update = useAction(source.updateTutorInvoice);
  const refresh = useAction(source.createTutorInvoice);
  const submit = useAction(source.submitTutorInvoice);
  const review = useAction(source.reviewTutorInvoice);
  const pay = useAction(source.markTutorInvoicePaid);
  const [extras, setExtras] = useState<Extra[]>(
    inv.items.filter((i) => !i.lessonId).map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) })),
  );
  const [notes, setNotes] = useState(inv.notes ?? '');
  const [comment, setComment] = useState('');
  const [reference, setReference] = useState('');
  const [revealed, setRevealed] = useState(false);

  const isTutor = me.tutorId === inv.tutorId && me.role === 'tutor';
  const editable = (inv.status === 'draft' || inv.status === 'rejected') && (isTutor || me.role === 'admin');
  const tutor = lookup.tutor(inv.tutorId);
  const s = TUTOR_INVOICE_STATUS[inv.status];
  const lessonLines = inv.items.filter((i) => i.lessonId);
  const extrasValid = extras.every((e) => e.description.trim() && Number(e.quantity) > 0 && Number(e.unitPrice) >= 0);
  const draftTotal =
    tutorInvoiceTotal(lessonLines) + extras.reduce((n, e) => n + (Number(e.quantity) || 0) * (Number(e.unitPrice) || 0), 0);

  const saveExtras = () =>
    update.mutateAsync([inv.id, extras.map((e) => ({ description: e.description, quantity: Number(e.quantity), unitPrice: Number(e.unitPrice) })), notes]);

  return (
    <Screen
      footer={
        isTutor && editable ? (
          <Button
            title={`Submit ${formatAED(draftTotal)}`}
            variant="gold"
            style={{ flex: 1 }}
            disabled={!extrasValid || (lessonLines.length === 0 && extras.length === 0)}
            loading={submit.isPending || update.isPending}
            onPress={async () => {
              await saveExtras();
              await submit.mutateAsync([inv.id]);
            }}
          />
        ) : undefined
      }>
      <Stack.Screen options={{ title: inv.number }} />
      <Card style={{ gap: Spacing.two }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h2">{formatAED(editable ? draftTotal : tutorInvoiceTotal(inv.items))}</Txt>
            <Txt variant="muted">
              {tutor?.fullName} · {periodLabel(inv)}
            </Txt>
          </View>
          <Badge label={s.label} tone={s.tone} />
        </Row>
        {inv.submittedAt ? <Txt variant="small">Submitted {relativeDay(inv.submittedAt).toLowerCase()}</Txt> : null}
        {inv.paidAt ? <Txt variant="small">Paid {formatDate(inv.paidAt)}{inv.paymentReference ? ` · ref ${inv.paymentReference}` : ''}</Txt> : null}
      </Card>
      {inv.status === 'rejected' && inv.adminComment ? <Banner tone="danger" icon="alert">Changes requested: {inv.adminComment}</Banner> : null}
      {inv.status === 'approved' && inv.adminComment ? <Banner tone="info">{inv.adminComment}</Banner> : null}

      <Section
        title={`Lessons (${lessonLines.length})`}
        action={editable ? <Button title="Refresh from lessons" size="sm" variant="ghost" loading={refresh.isPending} onPress={() => refresh.mutate([inv.tutorId, inv.periodStart])} /> : undefined}>
        <Card style={{ gap: Spacing.one }}>
          {lessonLines.length === 0 ? <Txt variant="muted">No taught lessons this month yet.</Txt> : null}
          {lessonLines.map((i, n) => (
            <Row key={n} style={{ justifyContent: 'space-between' }} gap={Spacing.two}>
              <Txt style={{ flex: 1 }}>{i.description}</Txt>
              <Txt variant="muted">{i.quantity}h</Txt>
              <Txt style={{ width: 90, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{formatAED(i.quantity * i.unitPrice)}</Txt>
            </Row>
          ))}
        </Card>
      </Section>

      <Section title="Extras">
        {editable ? (
          <>
            {extras.map((e, n) => (
              <Card key={n} style={{ gap: Spacing.two }}>
                <Field label="Description" value={e.description} onChangeText={(t) => setExtras((x) => x.map((y, j) => (j === n ? { ...y, description: t } : y)))} placeholder="e.g. Mock exam marking" />
                <Row gap={Spacing.two}>
                  <View style={{ flex: 1 }}>
                    <Field label="Qty / hours" value={e.quantity} keyboardType="decimal-pad" onChangeText={(t) => setExtras((x) => x.map((y, j) => (j === n ? { ...y, quantity: t } : y)))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Rate (AED)" value={e.unitPrice} keyboardType="decimal-pad" onChangeText={(t) => setExtras((x) => x.map((y, j) => (j === n ? { ...y, unitPrice: t } : y)))} />
                  </View>
                  <Button title="Remove" size="sm" variant="danger" style={{ marginTop: 18 }} onPress={() => setExtras((x) => x.filter((_, j) => j !== n))} />
                </Row>
              </Card>
            ))}
            <Button title="Add an extra line" icon="plus" size="sm" variant="secondary" onPress={() => setExtras((x) => [...x, { description: '', quantity: '1', unitPrice: String(tutor?.hourlyPay ?? '') }])} />
            <Field label="Note to Elite Education (optional)" value={notes} onChangeText={setNotes} multiline />
            {!isTutor ? <Button title="Save draft" variant="secondary" loading={update.isPending} disabled={!extrasValid} onPress={saveExtras} /> : null}
          </>
        ) : (
          <Card style={{ gap: Spacing.one }}>
            {inv.items.filter((i) => !i.lessonId).length === 0 ? <Txt variant="muted">None</Txt> : null}
            {inv.items
              .filter((i) => !i.lessonId)
              .map((i, n) => (
                <Row key={n} style={{ justifyContent: 'space-between' }}>
                  <Txt style={{ flex: 1 }}>
                    {i.description} ({i.quantity} × {formatAED(i.unitPrice)})
                  </Txt>
                  <Txt>{formatAED(i.quantity * i.unitPrice)}</Txt>
                </Row>
              ))}
            {inv.notes ? <Txt variant="muted">“{inv.notes}”</Txt> : null}
          </Card>
        )}
      </Section>

      <Card style={{ gap: Spacing.two }}>
        <Txt variant="label">Pay to</Txt>
        {bank.data ? (
          <>
            <Txt>
              {bank.data.accountName} · {bank.data.bankName}
            </Txt>
            <Row gap={Spacing.two}>
              <Txt style={{ flex: 1, fontVariant: ['tabular-nums'] }} selectable={revealed}>
                {revealed ? formatIban(bank.data.iban) : maskIban(bank.data.iban)}
              </Txt>
              {me.role === 'admin' ? <Button title={revealed ? 'Hide' : 'Reveal'} size="sm" variant="ghost" onPress={() => setRevealed(!revealed)} /> : null}
            </Row>
          </>
        ) : (
          <Txt variant="muted" style={{ color: theme.warning }}>
            No bank details on file yet.
          </Txt>
        )}
      </Card>

      {me.role === 'admin' && inv.status === 'submitted' ? (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="h3">Review</Txt>
          <Field label="Comment (optional)" value={comment} onChangeText={setComment} placeholder="Shown to the tutor" />
          <Row gap={Spacing.two}>
            <Button title="Send back" variant="danger" style={{ flex: 1 }} loading={review.isPending} onPress={() => review.mutate([inv.id, false, comment])} />
            <Button title="Approve" style={{ flex: 1 }} loading={review.isPending} onPress={() => review.mutate([inv.id, true, comment])} />
          </Row>
        </Card>
      ) : null}
      {me.role === 'admin' && inv.status === 'approved' ? (
        <Card style={{ gap: Spacing.three }}>
          <Txt variant="h3">Mark as paid</Txt>
          <Field label="Bank transfer reference (optional)" value={reference} onChangeText={setReference} />
          <Button
            title={`Mark ${formatAED(tutorInvoiceTotal(inv.items))} paid`}
            variant="gold"
            loading={pay.isPending}
            onPress={() => confirm('Mark as paid?', `${tutor?.fullName} will be told the payment has been sent.`, () => pay.mutate([inv.id, reference]), 'Mark paid')}
          />
        </Card>
      ) : null}

      <Button title="Download PDF" icon="share" variant="secondary" onPress={() => shareTutorInvoice(inv, tutor, bank.data ?? null, settings.data?.businessName ?? 'Elite Education')} />
      <ErrorNote error={update.error ?? submit.error ?? review.error ?? pay.error ?? refresh.error} />
    </Screen>
  );
}
