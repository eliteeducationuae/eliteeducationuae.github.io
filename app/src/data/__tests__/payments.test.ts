import { invoiceTotals } from '@/domain/billing';
import { AUTOPAY_CHARGING_MESSAGE, AUTOPAY_NO_CARD_MESSAGE, paymentLabel } from '@/domain/payments';
import type { Profile } from '@/domain/types';

import { AccessError, cmd, q } from '../demo/db';
import { pay } from '../demo/payments';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 4, 12, 0);
type DB = ReturnType<typeof createSeed>;
const who = (db: DB, role: string) => db.profiles.find((p) => p.role === role)!;
const otherParent: Profile = { id: 'u-sharma', role: 'parent', fullName: 'Priya Sharma', email: 'priya@example.com', familyId: 'f-sharma' };
const family = (db: DB, id: string) => db.families.find((f) => f.id === id)!;

/** Give a family something to invoice, independent of the seeded lessons. */
function addUnbilled(db: DB, familyId: string, amount = 450) {
  db.charges.push({
    id: `chg-test-${familyId}`,
    lessonId: 'les-test',
    studentId: 's-test',
    familyId,
    description: 'IB Maths 1:1 (test)',
    amount,
    status: 'unbilled',
    date: NOW.toISOString(),
  });
}

describe('seeded card payments', () => {
  const db = createSeed(NOW);
  it('gives Fatima a saved card with autopay off, and no one else a card', () => {
    expect(family(db, 'f-mansoori')).toMatchObject({ autopay: false, savedCard: { brand: 'Visa', last4: '4242', expires: '08/29' } });
    expect(db.families.filter((f) => f.savedCard).map((f) => f.id)).toEqual(['f-mansoori']);
  });
  it('has at least three active offers and one hidden one', () => {
    const offers = db.packageOffers ?? [];
    expect(offers.filter((o) => o.active).length).toBeGreaterThanOrEqual(3);
    expect(offers.some((o) => !o.active)).toBe(true);
    for (const o of offers) if (o.serviceId) expect(db.services.some((s) => s.id === o.serviceId)).toBe(true);
  });
});

describe('package offers (mirror package_offers RLS)', () => {
  it('shows parents active offers only, in order, and admins every offer', () => {
    const db = createSeed(NOW);
    const parentView = pay.offers(db, who(db, 'parent'));
    expect(parentView.every((o) => o.active)).toBe(true);
    expect(parentView.map((o) => o.sort)).toEqual([...parentView.map((o) => o.sort)].sort((a, b) => a - b));
    expect(pay.offers(db, who(db, 'admin'))).toHaveLength(db.packageOffers!.length);
    expect(pay.offers(db, who(db, 'tutor')).every((o) => o.active)).toBe(true);
  });
  it('copes with a saved database from before offers existed', () => {
    const db = createSeed(NOW);
    delete db.packageOffers;
    expect(pay.offers(db, who(db, 'admin'))).toEqual([]);
    const saved = pay.saveOffer(db, who(db, 'admin'), { name: 'Five lessons', lessons: 5, price: 2000, active: true, sort: 1 });
    expect(db.packageOffers).toEqual([saved]);
  });
  it('lets admins create, edit and delete offers', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const created = pay.saveOffer(db, admin, { name: '  A-Level: ten lessons ', serviceId: 'svc-alevel', lessons: 10, price: 5000, active: true, sort: 5 });
    expect(created.name).toBe('A-Level: ten lessons');
    pay.saveOffer(db, admin, { ...created, active: false });
    expect(pay.offers(db, who(db, 'parent')).some((o) => o.id === created.id)).toBe(false);
    pay.deleteOffer(db, admin, created.id);
    expect(pay.offers(db, admin).some((o) => o.id === created.id)).toBe(false);
  });
  it('validates offers', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    expect(() => pay.saveOffer(db, admin, { name: '', lessons: 5, price: 100, active: true, sort: 1 })).toThrow('Give the package a name');
    expect(() => pay.saveOffer(db, admin, { name: 'X', lessons: 0, price: 100, active: true, sort: 1 })).toThrow('Choose between 1 and 200 lessons');
    expect(() => pay.saveOffer(db, admin, { name: 'X', lessons: 5, price: 0, active: true, sort: 1 })).toThrow('Enter a price above zero');
  });
  it('stops parents and tutors managing offers', () => {
    const db = createSeed(NOW);
    const offer = { name: 'Cheap', lessons: 5, price: 1, active: true, sort: 1 };
    expect(() => pay.saveOffer(db, who(db, 'parent'), offer)).toThrow(AccessError);
    expect(() => pay.saveOffer(db, who(db, 'tutor'), offer)).toThrow(AccessError);
    expect(() => pay.deleteOffer(db, who(db, 'parent'), 'offer-ib-10')).toThrow(AccessError);
    expect(db.packageOffers!.some((o) => o.id === 'offer-ib-10')).toBe(true);
  });
});

