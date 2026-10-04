import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatAED } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { maskIban, tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { PaymentDetails, Tutor, TutorInvoice } from '@/domain/types';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The tutor's invoice to Elite Education, as a printable page. Only the masked IBAN is printed. */
export function tutorInvoiceHTML(inv: TutorInvoice, tutor: Tutor | undefined, bank: PaymentDetails | null, businessName: string): string {
  const rows = inv.items
    .map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${formatAED(i.unitPrice)}</td><td class="r">${formatAED(i.quantity * i.unitPrice)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a202c;margin:40px}
  h1{color:#1a365d;margin:0}.muted{color:#64748b}table{width:100%;border-collapse:collapse;margin-top:24px;font-size:13px}
  th{text-align:left;border-bottom:2px solid #1a365d;padding:6px}td{padding:6px;border-bottom:1px solid #e2e8f0}.r{text-align:right}
  .tot td{border:none;font-weight:700}</style></head><body>
  <h1>Invoice ${esc(inv.number)}</h1>
  <p class="muted">From ${esc(tutor?.fullName ?? '')} to ${esc(businessName)} · ${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}</p>
  <table><tr><th>Description</th><th class="r">Hours / qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>${rows}
  <tr class="tot"><td colspan="3" class="r">Total</td><td class="r">${formatAED(tutorInvoiceTotal(inv.items))}</td></tr></table>
  ${inv.notes ? `<p>${esc(inv.notes)}</p>` : ''}
  ${bank ? `<p class="muted">Pay to ${esc(bank.accountName)}, ${esc(bank.bankName)}, IBAN ${maskIban(bank.iban)}</p>` : ''}
  </body></html>`;
}

export async function shareTutorInvoice(inv: TutorInvoice, tutor: Tutor | undefined, bank: PaymentDetails | null, businessName: string) {
  const html = tutorInvoiceHTML(inv, tutor, bank, businessName);
  if (Platform.OS === 'web') return Print.printAsync({ html });
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
