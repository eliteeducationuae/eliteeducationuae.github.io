import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatAED } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { maskIban, tutorInvoiceTotal } from '@/domain/tutor-pay';
import type { PaymentDetails, Tutor, TutorInvoice } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';
import { printHtmlOnWeb } from './print-web';

/** The tutor's invoice to Elite Education, as a printable page. Only the masked IBAN is printed. */
export function tutorInvoiceHTML(inv: TutorInvoice, tutor: Tutor | undefined, bank: PaymentDetails | null, businessName: string): string {
  const rows = inv.items
    .map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${formatAED(i.unitPrice)}</td><td class="r">${formatAED(i.quantity * i.unitPrice)}</td></tr>`)
    .join('');
  const body = `${pdfHeader({ meta: 'Tutor invoice', title: inv.number, subtitle: `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}` })}
  <div class="parties">
    <div><div class="label">From</div><p>${esc(tutor?.fullName ?? '')}</p></div>
    <div><div class="label">To</div><p>${esc(businessName)}</p></div>
  </div>
  <table><tr><th>Description</th><th class="r">Hours or quantity</th><th class="r">Rate</th><th class="r">Amount</th></tr>${rows}
  <tr class="tot grand"><td colspan="3" class="r">Total</td><td class="r">${formatAED(tutorInvoiceTotal(inv.items))}</td></tr></table>
  ${inv.notes ? `<p style="margin-top:16px">${esc(inv.notes)}</p>` : ''}
  ${bank ? `<div class="panel"><div class="label">Payment details</div><p>${esc(bank.accountName)}, ${esc(bank.bankName)}, IBAN ${esc(maskIban(bank.iban))}</p></div>` : ''}`;
  return pdfDocument({ title: `Invoice ${inv.number}`, body });
}

export async function shareTutorInvoice(inv: TutorInvoice, tutor: Tutor | undefined, bank: PaymentDetails | null, businessName: string) {
  const html = tutorInvoiceHTML(inv, tutor, bank, businessName);
  if (Platform.OS === 'web') return printHtmlOnWeb(html);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
