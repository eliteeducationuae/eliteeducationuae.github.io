import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatAED, invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import type { Family, Invoice, Settings } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';
import { printHtmlOnWeb } from './print-web';

export function invoiceHTML(inv: Invoice, family: Family | undefined, settings: Settings | undefined): string {
  const t = invoiceTotals(inv);
  const rows = inv.items
    .map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${formatAED(i.unitPrice)}</td><td class="r">${formatAED(i.quantity * i.unitPrice)}</td></tr>`)
    .join('');
  const business = settings?.businessName ?? 'Elite Education';
  const body = `${pdfHeader({ meta: 'Invoice', title: inv.number, subtitle: `Issued ${formatDate(inv.issueDate)} · Due ${formatDate(inv.dueDate)}` })}
  <div class="parties">
    <div><div class="label">From</div><p>${esc(business)}</p></div>
    <div><div class="label">Billed to</div><p>${esc(family?.parentName ?? '')}${family?.email ? `<br><span class="muted">${esc(family.email)}</span>` : ''}</p></div>
  </div>
  <table><tr><th>Description</th><th class="r">Quantity</th><th class="r">Price</th><th class="r">Amount</th></tr>${rows}
  ${inv.vatRate > 0 ? `<tr class="tot"><td colspan="3" class="r">Subtotal</td><td class="r">${formatAED(t.subtotal)}</td></tr><tr class="tot"><td colspan="3" class="r">VAT ${Math.round(inv.vatRate * 100)}%</td><td class="r">${formatAED(t.vat)}</td></tr>` : ''}
  <tr class="tot grand"><td colspan="3" class="r">Total</td><td class="r">${formatAED(t.total)}</td></tr>
  ${t.paid > 0 ? `<tr class="tot"><td colspan="3" class="r">Paid</td><td class="r">${formatAED(t.paid)}</td></tr><tr class="tot"><td colspan="3" class="r">Balance due</td><td class="r">${formatAED(t.balance)}</td></tr>` : ''}
  </table>
  ${settings?.bankDetails ? `<div class="panel"><div class="label">Payment by bank transfer</div><p>${esc(settings.bankDetails)}</p><p class="muted">Please quote ${esc(inv.number)} as the payment reference.</p></div>` : ''}
  <p class="muted" style="margin-top:24px">Thank you for choosing ${esc(business)}.</p>`;
  return pdfDocument({ title: `Invoice ${inv.number}`, body });
}

export async function shareInvoice(inv: Invoice, family: Family | undefined, settings: Settings | undefined) {
  const html = invoiceHTML(inv, family, settings);
  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
