import { formatAED, invoiceTotals } from '@/domain/billing';
import { creditableLines, planCreditFromGross, planCreditNote, refundableAmount, round2 } from '@/domain/tax';
import type { AccountantInvite, CreditNote, Payment, Profile, Refund } from '@/domain/types';

import type { CreditNoteInput, RefundInput } from '../source';
import {
  AccessError,
  accountantInvitesOf,
  addCreditNote,
  creditNotesOf,
  isFinanceReader,
  newId,
  publicRefund,
  refundsOf,
  releaseCharges,
  requireAdmin,
  settleInvoice,
  withTax,
  type DemoDB,
} from './db';

/**
 * Demo versions of credit notes, refunds and accountant access. Each mirrors a database function or policy in
 * 20261017000000_tax.sql. Databases saved before this feature lack the collections, so they are read defensively.
 */

/** credit_notes and refunds RLS: admins and accountants see all, a parent their own family, everyone else none. */
function canSee(viewer: Profile, familyId: string): boolean {
  return isFinanceReader(viewer) || (viewer.role === 'parent' && !!viewer.familyId && viewer.familyId === familyId);
}

type Filter = { familyId?: string; invoiceId?: string };

const matches = (row: { familyId: string; invoiceId: string }, filter: Filter) =>
  (!filter.familyId || row.familyId === filter.familyId) && (!filter.invoiceId || row.invoiceId === filter.invoiceId);

function findPayment(db: DemoDB, paymentId: string): Payment | undefined {
  for (const inv of db.invoices) {
    const p = inv.payments.find((x) => x.id === paymentId);
    if (p) return p;
  }
  return undefined;
}

const cleanEmail = (email: string) => (email ?? '').trim().toLowerCase();

function checkReason(reason: string | undefined, missing: string): string {
  const r = (reason ?? '').trim();
  if (!r) throw new Error(missing);
  if (r.length > 500) throw new Error('Please keep the reason to 500 characters or fewer.');
  return r;
}

