import { roundMoney } from './billing';
import type { AutopayStatus, Family, Invoice, PackageOffer, Payment, SavedCard, Service } from './types';

/** Card payments: saved cards, autopay and lesson top-ups. Pure helpers shared by every data source and screen. */

/** Shown when a family tries to switch on autopay before a card has been kept on file. Matches set_autopay. */
export const AUTOPAY_NO_CARD_MESSAGE =
  'Save a card first: pay an invoice or buy lessons by card and it will be kept securely for next time.';

const byOfferOrder = (a: PackageOffer, b: PackageOffer) => a.sort - b.sort || a.lessons - b.lessons;

/** Every offer in display order: by sort position, then fewest lessons first. */
export function sortOffers(offers: PackageOffer[]): PackageOffer[] {
  return [...offers].sort(byOfferOrder);
}

/** The offers parents can see, in display order. */
export function activeOffers(offers: PackageOffer[]): PackageOffer[] {
  return sortOffers(offers.filter((o) => o.active));
}

/** Price per lesson, before VAT. */
export function offerPerLesson(offer: PackageOffer): number {
  return offer.lessons > 0 ? roundMoney(offer.price / offer.lessons) : 0;
}

/** Whole percentage saved against paying the service's lesson rate, or null when there is no saving to show. */
export function offerSavingPct(offer: PackageOffer, service?: Service): number | null {
  if (!service || service.rate <= 0 || offer.lessons <= 0) return null;
  const full = service.rate * offer.lessons;
  const pct = Math.round(((full - offer.price) / full) * 100);
  return pct > 0 ? pct : null;
}

/** What the family pays, including VAT. Matches the amount Stripe Checkout charges. */
export function offerTotal(offer: PackageOffer, vatRate: number): number {
  return roundMoney(offer.price * (1 + vatRate));
}

const BRAND_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

function brandName(brand: string): string {
  const key = brand.trim().toLowerCase();
  if (!key) return 'Card';
  return BRAND_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** e.g. 'Visa ending 4242'. */
export function cardLabel(card: SavedCard): string {
  return `${brandName(card.brand)} ending ${card.last4}`;
}

/** e.g. 'Expires 08/29', or null when the expiry is not known. */
export function cardExpiryLabel(card: SavedCard): string | null {
  return card.expires ? `Expires ${card.expires}` : null;
}

/** Autopay can only be switched on once a card is kept on file. */
export function canEnableAutopay(family: Family): boolean {
  return !!family.savedCard;
}

const AUTOPAY_STATUS_TEXT: Record<AutopayStatus, string> = {
  pending: 'Autopay scheduled',
  processing: 'Charging saved card',
  succeeded: 'Paid by autopay',
  failed: 'Autopay failed',
};

export function autopayStatusText(status: AutopayStatus): string {
  return AUTOPAY_STATUS_TEXT[status];
}

/**
 * True while autopay is about to charge (pending) or is charging (processing) this invoice. The family is then not
 * offered card or bank-transfer payment, so the invoice can never be paid twice.
 */
export function autopayHoldsInvoice(invoice: Pick<Invoice, 'autopayStatus'>): boolean {
  return invoice.autopayStatus === 'pending' || invoice.autopayStatus === 'processing';
}

/** Shown when a family tries to pay an invoice while its saved card is being charged. Matches create-checkout. */
export const AUTOPAY_CHARGING_MESSAGE = 'Your saved card is being charged for this invoice. Please wait a moment and refresh.';

/**
 * The reason an autopay charge failed, ready to follow a colon mid-sentence: 'your card has expired' (no capital,
 * no full stop), as autopay_failed writes it in the family's message.
 */
export function autopayFailureReason(error?: string | null): string {
  const reason = (error ?? '').trim().replace(/\.+$/, '').trim();
  if (!reason) return 'the card was declined';
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

export const MAX_OFFER_LESSONS = 200;

/** Checks an offer before saving. Returns a message to show, or null when it is fine. */
export function validateOffer(input: { name: string; lessons: number; price: number }): string | null {
  if (!input.name.trim()) return 'Give the package a name';
  if (!Number.isInteger(input.lessons) || input.lessons < 1 || input.lessons > MAX_OFFER_LESSONS) {
    return `Choose between 1 and ${MAX_OFFER_LESSONS} lessons`;
  }
  if (!Number.isFinite(input.price) || input.price <= 0) return 'Enter a price above zero';
  return null;
}

const METHOD_LABELS: Record<Payment['method'], string> = { card: 'Card', 'bank-transfer': 'Bank transfer', cash: 'Cash' };

/**
 * How a payment is described on an invoice, e.g. 'Card · Autopay' or 'Bank transfer'. Stripe references
 * (pi_…, ch_…, cs_…) are never shown to families; other references are, unless they only repeat the method.
 */
export function paymentLabel(payment: Pick<Payment, 'method' | 'reference'>): string {
  const method = METHOD_LABELS[payment.method] ?? payment.method;
  const ref = payment.reference?.trim();
  if (!ref || /^(pi|ch|cs|py)_/.test(ref) || ref.toLowerCase() === method.toLowerCase()) return method;
  return `${method} · ${ref}`;
}