describe('setAutopay (mirror set_autopay)', () => {
  it('lets a parent switch autopay on and off for their own family', () => {
    const db = createSeed(NOW);
    pay.setAutopay(db, who(db, 'parent'), 'f-mansoori', true);
    expect(family(db, 'f-mansoori').autopay).toBe(true);
    pay.setAutopay(db, who(db, 'parent'), 'f-mansoori', false);
    expect(family(db, 'f-mansoori').autopay).toBe(false);
  });
  it('stops a parent changing another family, and tutors and students', () => {
    const db = createSeed(NOW);
    expect(() => pay.setAutopay(db, who(db, 'parent'), 'f-sharma', false)).toThrow(AccessError);
    expect(() => pay.setAutopay(db, who(db, 'tutor'), 'f-mansoori', true)).toThrow(AccessError);
    expect(() => pay.setAutopay(db, who(db, 'student'), 'f-mansoori', true)).toThrow(AccessError);
  });
  it('needs a saved card before switching on', () => {
    const db = createSeed(NOW);
    expect(() => pay.setAutopay(db, otherParent, 'f-sharma', true)).toThrow(AUTOPAY_NO_CARD_MESSAGE);
    expect(() => pay.setAutopay(db, who(db, 'admin'), 'f-sharma', true)).toThrow(AUTOPAY_NO_CARD_MESSAGE);
    pay.setAutopay(db, otherParent, 'f-sharma', false);
    expect(family(db, 'f-sharma').autopay).toBe(false);
  });
  it('lets an admin switch it on for a family with a card', () => {
    const db = createSeed(NOW);
    pay.setAutopay(db, who(db, 'admin'), 'f-mansoori', true);
    expect(family(db, 'f-mansoori').autopay).toBe(true);
  });
});

describe('buyOffer (mirror create-checkout and the webhook)', () => {
  it('creates the package, a paid invoice and a card payment', () => {
    const db = createSeed(NOW);
    const number = db.settings.nextInvoiceNumber;
    const result = pay.buyOffer(db, who(db, 'parent'), 'offer-ib-10', NOW);
    expect(result).toEqual({ paid: true });

    const pkg = db.packages[db.packages.length - 1];
    expect(pkg).toMatchObject({ familyId: 'f-mansoori', name: 'IB Maths: ten lessons', serviceId: 'svc-ib', lessonsTotal: 10, lessonsUsed: 0, price: 4050, purchasedAt: '2026-10-04' });

    const invoice = db.invoices[db.invoices.length - 1];
    expect(invoice).toMatchObject({ familyId: 'f-mansoori', status: 'paid', vatRate: db.settings.vatRate, number: `INV-${number}` });
    expect(invoice.items).toEqual([{ description: 'IB Maths: ten lessons (10 lessons)', quantity: 1, unitPrice: 4050, packageId: pkg.id }]);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]).toMatchObject({ method: 'card', amount: invoiceTotals(invoice).total });
    expect(paymentLabel(invoice.payments[0])).toBe('Card');
    expect(invoiceTotals(invoice).balance).toBe(0);
    expect(db.settings.nextInvoiceNumber).toBe(number + 1);
  });
  it('charges VAT when the business is registered', () => {
    const db = createSeed(NOW);
    db.settings.vatRate = 0.05;
    pay.buyOffer(db, who(db, 'parent'), 'offer-ib-10', NOW);
    const invoice = db.invoices[db.invoices.length - 1];
    expect(invoice.payments[0].amount).toBe(4252.5);
  });
  it('keeps the card for next time when the family had none', () => {
    const db = createSeed(NOW);
    pay.buyOffer(db, otherParent, 'offer-igcse-10', NOW);
    expect(family(db, 'f-sharma').savedCard).toEqual({ brand: 'Visa', last4: '4242', expires: '08/29' });
    expect(family(db, 'f-sharma').autopay).toBeFalsy();
  });
  it('rejects hidden offers and anyone but a parent', () => {
    const db = createSeed(NOW);
    const before = db.packages.length;
    expect(() => pay.buyOffer(db, who(db, 'parent'), 'offer-any-5', NOW)).toThrow('no longer available');
    expect(() => pay.buyOffer(db, who(db, 'parent'), 'missing', NOW)).toThrow('no longer available');
    expect(() => pay.buyOffer(db, who(db, 'admin'), 'offer-ib-10', NOW)).toThrow(AccessError);
    expect(() => pay.buyOffer(db, who(db, 'tutor'), 'offer-ib-10', NOW)).toThrow(AccessError);
    expect(() => pay.buyOffer(db, who(db, 'student'), 'offer-ib-10', NOW)).toThrow(AccessError);
    expect(db.packages).toHaveLength(before);
  });
});

