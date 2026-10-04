import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatAED, invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import type { Family, Invoice, Settings } from '@/domain/types';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function invoiceHTML(inv: Invoice, family: Family | undefined, settings: Settings | undefined): string {
  const t = invoiceTotals(inv);
  const rows = inv.items
    .map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${formatAED(i.unitPrice)}</td><td class="r">${formatAED(i.quantity * i.unitPrice)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a202c;margin:40px}
  h1{color:#1a365d;margin:0}.gold{color:#d69e2e;font-weight:700}.muted{color:#64748b}
  table{width:100%;border-collapse:collapse;margin-top:24px;font-size:13px}th{text-align:left;border-bottom:2px solid #1a365d;padding:6px}
  td{padding:6px;border-bottom:1px solid #e2e8f0}.r{text-align:right}.tot td{border:none;font-weight:700}
  </style></head><body>
  <div class="gold">${esc(settings?.businessName ?? 'Elite Education')}</div>
  <h1>Invoice ${esc(inv.number)}</h1>
  <p class="muted">Issued ${formatDate(inv.issueDate)} · Due ${formatDate(inv.dueDate)}</p>
  <p><b>Bill to:</b> ${esc(family?.parentName ?? '')}<br>${esc(family?.email ?? '')}</p>
  <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>${rows}
  ${inv.vatRate > 0 ? `<tr class="tot"><td colspan="3" class="r">Subtotal</td><td class="r">${formatAED(t.subtotal)}</td></tr><tr class="tot"><td colspan="3" class="r">VAT ${Math.round(inv.vatRate * 100)}%</td><td class="r">${formatAED(t.vat)}</td></tr>` : ''}
  <tr class="tot"><td colspan="3" class="r">Total</td><td class="r">${formatAED(t.total)}</td></tr>
  ${t.paid > 0 ? `<tr class="tot"><td colspan="3" class="r">Paid</td><td class="r">${formatAED(t.paid)}</td></tr><tr class="tot"><td colspan="3" class="r">Balance due</td><td class="r">${formatAED(t.balance)}</td></tr>` : ''}
  </table>
  ${settings?.bankDetails ? `<p class="muted" style="margin-top:32px">Bank transfer: ${esc(settings.bankDetails)}. Please quote ${esc(inv.number)}.</p>` : ''}
  </body></html>`;
}

export async function shareInvoice(inv: Invoice, family: Family | undefined, settings: Settings | undefined) {
  const html = invoiceHTML(inv, family, settings);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
