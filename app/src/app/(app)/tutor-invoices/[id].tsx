import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CustomBadge } from '@/components/rates';
import { periodLabel, TUTOR_INVOICE_STATUS } from '@/components/tutor-pay';
import { Actions, Button, EmptyState, ErrorNote, Field, FieldsCard, Group, GroupRow, Loading, Notice, PageHeader, Row, Screen, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useLessons, useLookup, usePaymentDetails, useSettings, useTutorInvoices } from '@/data/hooks';
import { useMe, useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import { formatDate, formatDay, relativeDay } from '@/domain/dates';
import { formatIban, maskIban, tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { TutorInvoice } from '@/domain/types';
import { confirm } from '@/lib/confirm';
import { plural } from '@/lib/id';
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
  const toast = useToast();
  const viewing = !!useViewing();
  const monthStart = new Date(`${inv.periodStart}T00:00:00`);
  const monthLessons = useLessons(monthStart, new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1));

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

  // Lessons in this month that ended but are not recorded yet, so they are not on the invoice.
  const unrecorded = (monthLessons.data ?? []).filter((l) => l.tutorId === inv.tutorId && l.status === 'scheduled' && new Date(l.end) < new Date());
  const total = editable ? draftTotal : tutorInvoiceTotal(inv.items);

  return (
    <Screen topInset>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        back
        kicker={`Invoice · ${periodLabel(inv)}`}
        title={formatAED(total)}
        sub={[`${plural(lessonLines.length, 'lesson')}`, inv.number, s.label, me.role === 'admin' ? tutor?.fullName : null].filter(Boolean).join(' · ')}
      />
      {inv.status === 'rejected' && inv.adminComment ? <Notice tone="danger" title="Changes requested">{inv.adminComment}</Notice> : null}
      {inv.status === 'approved' && inv.adminComment ? <Notice tone="info">{inv.adminComment}</Notice> : null}
      {inv.status === 'paid' ? (
        <Notice tone="good" title="Paid">
          {`${inv.paidAt ? `Paid on ${formatDate(inv.paidAt)}` : 'Paid'}${inv.paymentReference ? ` · reference ${inv.paymentReference}` : ''}.`}
        </Notice>
      ) : inv.submittedAt && inv.status === 'submitted' ? (
        <Notice tone="info" icon="schedule">{`Submitted ${relativeDay(inv.submittedAt).toLowerCase()}. The office will review it.`}</Notice>
      ) : null}
      {editable && unrecorded.length ? (
        <Notice
          tone="warn"
          title={unrecorded.length === 1 ? 'A lesson is not recorded' : `${unrecorded.length} lessons are not recorded`}
          link={isTutor ? { label: 'Record it now', onPress: () => router.push({ pathname: '/complete/[id]', params: { id: unrecorded[0].id } }) } : undefined}>
          {`${unrecorded.map((l) => `${formatDay(l.start)} with ${lookup.studentNames(l.studentIds)}`).join(', ')} ${unrecorded.length === 1 ? 'is' : 'are'} not included yet. Record ${unrecorded.length === 1 ? 'it' : 'them'}, then refresh this invoice.`}
        </Notice>
      ) : null}

      <Group
        title={`Lessons (${lessonLines.length})`}
        link={editable && !viewing ? { label: refresh.isPending ? 'Refreshing…' : 'Refresh from lessons', onPress: () => refresh.mutate([inv.tutorId, inv.periodStart]) } : undefined}
        note={lessonLines.length ? undefined : 'No taught lessons this month yet.'}>
        {lessonLines.map((i, n) => (
          <GroupRow
            key={n}
            icon="school"
            title={i.description}
            titleWeight="regular"
            note={`${plural(i.quantity, 'hour')} at ${formatAED(i.unitPrice)} per hour`}
            value={formatAED(i.quantity * i.unitPrice)}
            valueTone="text">
            {i.rateSource === 'custom' ? (
              <Row style={{ marginTop: 4 }}>
                <CustomBadge />
              </Row>
            ) : null}
          </GroupRow>
        ))}
      </Group>

      {editable && !viewing ? (
        <FieldsCard title="Extras">
          {extras.map((e, n) => (
            <View key={n} style={{ gap: 12 }}>
              <Field label="Description" value={e.description} onChangeText={(t) => setExtras((x) => x.map((y, j) => (j === n ? { ...y, description: t } : y)))} placeholder="e.g. Mock exam marking" />
              <Row gap={10} style={{ alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field label="Qty / hours" value={e.quantity} keyboardType="decimal-pad" onChangeText={(t) => setExtras((x) => x.map((y, j) => (j === n ? { ...y, quantity: t } : y)))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Rate (AED)" value={e.unitPrice} keyboardType="decimal-pad" onChangeText={(t) => setExtras((x) => x.map((y, j) => (j === n ? { ...y, unitPrice: t } : y)))} />
                </View>
                <Button title="Remove" size="sm" variant="secondary" onPress={() => setExtras((x) => x.filter((_, j) => j !== n))} />
              </Row>
            </View>
          ))}
          <Row>
            <Button title="Add an extra line" icon="add" size="sm" variant="secondary" onPress={() => setExtras((x) => [...x, { description: '', quantity: '1', unitPrice: String(tutor?.hourlyPay ?? '') }])} />
          </Row>
          <Field label="Note to Elite Education (optional)" value={notes} onChangeText={setNotes} multiline />
        </FieldsCard>
      ) : (
        <Group title="Extras" note={inv.items.some((i) => !i.lessonId) || inv.notes ? undefined : 'None'}>
          {inv.items
            .filter((i) => !i.lessonId)
            .map((i, n) => (
              <GroupRow key={n} icon="add" title={i.description} titleWeight="regular" note={`${i.quantity} × ${formatAED(i.unitPrice)}`} value={formatAED(i.quantity * i.unitPrice)} valueTone="text" />
            ))}
          {inv.notes ? <GroupRow icon="notes" title="Note" note={`“${inv.notes}”`} /> : null}
        </Group>
      )}

      <Group title="Pay to">
        {bank.data ? (
          <GroupRow
            icon="account_balance"
            title={`${bank.data.accountName} · ${bank.data.bankName}`}
            note={revealed ? formatIban(bank.data.iban) : maskIban(bank.data.iban)}
            action={me.role === 'admin' ? { label: revealed ? 'Hide' : 'Reveal', onPress: () => setRevealed(!revealed) } : undefined}
          />
        ) : (
          <GroupRow
            icon="account_balance"
            tone="warn"
            title="No bank details on file yet"
            note={isTutor ? 'Add them so that we can pay you' : undefined}
            onPress={isTutor ? () => router.push('/payment-details') : undefined}
          />
        )}
      </Group>

      {me.role === 'admin' && inv.status === 'submitted' ? (
        <FieldsCard title="Review">
          <Field label="Comment (optional)" value={comment} onChangeText={setComment} placeholder="Shown to the tutor" />
          <Actions>
            <Button title="Approve" loading={review.isPending} onPress={() => review.mutate([inv.id, true, comment])} />
            <Button title="Send back" variant="danger" loading={review.isPending} onPress={() => review.mutate([inv.id, false, comment])} />
          </Actions>
        </FieldsCard>
      ) : null}
      {me.role === 'admin' && inv.status === 'approved' ? (
        <FieldsCard title="Mark as paid">
          <Field label="Bank transfer reference (optional)" value={reference} onChangeText={setReference} />
          <Button
            title={`Mark ${formatAED(tutorInvoiceTotal(inv.items))} paid`}
            loading={pay.isPending}
            onPress={() => confirm('Mark as paid?', `${tutor?.fullName} will be notified that the payment has been sent.`, () => pay.mutate([inv.id, reference]), 'Mark paid')}
          />
        </FieldsCard>
      ) : null}
      {editable && me.role === 'admin' ? (
        <Actions>
          <Button title="Save draft" variant="secondary" loading={update.isPending} disabled={!extrasValid} onPress={saveExtras} />
        </Actions>
      ) : null}

      <ErrorNote error={update.error ?? submit.error ?? review.error ?? pay.error ?? refresh.error} />
      <Actions>
        {isTutor && editable && !viewing ? (
          <Button
            title={`Submit ${formatAED(draftTotal)}`}
            icon="send"
            disabled={!extrasValid || (lessonLines.length === 0 && extras.length === 0)}
            loading={submit.isPending || update.isPending}
            onPress={async () => {
              await saveExtras();
              await submit.mutateAsync([inv.id]);
              toast('Invoice submitted. The office will review it and let you know when it is paid.');
            }}
          />
        ) : null}
        <Button title="Download PDF" icon="download" variant="secondary" onPress={() => shareTutorInvoice(inv, tutor, bank.data ?? null, settings.data?.businessName ?? 'Elite Education')} />
      </Actions>
    </Screen>
  );
}
