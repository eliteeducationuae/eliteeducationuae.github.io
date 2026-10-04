import { invoiceTotals, newInvoiceDraft } from '@/domain/billing';
import { toDateKey } from '@/domain/dates';
import { AUTOPAY_CHARGING_MESSAGE, AUTOPAY_NO_CARD_MESSAGE, packageReceiptLine, sortOffers, validateOffer } from '@/domain/payments';
import type { Family, Invoice, LessonPackage, PackageOffer, Profile, SavedCard } from '@/domain/types';

import type { AutopayChargeResult, CardPaymentResult } from '../source';
import { AccessError, newId, requireAdmin, type DemoDB } from './db';

/**
 * Demo versions of saved cards, autopay and package top-ups. Each mirrors a database function, policy or Edge
 * Function. Saved demo databases from before this feature have no `packageOffers`, so it is always read defensively.
 */

/** The card Stripe's test mode uses; kept on file the first time a demo family pays by card. */
export const DEMO_CARD: SavedCard = { brand: 'Visa', last4: '4242', expires: '08/29' };

const offersOf = (db: DemoDB): PackageOffer[] => db.packageOffers ?? [];

function findFamily(db: DemoDB, familyId: string): Family {
  const family = db.families.find((f) => f.id === familyId);
  if (!family) throw new Error('Family not found');
  return family;
}

/** Record a card payment for whatever is still owed. Checkout payments carry no reference (production keeps only the Stripe id). */
function payBalance(invoice: Invoice, reference: string | undefined, now: Date) {
  const { balance } = invoiceTotals(invoice);
  if (balance <= 0) return;
  invoice.payments.push({
    id: newId('pay'),
    invoiceId: invoice.id,
    amount: balance,
    method: 'card',
    ...(reference ? { reference } : {}),
    paidAt: now.toISOString(),
  });
  invoice.status = 'paid';
}