export const tax = {
  creditNotes(db: DemoDB, viewer: Profile, filter: Filter = {}): CreditNote[] {
    return (db.creditNotes ?? [])
      .filter((n) => canSee(viewer, n.familyId) && matches(n, filter))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  },

  creditNote(db: DemoDB, viewer: Profile, id: string): CreditNote | null {
    return tax.creditNotes(db, viewer).find((n) => n.id === id) ?? null;
  },

  refunds(db: DemoDB, viewer: Profile, filter: Filter = {}): Refund[] {
    return (db.refunds ?? [])
      .filter((r) => canSee(viewer, r.familyId) && matches(r, filter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicRefund);
  },

  /** Mirrors public.issue_credit_note: admins credit all or part of a sent or paid invoice. */
  issueCreditNote(db: DemoDB, viewer: Profile, input: CreditNoteInput, now = new Date()): CreditNote {
    requireAdmin(viewer);
    const invoice = db.invoices.find((i) => i.id === input.invoiceId);
    if (!invoice) throw new Error('Invoice not found.');
    if (invoice.status === 'draft') throw new Error('Draft invoices can be edited; only issued invoices take credit notes.');
    if (invoice.status === 'void') throw new Error('This invoice has already been cancelled.');
    if (invoice.autopayStatus === 'processing' || invoice.autopayStatus === 'unknown') {
      throw new Error('Autopay is charging this invoice at the moment. Please wait for it to finish before issuing a credit note.');
    }
    const reason = checkReason(input.reason, 'Please give a reason for the credit note.');
    const notes = creditNotesOf(db).filter((n) => n.invoiceId === invoice.id);
    if (input.gross !== undefined && input.gross !== null) {
      // An amount including VAT: one line whose net and VAT add up to exactly that amount. Nothing is released.
      const plan = planCreditFromGross(invoice, notes, input.gross, `Credit: ${reason}`);
      const note = addCreditNote(db, invoice, plan, { reason, rebilled: false, now });
      settleInvoice(db, invoice, false);
      return note;
    }
    const lines = input.lines ?? [];
    const plan = planCreditNote(invoice, notes, lines);
    // Lessons on the lines this note credits in full (with earlier notes) go back to be invoiced again. The note is
    // marked rebilled only when at least one lesson is actually released.
    const released = new Set<string>();
    if (input.releaseCharges) {
      for (const line of creditableLines(invoice, notes)) {
        const chargeId = invoice.items[line.index]?.chargeId;
        const thisNote = round2(lines.filter((l) => l.invoiceLine === line.index).reduce((s, l) => s + round2(l.net), 0));
        if (chargeId && thisNote > 0 && round2(line.credited + thisNote) >= line.net
          && db.charges.some((c) => c.id === chargeId && c.invoiceId === invoice.id)) {
          released.add(chargeId);
        }
      }
    }
    const note = addCreditNote(db, invoice, plan, { reason, rebilled: released.size > 0, now });
    if (released.size > 0) releaseCharges(db, invoice.id, released);
    // Anything to release has been released, so a note that cancels the invoice keeps its other lessons billed.
    settleInvoice(db, invoice, false);
    return note;
  },

  /**
   * Mirrors refund-payment (card payments taken through Stripe) and public.record_manual_refund (bank transfer,
   * cash, or a card payment recorded by hand). The request key makes a retried refund return the first one.
   */
  refundPayment(db: DemoDB, viewer: Profile, input: RefundInput, now = new Date()): Refund {
    requireAdmin(viewer);
    const amount = round2(input.amount);
    const key = input.requestKey?.trim();
    if (!key) throw new Error('A request key is required.');
    const payment = findPayment(db, input.paymentId);
    if (!payment) throw new Error('Payment not found.');
    const invoice = db.invoices.find((i) => i.id === payment.invoiceId);
    if (!invoice) throw new Error('Invoice not found.');

    // The same request again (a retry) returns what it made the first time.
    const earlier = refundsOf(db).find((r) => r.requestKey === key);
    if (earlier) {
      if (earlier.paymentId === input.paymentId && earlier.amount === amount) return publicRefund(earlier);
      throw new Error('This refund request was already used for a different amount.');
    }

    const reason = checkReason(input.reason, 'Please give a reason for the refund.');
    if (!(amount > 0)) throw new Error('Enter an amount to refund.');
    const left = refundableAmount(payment, refundsOf(db));
    if (amount > left) throw new Error(`Only ${formatAED(left)} of this payment can still be refunded.`);

    // Refunding a settled invoice beyond what was overpaid lowers the price, so it needs a credit note with it.
    const statusBefore = invoice.status;
    const before = invoiceTotals(withTax(db, invoice)).balance;
    const plan = input.withCreditNote
      ? planCreditFromGross(invoice, creditNotesOf(db).filter((n) => n.invoiceId === invoice.id), amount, `Refund: ${reason}`)
      : undefined;
    if ((statusBefore === 'paid' || statusBefore === 'void') && round2(before - (plan?.total ?? 0) + amount) > 0.005) {
      throw new Error(
        `Issue a credit note with this refund, or refund no more than the ${formatAED(Math.max(0, -before))} the family has overpaid.`,
      );
    }
    const creditNoteId = plan ? addCreditNote(db, invoice, plan, { reason, rebilled: false, now }).id : undefined;

    const byCard = payment.method === 'card' && !!payment.viaStripe;
    if (input.method !== undefined && (byCard || (input.method !== 'bank-transfer' && input.method !== 'cash'))) {
      throw new Error('Choose bank transfer or cash for a refund recorded by hand.');
    }
    const refund = {
      id: newId('ref'),
      invoiceId: invoice.id,
      familyId: invoice.familyId,
      paymentId: payment.id,
      amount,
      method: byCard ? payment.method : (input.method ?? payment.method),
      // The demo has no card processor: card refunds complete at once, as Stripe usually does.
      status: 'succeeded' as const,
      reason,
      ...(!byCard && input.reference?.trim() ? { reference: input.reference.trim() } : {}),
      ...(creditNoteId ? { creditNoteId } : {}),
      createdAt: now.toISOString(),
      settledAt: now.toISOString(),
      requestKey: key,
    };
    refundsOf(db).push(refund);
    settleInvoice(db, invoice, false);
    return publicRefund(refund);
  },

  /** Admin: accountant invites, newest first. */
  accountants(db: DemoDB, viewer: Profile): AccountantInvite[] {
    requireAdmin(viewer);
    return [...(db.accountantInvites ?? [])].sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
  },

  /** Mirrors public.invite_accountant: an existing accountant login is linked at once; any other login is refused. */
  inviteAccountant(db: DemoDB, viewer: Profile, email: string, fullName?: string, now = new Date()): 'invited' | 'linked' {
    requireAdmin(viewer);
    const e = cleanEmail(email);
    if (!e || !e.includes('@')) throw new Error('Please enter the accountant’s email address.');
    const name = fullName?.trim() || undefined;
    const profile = db.profiles.find((p) => p.email.toLowerCase() === e);
    if (profile && profile.role !== 'accountant') {
      const as = profile.role === 'admin' ? 'an administrator' : `a ${profile.role}`;
      throw new Error(`This email address already signs in as ${as}. Please use a different address for the accountant.`);
    }
    if (!profile && (db.tutors.some((t) => t.email.toLowerCase() === e) || db.families.some((f) => f.email.toLowerCase() === e))) {
      throw new Error('This email address belongs to a tutor or a family. Please use a different address for the accountant.');
    }
    const invites = accountantInvitesOf(db);
    let invite = invites.find((i) => i.email === e);
    if (!invite) {
      invite = { email: e, invitedAt: now.toISOString() };
      invites.push(invite);
    } else {
      invite.invitedAt = now.toISOString();
    }
    if (name) invite.fullName = name;
    if (profile) {
      invite.acceptedAt ??= now.toISOString();
      return 'linked';
    }
    return 'invited';
  },

  /** Mirrors public.remove_accountant: the invite goes and an accountant login with that email loses access. */
  removeAccountant(db: DemoDB, viewer: Profile, email: string) {
    requireAdmin(viewer);
    const e = cleanEmail(email);
    db.accountantInvites = accountantInvitesOf(db).filter((i) => i.email !== e);
    db.profiles = db.profiles.filter((p) => !(p.role === 'accountant' && p.email.toLowerCase() === e));
  },

  /** Accountants have read-only access: every write is refused (each command also checks its own rules). */
  requireWriter(viewer: Profile) {
    if (viewer.role === 'accountant') throw new AccessError('Accountants have read-only access.');
  },
};