describe('autopay (mirror the invoices trigger and charge-invoice)', () => {
  it('pays a new invoice for an autopay family with its saved card', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    pay.setAutopay(db, who(db, 'parent'), 'f-mansoori', true);
    addUnbilled(db, 'f-mansoori');
    const invoice = pay.autopayIfDue(db, cmd.invoiceUnbilled(db, admin, 'f-mansoori', NOW), NOW)!;
    expect(invoice.status).toBe('paid');
    expect(invoice.autopayStatus).toBe('succeeded');
    expect(invoice.payments.at(-1)).toMatchObject({ method: 'card', reference: 'Autopay' });
    expect(invoiceTotals(invoice).balance).toBe(0);
  });
  it('pays a sold package for an autopay family', () => {
    const db = createSeed(NOW);
    pay.setAutopay(db, who(db, 'admin'), 'f-mansoori', true);
    const invoice = cmd.sellPackage(db, who(db, 'admin'), { familyId: 'f-mansoori', name: 'Ten IB lessons', serviceId: 'svc-ib', lessonsTotal: 10, price: 4000 }, NOW);
    pay.autopayIfDue(db, invoice, NOW);
    expect(db.invoices.find((i) => i.id === invoice.id)).toMatchObject({ status: 'paid', autopayStatus: 'succeeded' });
  });
  it('leaves families without autopay, or without a card, to pay themselves', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    addUnbilled(db, 'f-mansoori');
    const mansoori = pay.autopayIfDue(db, cmd.invoiceUnbilled(db, admin, 'f-mansoori', NOW), NOW)!;
    expect(mansoori.status).toBe('sent');
    expect(mansoori.autopayStatus).toBeUndefined();

    family(db, 'f-sharma').autopay = true; // no card on file
    addUnbilled(db, 'f-sharma');
    const sharma = pay.autopayIfDue(db, cmd.invoiceUnbilled(db, admin, 'f-sharma', NOW), NOW)!;
    expect(sharma.status).toBe('sent');
    expect(pay.autopayIfDue(db, null, NOW)).toBeNull();
  });
  it('lets an admin charge the saved card, and skips invoices with nothing owed', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    addUnbilled(db, 'f-mansoori');
    const invoice = cmd.invoiceUnbilled(db, admin, 'f-mansoori', NOW)!;
    expect(() => pay.chargeSavedCard(db, who(db, 'parent'), invoice.id, NOW)).toThrow(AccessError);
    expect(pay.chargeSavedCard(db, admin, invoice.id, NOW)).toEqual({ status: 'skipped', error: 'Autopay is switched off for this family.' });
    pay.setAutopay(db, admin, 'f-mansoori', true);
    expect(pay.chargeSavedCard(db, admin, invoice.id, NOW)).toEqual({ status: 'succeeded' });
    expect(invoice).toMatchObject({ status: 'paid', autopayStatus: 'succeeded' });
    expect(pay.chargeSavedCard(db, admin, invoice.id, NOW).status).toBe('skipped');

    const paid = db.invoices.find((i) => i.status === 'paid' && i.familyId === 'f-sharma')!;
    expect(pay.chargeSavedCard(db, admin, paid.id, NOW).status).toBe('skipped');
  });
  it('skips charging a family with no saved card', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    addUnbilled(db, 'f-sharma');
    const invoice = cmd.invoiceUnbilled(db, admin, 'f-sharma', NOW)!;
    family(db, 'f-sharma').autopay = true;
    expect(pay.chargeSavedCard(db, admin, invoice.id, NOW)).toEqual({ status: 'skipped', error: 'This family has no saved card.' });
    expect(invoice.status).toBe('sent');
  });
});

