import { invoiceTotals } from '@/domain/billing';
import { formatDate, formatLineDescription } from '@/domain/dates';
import { creditNoteDocumentTitle, invoiceCustomer, invoiceDocumentTitle, invoiceSupplier, round2 } from '@/domain/tax';
import type { CreditNote, Family, Invoice, Settings } from '@/domain/types';

import { TAX_DOC_CSS, aed, escLines, partyHTML, pct, shareHtmlAsPdf, totalRow } from './invoice-pdf';
import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';

/**
 * A credit note against a tax invoice as a printable page: supplier and customer with TRNs, the original invoice,
 * the reason and the credited lines. It carries no bank details.
 */
export function creditNoteHTML(note: CreditNote, invoice: Invoice | undefined, family: Family | undefined, settings: Settings | undefined): string {
  const title = creditNoteDocumentTitle(note, settings);
  const supplier = note.supplier ?? (invoice ? invoiceSupplier(invoice, settings) : invoiceSupplier({}, settings)) ?? { name: 'Elite Education' };
  const customer = note.customer ?? (invoice ? invoiceCustomer(invoice, family) : invoiceCustomer({}, family));
  const rows = note.lines
    .map(
      (l) =>
        `<tr><td>${esc(formatLineDescription(l.description))}</td><td class="r">${aed(l.net)}</td><td class="r">${pct(note.vatRate)}</td><td class="r">${aed(
          l.vat,
        )}</td><td class="r">${aed(round2(l.net + l.vat))}</td></tr>`,
    )
    .join('');
  const invoiceTitle = invoice ? invoiceDocumentTitle(invoice, settings).toLowerCase() : 'tax invoice';
  const original = invoice
    ? `<p>Against ${esc(invoiceTitle)} <b>${esc(note.invoiceNumber)}</b> dated ${formatDate(invoice.issueDate)}, total ${aed(invoiceTotals(invoice).total)} including VAT.</p>`
    : `<p>Against ${esc(invoiceTitle)} <b>${esc(note.invoiceNumber)}</b>.</p>`;
  const body = `${pdfHeader({ meta: title, title: note.number, subtitle: `Issued ${formatDate(note.issueDate)}` })}
  <div class="parties">
    ${partyHTML('Supplier', supplier)}
    ${partyHTML('Customer', customer)}
  </div>
  <div class="dates">
    <div><div class="label">${esc(title)} number</div><p>${esc(note.number)}</p></div>
    <div><div class="label">Date of issue</div><p>${formatDate(note.issueDate)}</p></div>
    <div><div class="label">Original invoice</div><p>${esc(note.invoiceNumber)}${invoice ? `, ${formatDate(invoice.issueDate)}` : ''}</p></div>
  </div>
  <h2>Reason for credit</h2>
  <p>${escLines(note.reason)}</p>
  ${original}
  <table class="lines"><tr><th>Description</th><th class="r">Net</th><th class="r">VAT rate</th><th class="r">VAT</th><th class="r">Gross</th></tr>${rows}</table>
  <table class="totals">
    ${totalRow('Credit excluding VAT', aed(note.subtotal))}
    ${totalRow(`VAT at ${pct(note.vatRate)}`, aed(note.vat))}
    ${totalRow('Total credit including VAT (AED)', aed(note.total), true)}
  </table>
  ${settings?.invoiceFooter ? `<p class="footer-note muted">${escLines(settings.invoiceFooter)}</p>` : ''}`;
  return pdfDocument({ title: `${title} ${note.number}`, body, extraCss: TAX_DOC_CSS });
}

export async function shareCreditNote(note: CreditNote, invoice: Invoice | undefined, family: Family | undefined, settings: Settings | undefined) {
  await shareHtmlAsPdf(creditNoteHTML(note, invoice, family, settings));
}
