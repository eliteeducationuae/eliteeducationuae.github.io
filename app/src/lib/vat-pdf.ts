import { formatDate } from '@/domain/dates';
import type { Settings, VatSummary, VatSummaryRow } from '@/domain/types';

import { plural } from './id';
import { TAX_DOC_CSS, aed, escLines, pct, shareHtmlAsPdf, totalRow } from './invoice-pdf';
import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';

const KIND: Record<VatSummaryRow['kind'], string> = { invoice: 'Tax invoice', 'credit-note': 'Credit note', expense: 'Expense' };

/** Net VAT payable as words, e.g. 'Net VAT payable' or 'VAT reclaimable' when negative. */
export function netVatLabel(summary: Pick<VatSummary, 'netVatPayable'>): string {
  return summary.netVatPayable < 0 ? 'VAT reclaimable' : 'Net VAT payable';
}

/** A quarter's VAT summary as a printable page, for the accountant and the FTA return. */
export function vatSummaryHTML(summary: VatSummary, settings: Settings | undefined): string {
  const q = summary.quarter;
  const name = settings?.legalName || settings?.businessName || 'Elite Education';
  const rows = summary.rows
    .map(
      (r) =>
        `<tr><td>${formatDate(r.date)}</td><td>${KIND[r.kind]}</td><td>${esc(r.reference)}</td><td>${esc(r.party ?? '')}</td><td class="r">${aed(
          r.net,
        )}</td><td class="r">${r.vatRate === undefined ? '' : pct(r.vatRate)}</td><td class="r">${aed(r.vat)}</td><td class="r">${aed(r.gross)}</td></tr>`,
    )
    .join('');
  const body = `${pdfHeader({ meta: 'VAT return summary', title: q.label, subtitle: `${formatDate(q.start)} – ${formatDate(q.end)}` })}
  <div class="parties">
    <div><div class="label">Taxable person</div><p><b>${esc(name)}</b>${settings?.registeredAddress ? `<br>${escLines(settings.registeredAddress)}` : ''}${
      settings?.trn ? `<br>TRN ${esc(settings.trn)}` : '<br><span class="muted">No TRN recorded</span>'
    }</p></div>
    <div><div class="label">Tax period</div><p>${esc(q.label)}<br>${formatDate(q.start)} to ${formatDate(q.end)}</p></div>
  </div>
  <h2>Summary</h2>
  <table class="totals" style="width:100%;margin-left:0">
    ${totalRow(`Standard-rated supplies (${plural(summary.invoiceCount, 'tax invoice')}), net`, aed(summary.standardRatedNet))}
    ${summary.standardRatedCreditsNet > 0 ? totalRow('Less credit notes, net', `−${aed(summary.standardRatedCreditsNet)}`) : ''}
    ${totalRow('Zero-rated supplies, net', aed(summary.zeroRatedNet))}
    ${summary.outOfScopeNet > 0 ? totalRow('Outside the scope of VAT (issued before registration), net', aed(summary.outOfScopeNet)) : ''}
    ${totalRow('Output VAT', aed(summary.outputVat))}
    ${totalRow(`Less credit notes VAT (${plural(summary.creditNoteCount, 'credit note')}, net ${aed(summary.creditsNet)})`, `−${aed(summary.creditsVat)}`)}
    ${totalRow('Net output VAT', aed(summary.netOutputVat))}
    ${totalRow(`Input VAT on expenses (${plural(summary.expenseCount, 'expense')}, gross ${aed(summary.expensesGross)})`, `−${aed(summary.inputVat)}`)}
    ${totalRow(netVatLabel(summary), aed(Math.abs(summary.netVatPayable)), true)}
  </table>
  <h2>Detail</h2>
  ${
    summary.rows.length
      ? `<table class="lines"><tr><th>Date</th><th>Type</th><th>Reference</th><th>Customer or category</th><th class="r">Net</th><th class="r">VAT rate</th><th class="r">VAT</th><th class="r">Gross</th></tr>${rows}</table>`
      : '<p class="muted">There are no invoices, credit notes or expenses in this period.</p>'
  }
  <p class="footer-note muted">Figures are based on invoice and credit note dates. Please check them with your accountant before filing with the FTA.</p>`;
  return pdfDocument({ title: `VAT return summary ${q.label}`, body, extraCss: TAX_DOC_CSS });
}

export async function shareVatSummary(summary: VatSummary, settings: Settings | undefined) {
  await shareHtmlAsPdf(vatSummaryHTML(summary, settings));
}
