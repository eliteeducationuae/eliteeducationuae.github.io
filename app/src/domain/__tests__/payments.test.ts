import {
  activeOffers,
  AUTOPAY_NO_CARD_MESSAGE,
  autopayFailureReason,
  autopayHoldsInvoice,
  autopayStatusText,
  canEnableAutopay,
  cardExpiryLabel,
  cardLabel,
  offerPerLesson,
  offerSavingPct,
  offerTotal,
  paymentLabel,
  sortOffers,
  validateOffer,
} from '../payments';
import type { Family, PackageOffer, Service } from '../types';

const offer = (o: Partial<PackageOffer> & Pick<PackageOffer, 'id'>): PackageOffer => ({
  name: 'Ten lessons',
  lessons: 10,
  price: 4050,
  active: true,
  sort: 1,
  ...o,
});

const ib: Service = { id: 'svc-ib', name: 'IB Maths 1:1', durationMin: 60, rate: 450 };
const family: Family = { id: 'f1', name: 'Al Mansoori', parentName: 'Fatima', email: 'f@example.com' };

describe('offer ordering', () => {
  const offers = [
    offer({ id: 'c', sort: 2, lessons: 20 }),
    offer({ id: 'hidden', sort: 0, lessons: 5, active: false }),
    offer({ id: 'b', sort: 2, lessons: 10 }),
    offer({ id: 'a', sort: 1, lessons: 30 }),
  ];

  it('sorts every offer by position, then fewest lessons', () => {
    expect(sortOffers(offers).map((o) => o.id)).toEqual(['hidden', 'a', 'b', 'c']);
  });
  it('shows only active offers to parents, in the same order', () => {
    expect(activeOffers(offers).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not reorder the original list', () => {
    sortOffers(offers);
    expect(offers[0].id).toBe('c');
  });
});

describe('offer prices', () => {
  it('works out the price per lesson, rounded to fils', () => {
    expect(offerPerLesson(offer({ id: 'x', price: 4050, lessons: 10 }))).toBe(405);
    expect(offerPerLesson(offer({ id: 'x', price: 1000, lessons: 3 }))).toBe(333.33);
  });
  it('adds VAT to match what Stripe charges', () => {
    expect(offerTotal(offer({ id: 'x', price: 4050 }), 0)).toBe(4050);
    expect(offerTotal(offer({ id: 'x', price: 4050 }), 0.05)).toBe(4252.5);
    expect(offerTotal(offer({ id: 'x', price: 333.33 }), 0.05)).toBe(350);
  });
  it('shows the whole-percent saving against the lesson rate', () => {
    expect(offerSavingPct(offer({ id: 'x', price: 4050, lessons: 10 }), ib)).toBe(10);
    expect(offerSavingPct(offer({ id: 'x', price: 5950, lessons: 20 }), { ...ib, rate: 350 })).toBe(15);
    expect(offerSavingPct(offer({ id: 'x', price: 4000, lessons: 10 }), ib)).toBe(11);
  });
  it('shows no saving without a service, at full price or above', () => {
    expect(offerSavingPct(offer({ id: 'x' }))).toBeNull();
    expect(offerSavingPct(offer({ id: 'x', price: 4500, lessons: 10 }), ib)).toBeNull();
    expect(offerSavingPct(offer({ id: 'x', price: 5000, lessons: 10 }), ib)).toBeNull();
    expect(offerSavingPct(offer({ id: 'x' }), { ...ib, rate: 0 })).toBeNull();
  });
});

describe('saved cards and autopay', () => {
  it('labels a card by brand and last four digits', () => {
    expect(cardLabel({ brand: 'Visa', last4: '4242' })).toBe('Visa ending 4242');
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa ending 4242');
    expect(cardLabel({ brand: 'amex', last4: '0005' })).toBe('American Express ending 0005');
    expect(cardLabel({ brand: 'mastercard', last4: '4444' })).toBe('Mastercard ending 4444');
    expect(cardLabel({ brand: 'eftpos', last4: '1111' })).toBe('Eftpos ending 1111');
    expect(cardLabel({ brand: '', last4: '1111' })).toBe('Card ending 1111');
  });
  it('shows the expiry only when known', () => {
    expect(cardExpiryLabel({ brand: 'Visa', last4: '4242', expires: '08/29' })).toBe('Expires 08/29');
    expect(cardExpiryLabel({ brand: 'Visa', last4: '4242' })).toBeNull();
  });
  it('needs a saved card before autopay can be switched on', () => {
    expect(canEnableAutopay(family)).toBe(false);
    expect(canEnableAutopay({ ...family, savedCard: { brand: 'Visa', last4: '4242' } })).toBe(true);
    expect(AUTOPAY_NO_CARD_MESSAGE).toBe(
      'Save a card first: pay an invoice or buy lessons by card and it will be kept securely for next time.',
    );
  });
  it('describes each autopay state', () => {
    expect(autopayStatusText('pending')).toBe('Autopay scheduled');
    expect(autopayStatusText('processing')).toBe('Charging saved card');
    expect(autopayStatusText('succeeded')).toBe('Paid by autopay');
    expect(autopayStatusText('failed')).toBe('Autopay failed');
  });
});

describe('validateOffer', () => {
  const ok = { name: 'Ten lessons', lessons: 10, price: 4050 };
  it('accepts a sensible offer', () => {
    expect(validateOffer(ok)).toBeNull();
    expect(validateOffer({ ...ok, lessons: 1 })).toBeNull();
    expect(validateOffer({ ...ok, lessons: 200 })).toBeNull();
  });
  it('needs a name', () => {
    expect(validateOffer({ ...ok, name: '   ' })).toBe('Give the package a name');
  });
  it('needs a whole number of lessons between 1 and 200', () => {
    for (const lessons of [0, -1, 201, 2.5, NaN]) {
      expect(validateOffer({ ...ok, lessons })).toBe('Choose between 1 and 200 lessons');
    }
  });
  it('needs a price above zero', () => {
    for (const price of [0, -10, NaN, Infinity]) {
      expect(validateOffer({ ...ok, price })).toBe('Enter a price above zero');
    }
  });
});

describe('payment labels', () => {
  it('names the method and keeps a useful reference', () => {
    expect(paymentLabel({ method: 'card', reference: 'Autopay' })).toBe('Card · Autopay');
    expect(paymentLabel({ method: 'bank-transfer', reference: 'FT 20391' })).toBe('Bank transfer · FT 20391');
    expect(paymentLabel({ method: 'cash' })).toBe('Cash');
  });

  it('never shows Stripe references or repeats the method', () => {
    expect(paymentLabel({ method: 'card', reference: 'pi_3Abc123' })).toBe('Card');
    expect(paymentLabel({ method: 'card', reference: 'cs_test_a1' })).toBe('Card');
    expect(paymentLabel({ method: 'bank-transfer', reference: 'Bank transfer' })).toBe('Bank transfer');
  });
});

describe('autopay on an invoice', () => {
  it('holds the invoice while autopay is waiting or charging', () => {
    expect(autopayHoldsInvoice({ autopayStatus: 'pending' })).toBe(true);
    expect(autopayHoldsInvoice({ autopayStatus: 'processing' })).toBe(true);
    expect(autopayHoldsInvoice({ autopayStatus: 'failed' })).toBe(false);
    expect(autopayHoldsInvoice({ autopayStatus: 'succeeded' })).toBe(false);
    expect(autopayHoldsInvoice({})).toBe(false);
  });
  it('reads the failure reason mid-sentence, as the family message does', () => {
    expect(autopayFailureReason('Your card has expired.')).toBe('your card has expired');
    expect(autopayFailureReason('  The security code for your card was not accepted. ')).toBe('the security code for your card was not accepted');
    expect(autopayFailureReason('')).toBe('the card was declined');
    expect(autopayFailureReason(undefined)).toBe('the card was declined');
  });
});
