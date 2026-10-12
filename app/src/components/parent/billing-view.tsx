import { router } from 'expo-router';

import { source } from '@/data';
import { useAction, useEnrolments } from '@/data/hooks';
import { useViewing } from '@/data/session';
import { formatAED } from '@/domain/billing';
import {
  activeOffers,
  AUTOPAY_NO_CARD_MESSAGE,
  canEnableAutopay,
  cardExpiryLabel,
  cardLabel,
  offerPerLesson,
  offerSavingPct,
  offerTotal,
} from '@/domain/payments';
import type { Family, PackageOffer, Service } from '@/domain/types';
import { confirm } from '@/lib/confirm';

import { lessonsCount, openBillingPortal } from '../payments';
import { hasCustomFamilyPrice } from '../rate-rules';
import { ErrorNote, Group, GroupRow, useToast } from '../ui';

/**
 * The saved card (kept by Stripe; changed only on Stripe's own page) and autopay. Autopay can only be turned on
 * once a card is saved, and only after a confirmation that names the card.
 */
export function CardAutopayGroup({ family }: { family: Family }) {
  const viewing = useViewing();
  const toast = useToast();
  const portal = useAction(openBillingPortal);
  const save = useAction(source.setAutopay);
  const card = family.savedCard;
  const on = !!family.autopay;
  const allowed = canEnableAutopay(family);
  const expiry = card ? cardExpiryLabel(card) : null;

  function turnOn() {
    if (!family.savedCard || save.isPending) return;
    confirm(
      'Turn on autopay?',
      `New invoices will be paid automatically from your ${cardLabel(family.savedCard)} on the day they are issued.`,
      async () => {
        await save.mutateAsync([family.id, true]);
        toast('Autopay is on. New invoices will be paid from your saved card.');
      },
      'Turn on',
    );
  }

  async function turnOff() {
    if (save.isPending) return;
    await save.mutateAsync([family.id, false]);
    toast('Autopay is off. You will pay each invoice yourself.');
  }

  return (
    <Group title="Card and autopay">
      <GroupRow
        icon="credit_card"
        title={card ? cardLabel(card) : 'No card saved'}
        note={card ? [expiry, 'Kept securely by Stripe'].filter(Boolean).join(' · ') : 'No card saved yet.'}
        action={
          card && source.openBillingPortal && !viewing
            ? { label: 'Manage cards', onPress: () => portal.mutate([]), accessibilityLabel: 'Manage cards on Stripe' }
            : undefined
        }
      />
      <GroupRow
        icon="autorenew"
        tone={on ? 'good' : 'gold'}
        title="Pay invoices automatically"
        note={
          on
            ? 'On. Each new invoice is paid from your saved card on the day it is issued, and a receipt appears in your invoices.'
            : allowed
              ? 'Off. You pay each invoice yourself.'
              : AUTOPAY_NO_CARD_MESSAGE
        }
        value={on ? 'On' : 'Off'}
        valueTone={on ? 'good' : 'muted'}
        action={
          viewing
            ? undefined
            : on
              ? { label: 'Turn off', onPress: () => void turnOff().catch(() => undefined), accessibilityLabel: 'Turn off autopay' }
              : { label: 'Turn on', onPress: turnOn, disabled: !allowed, accessibilityLabel: 'Turn on autopay' }
        }
      />
      {portal.error || save.error ? <ErrorNote error={portal.error ?? save.error} /> : null}
    </Group>
  );
}

/** Lesson packages the family can buy by card; each opens the secure payment page. */
export function BuyLessonsGroup({ offers, services, vatRate }: { offers: PackageOffer[]; services: Service[]; vatRate: number }) {
  const viewing = useViewing();
  // A family sees only its own children's subjects, with their agreed prices.
  const enrolments = useEnrolments();
  const agreedPrice = hasCustomFamilyPrice(enrolments.data ?? []);
  const shown = activeOffers(offers);
  if (!shown.length) return null;
  return (
    <Group
      title="Buy lessons in advance"
      note={
        agreedPrice
          ? 'Prepaid lessons are used automatically, before your agreed hourly price applies. Please contact us if you would like advice on the best option for your family.'
          : 'Prepaid lessons are used automatically, lesson by lesson, before anything is added to your next invoice.'
      }>
      {shown.map((o) => {
        const service = services.find((s) => s.id === o.serviceId);
        const saving = agreedPrice ? 0 : offerSavingPct(o, service);
        const total = formatAED(offerTotal(o, vatRate));
        return (
          <GroupRow
            key={o.id}
            icon="redeem"
            title={o.name}
            note={[
              `${total}${vatRate > 0 ? ' including VAT' : ''}`,
              `${formatAED(offerPerLesson(o))} per lesson${vatRate > 0 ? ' before VAT' : ''}`,
              `${lessonsCount(o.lessons)}${service ? ` of ${service.name}` : ''}`,
              saving ? `Save ${saving}%` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
            action={
              viewing
                ? undefined
                : { label: 'Buy', variant: 'primary', onPress: () => router.push({ pathname: '/secure-pay', params: { offerId: o.id } }), accessibilityLabel: `Buy ${o.name} for ${total}` }
            }
          />
        );
      })}
    </Group>
  );
}
