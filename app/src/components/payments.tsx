import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction } from '@/data/hooks';
import { queryClient } from '@/data/query';
import { formatAED } from '@/domain/billing';
import {
  activeOffers,
  AUTOPAY_NO_CARD_MESSAGE,
  autopayFailureReason,
  autopayFailureReasonForOffice,
  autopayStatusText,
  canEnableAutopay,
  cardExpiryLabel,
  cardLabel,
  offerPerLesson,
  offerSavingPct,
  offerTotal,
  validateOffer,
} from '@/domain/payments';
import type { AutopayStatus, Family, Invoice, PackageOffer, Service } from '@/domain/types';
import { confirm, notify } from '@/lib/confirm';

import { Badge, Banner, Button, Card, Chip, ErrorNote, Field, Row, Section, Segmented, Txt, type Tone } from './ui';

/** Card payments on the parent and admin screens: saved card, autopay, lesson top-ups and package offers. */

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** 'ten lessons', '1 lesson' style wording: numbers up to twenty in words, as the brand's formal tone prefers. */
export function lessonsInWords(n: number): string {
  const word = NUMBER_WORDS[n] ?? String(n);
  return `${word} ${n === 1 ? 'lesson' : 'lessons'}`;
}

/** '10 lessons' / '1 lesson'. */
export function lessonsCount(n: number): string {
  return `${n} ${n === 1 ? 'lesson' : 'lessons'}`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Open a Stripe page, then refetch everything so new cards, credits and payments show straight away. */
async function openAndRefresh(url: string) {
  await WebBrowser.openBrowserAsync(url);
  await queryClient.invalidateQueries();
}

/** A parent opens their own family's cards; an admin passes the family. */
async function openBillingPortal(familyId?: string) {
  if (!source.openBillingPortal) throw new Error('Managing cards is not available here.');
  const { url } = await source.openBillingPortal(familyId);
  await openAndRefresh(url);
}

async function chargeSavedCardNow(invoiceId: string) {
  if (!source.chargeSavedCard) throw new Error('Charging a saved card is not available here.');
  return source.chargeSavedCard(invoiceId);
}

// ---------------------------------------------------------------------------
// Parent: saved card and autopay
// ---------------------------------------------------------------------------

export function SavedCardPanel({ family }: { family: Family }) {
  const portal = useAction(openBillingPortal);
  const card = family.savedCard;
  const expiry = card ? cardExpiryLabel(card) : null;
  return (
    <Card style={{ gap: Spacing.two }}>
      <Txt variant="label">Saved card</Txt>
      {card ? (
        <View style={{ gap: 2 }}>
          <Txt variant="h3">{cardLabel(card)}</Txt>
          {expiry ? <Txt variant="muted">{expiry}</Txt> : null}
        </View>
      ) : (
        <Txt variant="muted">No card saved yet.</Txt>
      )}
      {card && source.openBillingPortal ? (
        <Button
          title="Manage cards"
          icon="card"
          variant="secondary"
          size="sm"
          style={{ alignSelf: 'flex-start' }}
          loading={portal.isPending}
          onPress={() => portal.mutate([])}
        />
      ) : null}
      <ErrorNote error={portal.error} />
    </Card>
  );
}

export function AutopayPanel({ family }: { family: Family }) {
  const save = useAction(source.setAutopay);
  const on = !!family.autopay;
  const allowed = canEnableAutopay(family);

  function change(next: 'on' | 'off') {
    if ((next === 'on') === on || save.isPending) return;
    if (next === 'off') {
      save.mutate([family.id, false]);
      return;
    }
    if (!allowed || !family.savedCard) return;
    confirm(
      'Turn on autopay?',
      `New invoices will be paid automatically from your ${cardLabel(family.savedCard)}.`,
      () => save.mutate([family.id, true]),
      'Turn on',
    );
  }

  return (
    <Card style={{ gap: Spacing.two + Spacing.one }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="label">Autopay</Txt>
        <Badge label={on ? 'On' : 'Off'} tone={on ? 'success' : 'neutral'} />
      </Row>
      <Txt variant="muted">
        With autopay on, each new invoice is paid from your saved card on the day it is issued. A receipt appears in your invoices every
        time.
      </Txt>
      <Segmented
        options={[
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ]}
        value={on ? 'on' : 'off'}
        onChange={change}
        disabled={!allowed && !on}
      />
      {!allowed && !on ? <Banner icon="card">{AUTOPAY_NO_CARD_MESSAGE}</Banner> : null}
      <ErrorNote error={save.error} />
    </Card>
  );
}

/** Admin, on a family's page: the saved card and autopay, with the Stripe page for the family's cards. */
export function FamilyCardAdmin({ family }: { family: Family }) {
  const portal = useAction(openBillingPortal);
  const card = family.savedCard;
  const expiry = card ? cardExpiryLabel(card) : null;
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="label">Saved card</Txt>
        <Badge label={family.autopay ? 'Autopay on' : 'Autopay off'} tone={family.autopay ? 'success' : 'neutral'} />
      </Row>
      <Txt variant={card ? 'h3' : 'muted'}>{card ? cardLabel(card) : 'No card saved yet.'}</Txt>
      {expiry ? <Txt variant="muted">{expiry}</Txt> : null}
      {source.openBillingPortal ? (
        <Button
          title="Manage cards"
          icon="card"
          variant="secondary"
          size="sm"
          style={{ alignSelf: 'flex-start' }}
          loading={portal.isPending}
          onPress={() => portal.mutate([family.id])}
        />
      ) : null}
      <ErrorNote error={portal.error} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Parent: buy more lessons
// ---------------------------------------------------------------------------

export function OfferCard({
  offer,
  service,
  vatRate,
  onBuy,
  loading,
  disabled,
}: {
  offer: PackageOffer;
  service?: Service;
  vatRate: number;
  onBuy: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const saving = offerSavingPct(offer, service);
  return (
    <Card style={{ gap: Spacing.two }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{offer.name}</Txt>
          <Txt variant="muted">
            {lessonsCount(offer.lessons)}
            {service ? ` · ${service.name}` : ''}
          </Txt>
        </View>
        {saving ? <Badge label={`Save ${saving}%`} tone="gold" /> : null}
      </Row>
      {/* The price note wraps in its own column, so Buy always stays on the right, with or without VAT. */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }} gap={Spacing.three}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt variant="h2">{formatAED(offerTotal(offer, vatRate))}</Txt>
          <Txt variant="small">
            {vatRate > 0 ? 'including VAT · ' : ''}
            {formatAED(offerPerLesson(offer))} per lesson{vatRate > 0 ? ' before VAT' : ''}
          </Txt>
        </View>
        <Button
          title="Buy"
          icon="card"
          variant="gold"
          size="sm"
          style={{ alignSelf: 'flex-end' }}
          loading={loading}
          disabled={disabled}
          onPress={onBuy}
        />
      </Row>
    </Card>
  );
}

export function BuyLessons({ offers, services, vatRate }: { offers: PackageOffer[]; services: Service[]; vatRate: number }) {
  const buy = useAction(source.buyPackageOffer);
  const [buying, setBuying] = useState<string | null>(null);
  const shown = activeOffers(offers);
  if (!shown.length) return null;

  function start(offer: PackageOffer) {
    const total = formatAED(offerTotal(offer, vatRate));
    confirm(
      `Buy ${lessonsInWords(offer.lessons)}?`,
      `You will pay ${total} securely by card, and ${lessonsCount(offer.lessons)} will be added to your account straight away.`,
      async () => {
        setBuying(offer.id);
        try {
          const result = await buy.mutateAsync([offer.id]);
          if (result.url) {
            await openAndRefresh(result.url);
          } else if (result.paid) {
            notify('Thank you', `${capitalise(lessonsCount(offer.lessons))} ${offer.lessons === 1 ? 'has' : 'have'} been added to your account.`);
          }
        } catch {
          // Shown below by ErrorNote.
        } finally {
          setBuying(null);
        }
      },
      'Pay by card',
    );
  }

  return (
    <Section title="Buy more lessons">
      <Txt variant="muted">Prepaid lessons are used automatically, before anything is added to your next invoice.</Txt>
      <View style={{ gap: Spacing.two }}>
        {shown.map((o) => (
          <OfferCard
            key={o.id}
            offer={o}
            service={services.find((s) => s.id === o.serviceId)}
            vatRate={vatRate}
            loading={buying === o.id}
            disabled={!!buying && buying !== o.id}
            onBuy={() => start(o)}
          />
        ))}
      </View>
      <ErrorNote error={buy.error} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Admin: package offers in Services and rates
// ---------------------------------------------------------------------------

export function OfferRow({ offer, service, onPress }: { offer: PackageOffer; service?: Service; onPress?: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={offer.name}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={Spacing.three}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3">{offer.name}</Txt>
          <Txt variant="muted">
            {lessonsCount(offer.lessons)} · {service?.name ?? 'Any lesson type'}
          </Txt>
          {!offer.active ? (
            <View style={{ flexDirection: 'row', marginTop: Spacing.one }}>
              <Badge label="Hidden from parents" tone="neutral" />
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt variant="h3">{formatAED(offer.price)}</Txt>
          <Txt variant="small">{formatAED(offerPerLesson(offer))} per lesson</Txt>
        </View>
      </Row>
    </Card>
  );
}

const toNumber = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/,/g, '')));

export function OfferForm({
  existing,
  services,
  nextSort = 1,
  onDone,
}: {
  existing?: PackageOffer;
  services: Service[];
  /** Position used when the sort order is left blank on a new offer. */
  nextSort?: number;
  onDone: () => void;
}) {
  const save = useAction(source.savePackageOffer);
  const remove = useAction(source.deletePackageOffer);
  const [name, setName] = useState(existing?.name ?? '');
  const [serviceId, setServiceId] = useState<string | undefined>(existing?.serviceId);
  const [lessons, setLessons] = useState(existing ? String(existing.lessons) : '10');
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [active, setActive] = useState<'on' | 'off'>(existing && !existing.active ? 'off' : 'on');
  const [sort, setSort] = useState(existing ? String(existing.sort) : '');

  const draft: PackageOffer = {
    id: existing?.id ?? 'draft',
    name: name.trim(),
    serviceId,
    lessons: toNumber(lessons),
    price: toNumber(price),
    active: active === 'on',
    sort: sort.trim() === '' ? (existing?.sort ?? nextSort) : Math.round(toNumber(sort)),
  };
  const problem = validateOffer(draft) ?? (Number.isFinite(draft.sort) ? null : 'Enter a whole number for the sort order');
  const service = services.find((s) => s.id === serviceId);
  const saving = problem ? null : offerSavingPct(draft, service);

  return (
    <Card style={{ gap: Spacing.three }}>
      <Txt variant="h3">{existing ? 'Edit package' : 'New package'}</Txt>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. IB Maths: ten lessons" />
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Lesson type</Txt>
        <Row gap={Spacing.one} wrap>
          <Chip label="Any lesson type" selected={!serviceId} onPress={() => setServiceId(undefined)} />
          {services.map((s) => (
            <Chip key={s.id} label={s.name} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />
          ))}
        </Row>
      </View>
      <Row gap={Spacing.two}>
        <View style={{ flex: 1 }}>
          <Field label="Lessons" value={lessons} onChangeText={setLessons} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Price (AED, before VAT)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        </View>
      </Row>
      {!problem ? (
        <Txt variant="muted">
          {formatAED(offerPerLesson(draft))} per lesson
          {service ? (saving ? ` · saves ${saving}% against the ${service.name} rate of ${formatAED(service.rate)}` : ` · no saving against the ${service.name} rate of ${formatAED(service.rate)}`) : ''}
        </Txt>
      ) : null}
      <View style={{ gap: Spacing.one }}>
        <Txt variant="label">Visible to parents</Txt>
        <Segmented
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={active}
          onChange={setActive}
        />
      </View>
      <Field
        label="Sort order (optional)"
        value={sort}
        onChangeText={setSort}
        keyboardType="number-pad"
        hint="Lower numbers appear first."
      />
      {problem && name.trim() ? <Txt variant="small">{problem}</Txt> : null}
      <ErrorNote error={save.error ?? remove.error} />
      <Row gap={Spacing.two}>
        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onDone} />
        <Button
          title="Save"
          style={{ flex: 1 }}
          disabled={!!problem}
          loading={save.isPending}
          onPress={async () => {
            const { id: _draftId, ...fields } = draft;
            await save.mutateAsync([existing ? { ...fields, id: existing.id } : fields]);
            onDone();
          }}
        />
      </Row>
      {existing ? (
        <Button
          title="Delete package"
          variant="danger"
          size="sm"
          loading={remove.isPending}
          onPress={() =>
            confirm(
              'Delete this package?',
              'Parents will no longer be able to buy it. Lessons already bought, including any being paid for at this moment, are not affected.',
              async () => {
                await remove.mutateAsync([existing.id]);
                onDone();
              },
              'Delete',
            )
          }
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoices: autopay state
// ---------------------------------------------------------------------------

/**
 * Admin: while an autopay charge is under way or its outcome is unknown, recording a payment or voiding the invoice may
 * leave the family charged twice (or charged for a void invoice), so the office is asked to look at Stripe first.
 */
export const AUTOPAY_MAY_HAVE_CHARGED = "Autopay may already have charged the family's card for this invoice; check the Stripe Dashboard first.";

/** Whether an autopay charge on this invoice may already have taken the money (under way, or outcome unknown). */
export function autopayMayHaveCharged(invoice: Invoice): boolean {
  return invoice.autopayStatus === 'unknown' || invoice.autopayStatus === 'processing';
}

const AUTOPAY_TONE: Record<AutopayStatus, Tone> = {
  pending: 'info',
  processing: 'neutral',
  unknown: 'neutral',
  succeeded: 'success',
  failed: 'warning',
};

export function AutopayBadge({ invoice }: { invoice: Invoice }) {
  if (!invoice.autopayStatus) return null;
  return <Badge label={autopayStatusText(invoice.autopayStatus)} tone={AUTOPAY_TONE[invoice.autopayStatus]} />;
}

/** What a parent needs to know about an automatic charge on this invoice. */
export function AutopayNotice({ invoice, payable }: { invoice: Invoice; payable: boolean }) {
  if (!payable) return null;
  if (invoice.autopayStatus === 'failed') {
    return (
      <Banner tone="warning" icon="alert">
        {`Autopay could not take this payment: ${autopayFailureReason(invoice.autopayError)}. Please pay by card below, or update your card under Manage cards in Billing.`}
      </Banner>
    );
  }
  if (invoice.autopayStatus === 'pending') {
    return <Banner icon="card">This invoice will be paid automatically from your saved card. There is nothing you need to do.</Banner>;
  }
  if (invoice.autopayStatus === 'processing') {
    return <Banner icon="card">Your saved card is being charged for this invoice. This usually takes a few moments.</Banner>;
  }
  if (invoice.autopayStatus === 'unknown') {
    return (
      <Banner icon="card">
        We are confirming the payment from your saved card with the card processor. There is nothing you need to do, and you will not be
        charged twice; this invoice will update shortly.
      </Banner>
    );
  }
  return null;
}

/** Admin: why the last autopay charge failed, or that its outcome is not yet known, to read before charging again. */
export function AutopayFailureNote({ invoice }: { invoice: Invoice }) {
  if (invoice.autopayStatus === 'unknown') {
    return (
      <Banner tone="warning" icon="alert">
        Outcome unknown: the card processor could not be reached during the last autopay charge, so it is not yet known whether the
        family&apos;s card was charged. The app checks again automatically; please check the Stripe Dashboard before charging the card
        again, recording a payment or voiding this invoice. The family has not been asked to pay.
      </Banner>
    );
  }
  if (invoice.status !== 'sent' || invoice.autopayStatus !== 'failed') return null;
  return (
    <Banner tone="warning" icon="alert">
      {`Autopay could not take this payment: ${autopayFailureReasonForOffice(invoice.autopayError)}. The family has been asked to update their card or pay in the app.`}
    </Banner>
  );
}

/**
 * Admin: charge an autopay family's saved card now, for a sent invoice that is still owed. When the last charge's outcome
 * is unknown (or it has been processing for a while), the button only asks Stripe what happened to that charge (it resends the
 * same request only while the invoice still wants exactly that charge, and otherwise just looks the payment up), so a second
 * charge is never offered while the first may have gone through.
 */
export function ChargeSavedCardButton({ invoice, family, balance }: { invoice: Invoice; family?: Family; balance: number }) {
  const charge = useAction(chargeSavedCardNow);
  // 'processing' too: a charge left processing for over half an hour (a missed webhook) can be checked the same way.
  const check = invoice.autopayStatus === 'unknown' || invoice.autopayStatus === 'processing';
  const eligible =
    !!source.chargeSavedCard &&
    (check ||
      (!!family?.autopay && invoice.status === 'sent' && (invoice.autopayStatus === 'pending' || invoice.autopayStatus === 'failed') && balance > 0));
  if (!eligible) return null;
  const card = family?.savedCard ? cardLabel(family.savedCard) : 'the saved card';

  async function run() {
    try {
      const result = await charge.mutateAsync([invoice.id]);
      if (result.status === 'succeeded') notify('Payment taken', 'The saved card was charged and the payment has been recorded.');
      else if (result.status === 'processing') notify('Payment still processing', 'The invoice will update once the card payment clears.');
      else if (result.status === 'unknown') notify('Still unknown', 'The card processor could not be reached. The app will check again automatically.');
      else if (result.status === 'pending') notify('Not charged yet', result.error ?? 'Autopay will try again shortly.');
      else if (check && result.status === 'skipped') notify('Nothing to check yet', result.error ?? 'Please try again in a few minutes.');
      else notify(result.error ? `The card was not charged: ${result.error}` : 'The card was not charged.');
    } catch {
      // Shown below by ErrorNote.
    }
  }

  return (
    <>
      {check ? (
        <Button
          title="Check payment with Stripe"
          icon="card"
          variant="secondary"
          loading={charge.isPending}
          onPress={() =>
            confirm(
              'Check this payment with Stripe?',
              'This asks Stripe for the result of the last autopay charge and records it. It never charges the card a second time.',
              run,
              'Check now',
            )
          }
        />
      ) : (
        <Button
          title="Charge saved card now"
          icon="card"
          variant="secondary"
          loading={charge.isPending}
          onPress={() => confirm('Charge the saved card?', `${formatAED(balance)} will be taken from ${card} now.`, run, 'Charge card')}
        />
      )}
      <ErrorNote error={charge.error} />
    </>
  );
}