describe('payInvoiceByCard (mirror create-checkout for an invoice)', () => {
  function sentInvoice(db: DB) {
    addUnbilled(db, 'f-mansoori');
    return cmd.invoiceUnbilled(db, who(db, 'admin'), 'f-mansoori', NOW)!;
  }
  it('pays the balance by card, shown simply as "Card"', () => {
    const db = createSeed(NOW);
    const invoice = sentInvoice(db);
    expect(pay.payInvoiceByCard(db, invoice, NOW)).toEqual({ paid: true });
    expect(invoice.status).toBe('paid');
    expect(paymentLabel(invoice.payments.at(-1)!)).toBe('Card');
  });
  it('refuses while autopay is charging, so the family is never charged twice', () => {
    const db = createSeed(NOW);
    const invoice = sentInvoice(db);
    invoice.autopayStatus = 'processing';
    expect(() => pay.payInvoiceByCard(db, invoice, NOW)).toThrow(AUTOPAY_CHARGING_MESSAGE);
    expect(invoice.payments).toHaveLength(0);
  });
  it('takes a waiting invoice out of autopay before paying, so autopay never charges it as well', () => {
    const db = createSeed(NOW);
    pay.setAutopay(db, who(db, 'admin'), 'f-mansoori', true);
    const invoice = sentInvoice(db);
    invoice.autopayStatus = 'pending';
    pay.payInvoiceByCard(db, invoice, NOW);
    expect(invoice).toMatchObject({ status: 'paid', autopayStatus: undefined });
    expect(invoice.payments).toHaveLength(1);
    // A later autopay run finds nothing to charge.
    expect(pay.chargeSavedCard(db, who(db, 'admin'), invoice.id, NOW).status).toBe('skipped');
    expect(invoice.payments).toHaveLength(1);
  });
  it('refuses an invoice with nothing to pay', () => {
    const db = createSeed(NOW);
    const invoice = sentInvoice(db);
    pay.payInvoiceByCard(db, invoice, NOW);
    expect(() => pay.payInvoiceByCard(db, invoice, NOW)).toThrow('not payable');
  });
});

describe('stripBilling (mirror family_billing RLS)', () => {
  it('shows the card and autopay to admins and the family only', () => {
    const db = createSeed(NOW);
    const forAdmin = pay.stripBilling(q.families(db, who(db, 'admin')), who(db, 'admin'));
    expect(forAdmin.find((f) => f.id === 'f-mansoori')?.savedCard).toBeDefined();

    const forParent = pay.stripBilling(q.families(db, who(db, 'parent')), who(db, 'parent'));
    expect(forParent.find((f) => f.id === 'f-mansoori')).toMatchObject({ autopay: false, savedCard: { last4: '4242' } });

    const forTutor = pay.stripBilling(q.families(db, who(db, 'tutor')), who(db, 'tutor'));
    expect(forTutor.length).toBeGreaterThan(0);
    for (const f of forTutor) {
      expect(f).not.toHaveProperty('savedCard');
      expect(f).not.toHaveProperty('autopay');
    }

    const forOther = pay.stripBilling(db.families, otherParent);
    expect(forOther.find((f) => f.id === 'f-mansoori')).not.toHaveProperty('savedCard');
  });
});

describe('saveDemoCard (card payments keep the card)', () => {
  it('keeps an existing card and adds one when missing', () => {
    const db = createSeed(NOW);
    family(db, 'f-mansoori').savedCard = { brand: 'Mastercard', last4: '4444', expires: '01/30' };
    pay.saveDemoCard(db, 'f-mansoori');
    expect(family(db, 'f-mansoori').savedCard).toEqual({ brand: 'Mastercard', last4: '4444', expires: '01/30' });
    pay.saveDemoCard(db, 'f-hughes');
    expect(family(db, 'f-hughes').savedCard?.last4).toBe('4242');
  });
});
