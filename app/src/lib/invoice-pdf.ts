import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { invoiceTotals } from '@/domain/billing';
import { formatDate } from '@/domain/dates';
import { invoiceCustomer, invoiceDocumentTitle, invoiceLineTaxes, invoiceSupplier, round2 } from '@/domain/tax';
import type { Family, Invoice, Settings, TaxParty } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';
import { printHtmlOnWeb } from './print-web';

/** Extra styles shared by tax documents: party blocks, key dates and a right-aligned totals block. */
export const TAX_DOC_CSS = `
  .parties > div { flex: 1; }
  .dates { display: flex; flex-wrap: wrap; gap: 8px 32px; margin: 16px 0 4px; }
  .dates p { margin: 2px 0 0; }
  table.lines td, table.lines th { padding: 7px 5px; }
  table.totals { width: 60%; margin-left: 40%; }
  .footer-note { margin-top: 20px; font-size: 12px; }
`;

/** An amount in AED to the fils, as tax documents print it: 'AED 1,050.00'. */
export function aed(n: number): string {
  const v = round2(n);
  const fixed = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? '−' : ''}AED ${fixed}`;
}

/** A VAT rate as printed, e.g. 0.05 -> '5%'. */
export function pct(rate: number): string {
  return `${round2(rate * 100)}%`;
}

/** Escaped text with its line breaks kept (addresses and footers). */
export function escLines(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

/** A supplier or customer block for a tax document. */
export function partyHTML(label: string, party: TaxParty | undefined): string {
  if (!party) return `<div><div class="label">${esc(label)}</div></div>`;
  return `<div><div class="label">${esc(label)}</div><p><b>${esc(party.name)}</b>${party.address ? `<br>${escLines(party.address)}` : ''}${
    party.trn ? `<br>TRN ${esc(party.trn)}` : ''
  }${party.email ? `<br><span class="muted">${esc(party.email)}</span>` : ''}</p></div>`;
}

/** One row of a totals table. */
export function totalRow(label: string, value: string, grand = false): string {
  return `<tr class="tot${grand ? ' grand' : ''}"><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
}

/**
 * The family's invoice as a printable page. Once the business has a TRN it is a UAE tax invoice: supplier and
 * customer with TRNs, date of supply, and net, VAT rate, VAT and gross on every line.
 */
export function invoiceHTML(inv: Invoice, family: Family | undefined, settings: Settings | undefined): string {
  const t = invoiceTotals(inv);
  const title = invoiceDocumentTitle(inv, settings);
  const supplier = invoiceSupplier(inv, settings) ?? { name: 'Elite Education' };
  const customer = invoiceCustomer(inv, family);
  const rows = invoiceLineTaxes(inv)
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${aed(l.unitPrice)}</td><td class="r">${aed(
          l.net,
        )}</td><td class="r">${pct(l.vatRate)}</td><td class="r">${aed(l.vat)}</td><td class="r">${aed(l.gross)}</td></tr>`,
    )
    .join('');
  const totals = [
    totalRow('Total excluding VAT', aed(t.subtotal)),
    totalRow(`VAT at ${pct(inv.vatRate)}`, aed(t.vat)),
    totalRow('Total including VAT (AED)', aed(t.total), true),
  ];
  if (t.credited > 0) totals.push(totalRow('Credited', `−${aed(t.credited)}`));
  if (t.paid > 0) totals.push(totalRow('Paid', `−${aed(t.paid)}`));
  if (t.refunded > 0) totals.push(totalRow('Refunded', aed(t.refunded)));
  if (t.credited > 0 || t.paid > 0 || t.refunded > 0) {
    totals.push(t.balance < 0 ? totalRow('In credit, to be refunded', aed(-t.balance), true) : totalRow('Balance due', aed(t.balance), true));
  }
  const business = settings?.businessName ?? 'Elite Education';
  const body = `${pdfHeader({ meta: title, title: inv.number, subtitle: `Issued ${formatDate(inv.issueDate)} · Due ${formatDate(inv.dueDate)}` })}
  <div class="parties">
    ${partyHTML('Supplier', supplier)}
    ${partyHTML('Customer', customer)}
  </div>
  <div class="dates">
    <div><div class="label">${esc(title)} number</div><p>${esc(inv.number)}</p></div>
    <div><div class="label">Date of issue</div><p>${formatDate(inv.issueDate)}</p></div>
    <div><div class="label">Date of supply</div><p>${formatDate(inv.supplyDate ?? inv.issueDate)}</p></div>
    <div><div class="label">Due date</div><p>${formatDate(inv.dueDate)}</p></div>
  </div>
  <table class="lines"><tr><th>Description</th><th class="r">Quantity</th><th class="r">Unit price</th><th class="r">Net</th><th class="r">VAT rate</th><th class="r">VAT</th><th class="r">Gross</th></tr>${rows}</table>
  <table class="totals">${totals.join('')}</table>
  ${settings?.bankDetails ? `<div class="panel"><div class="label">Payment by bank transfer</div><p>${esc(settings.bankDetails)}</p><p class="muted">Please quote ${esc(inv.number)} as the payment reference.</p></div>` : ''}
  ${settings?.invoiceFooter ? `<p class="footer-note muted">${escLines(settings.invoiceFooter)}</p>` : ''}
  <p class="muted" style="margin-top:24px">Thank you for choosing ${esc(business)}.</p>`;
  return pdfDocument({ title: `${title} ${inv.number}`, body, extraCss: TAX_DOC_CSS });
}

/** Print on web, or make a PDF and open the share sheet on phones. */
export async function shareHtmlAsPdf(html: string) {
  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

export async function shareInvoice(inv: Invoice, family: Family | undefined, settings: Settings | undefined) {
  await shareHtmlAsPdf(invoiceHTML(inv, family, settings));
}