export const pay = {
  /** package_offers RLS: admins see every offer, everyone else only active ones. */
  offers(db: DemoDB, viewer: Profile): PackageOffer[] {
    const all = offersOf(db);
    return sortOffers(viewer.role === 'admin' ? all : all.filter((o) => o.active));
  },

  saveOffer(db: DemoDB, viewer: Profile, offer: Omit<PackageOffer, 'id'> & { id?: string }): PackageOffer {
    requireAdmin(viewer);
    const problem = validateOffer(offer);
    if (problem) throw new Error(problem);
    const offers = offersOf(db);
    const saved: PackageOffer = { ...offer, name: offer.name.trim(), id: offer.id ?? newId('offer') };
    const index = offers.findIndex((o) => o.id === saved.id);
    if (index >= 0) offers[index] = saved;
    else offers.push(saved);
    db.packageOffers = offers;
    return saved;
  },

  deleteOffer(db: DemoDB, viewer: Profile, id: string) {
    requireAdmin(viewer);
    db.packageOffers = offersOf(db).filter((o) => o.id !== id);
  },

  /** Mirrors set_autopay: the family's own parent or an admin; switching on needs a saved card. */
  setAutopay(db: DemoDB, viewer: Profile, familyId: string, enabled: boolean) {
    if (!(viewer.role === 'admin' || (viewer.role === 'parent' && viewer.familyId === familyId))) {
      throw new AccessError('Only the family or an admin can change autopay.');
    }
    const family = findFamily(db, familyId);
    if (enabled && !family.savedCard) throw new Error(AUTOPAY_NO_CARD_MESSAGE);
    family.autopay = enabled;
    if (!enabled) {
      // Waiting and failed invoices go back to the family at once; a charge already under way is left to finish.
      for (const inv of db.invoices) {
        if (inv.familyId === familyId && (inv.autopayStatus === 'pending' || inv.autopayStatus === 'failed')) {
          inv.autopayStatus = undefined;
          inv.autopayError = undefined;
        }
      }
    }
  },

  /**
   * Mirrors create-checkout for an offer plus the webhook that follows a successful payment: the package is
   * created, invoiced and paid by card in one go, and the card is kept for next time.
   */
  buyOffer(db: DemoDB, viewer: Profile, offerId: string, now = new Date()): CardPaymentResult {
    if (viewer.role !== 'parent' || !viewer.familyId) throw new AccessError('Only a parent can buy lessons.');
    const offer = offersOf(db).find((o) => o.id === offerId);
    if (!offer || !offer.active) throw new Error('This lesson package is no longer available.');
    const familyId = viewer.familyId;
    findFamily(db, familyId);

    const created: LessonPackage = {
      id: newId('pkg'),
      familyId,
      name: offer.name,
      serviceId: offer.serviceId,
      lessonsTotal: offer.lessons,
      lessonsUsed: 0,
      price: offer.price,
      purchasedAt: toDateKey(now),
    };
    db.packages.push(created);

    const items = [{ description: packageReceiptLine(offer.name, offer.lessons), quantity: 1, unitPrice: offer.price, packageId: created.id }];
    const draft = newInvoiceDraft(familyId, items, db.settings, now);
    // A receipt is due the day it is issued, as in fulfil_package_offer.
    const invoice: Invoice = { ...draft, dueDate: draft.issueDate, id: newId('inv'), status: 'sent' };
    db.settings.nextInvoiceNumber += 1;
    db.invoices.push(invoice);
    payBalance(invoice, undefined, now);

    pay.saveDemoCard(db, familyId);
    return { paid: true };
  },

  /**
   * Mirrors create-checkout for an invoice plus the webhook: a parent (or admin) pays the balance by card. An invoice
   * autopay is charging cannot be paid; one autopay is waiting to charge is taken out of autopay first.
   */
  payInvoiceByCard(db: DemoDB, invoice: Invoice, now = new Date()): CardPaymentResult {
    const stored = db.invoices.find((i) => i.id === invoice.id);
    if (!stored) throw new Error('Invoice not found');
    if (stored.status !== 'sent') throw new Error('This invoice is not payable');
    if (stored.autopayStatus === 'processing' || stored.autopayStatus === 'unknown') throw new Error(AUTOPAY_CHARGING_MESSAGE);
    if (stored.autopayStatus === 'pending' || stored.autopayStatus === 'failed') {
      stored.autopayStatus = undefined;
      stored.autopayError = undefined;
    }
    if (invoiceTotals(stored).balance <= 0) throw new Error('Nothing left to pay');
    payBalance(stored, undefined, now);
    pay.saveDemoCard(db, stored.familyId);
    return { paid: true };
  },

  /** Checkout saves the card for future use (setup_future_usage); an existing card is kept. */
  saveDemoCard(db: DemoDB, familyId: string) {
    const family = db.families.find((f) => f.id === familyId);
    if (family && !family.savedCard) family.savedCard = { ...DEMO_CARD };
  },

  /**
   * Mirrors the autopay trigger and charge-invoice: an invoice sent to an autopay family with a saved card is
   * paid straight away with that card. Returns the (possibly updated) invoice.
   */
  autopayIfDue(db: DemoDB, invoice: Invoice | null | undefined, now = new Date()): Invoice | null {
    if (!invoice) return null;
    const stored = db.invoices.find((i) => i.id === invoice.id) ?? invoice;
    if (stored.status !== 'sent') return stored;
    const family = db.families.find((f) => f.id === stored.familyId);
    if (!family?.autopay || !family.savedCard) return stored;
    if (invoiceTotals(stored).balance <= 0) return stored;
    payBalance(stored, 'Autopay', now);
    stored.autopayStatus = 'succeeded';
    stored.autopayError = undefined;
    return stored;
  },

  /** Admin: charge a sent invoice to an autopay family's saved card now (charge-invoice). */
  chargeSavedCard(db: DemoDB, viewer: Profile, invoiceId: string, now = new Date()): AutopayChargeResult {
    requireAdmin(viewer);
    const invoice = db.invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'sent') return { status: 'skipped', error: 'This invoice is no longer awaiting payment.' };
    const family = db.families.find((f) => f.id === invoice.familyId);
    if (!family?.autopay) return { status: 'skipped', error: 'Autopay is switched off for this family.' };
    if (!family.savedCard) return { status: 'skipped', error: 'This family has no saved card.' };
    if (invoiceTotals(invoice).balance <= 0) return { status: 'skipped' };
    payBalance(invoice, 'Autopay', now);
    invoice.autopayStatus = 'succeeded';
    invoice.autopayError = undefined;
    return { status: 'succeeded' };
  },

  /** family_billing RLS: only admins and the family itself see autopay and the saved card. */
  stripBilling(families: Family[], viewer: Profile): Family[] {
    if (viewer.role === 'admin') return families;
    return families.map((f) => {
      if (viewer.role === 'parent' && viewer.familyId === f.id) return f;
      const { autopay: _autopay, savedCard: _card, ...rest } = f;
      return rest;
    });
  },
};
