import { router } from 'expo-router';

import { useInvoices } from '@/data/hooks';
import { invoiceTotals } from '@/domain/billing';
import { autopayHoldsInvoice } from '@/domain/payments';
import type { Invoice } from '@/domain/types';
import { offerDraft } from '@/lib/pending-draft';

/** Issued invoices that still ask the family for money, oldest due first. */
export function payableInvoices(list: Invoice[] | undefined): Invoice[] {
  return (list ?? [])
    .filter((i) => i.status === 'sent' && invoiceTotals(i).balance > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** What the family owes now, and the invoices behind it. */
export function useAmountDue() {
  const invoices = useInvoices();
  const open = payableInvoices(invoices.data);
  return { invoices: open, due: open.reduce((s, i) => s + invoiceTotals(i).balance, 0), isLoading: invoices.isLoading };
}

/**
 * The Billing tab's badge: the invoices waiting for the family to pay. Invoices autopay is about to pay (or is
 * paying) need nothing from them, so they are not counted.
 */
export function useBillingBadge(): number {
  const invoices = useInvoices();
  return payableInvoices(invoices.data).filter((i) => !autopayHoldsInvoice(i)).length;
}

/** Open the family conversation, optionally with a draft already typed (nothing is sent until they press Send). */
export function openMessages(draft?: string) {
  if (draft) offerDraft(draft);
  router.navigate('/parent/messages');
}
