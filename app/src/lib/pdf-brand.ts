/**
 * Shared Elite Education styling for every printable document (progress reports, term reports and invoices),
 * following the 2026 Brand Guidelines: Noir Black and Champagne Gold, Georgia headings, Calibri body text,
 * the approved black logo on white paper, and the footer "Elite Education | eliteeducation.me".
 *
 * This module is pure (no React Native, Expo or theme imports) so it can be unit-tested in Node.
 */
import { LOGO_BLACK_DATA_URI } from './logo-data';

export const PDF_COLORS = {
  noir: '#0A0A0A',
  gold: '#C9A84C',
  ivory: '#F9F8F5',
  white: '#FFFFFF',
  /** Stone Grey deepened so small text meets WCAG AA on white. */
  muted: '#6B6B6B',
  hairline: '#E5E0D4',
  /** Neutral for "not started" pills: a warm stone that carries noir text. */
  neutralPill: '#E9E5DA',
} as const;

export const PDF_FOOTER_TEXT = 'Elite Education | eliteeducation.me';

const SERIF = "Georgia, Gelasio, 'Times New Roman', serif";
const SANS = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

export function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Noir or white, whichever reads better on the given pill background. */
export function pillTextColor(background: string): string {
  return contrastRatio(PDF_COLORS.noir, background) >= contrastRatio(PDF_COLORS.white, background) ? PDF_COLORS.noir : PDF_COLORS.white;
}

/** An inline status pill, e.g. a mastery level. Text colour is chosen for legibility. */
export function pdfPill(label: string, background: string = PDF_COLORS.neutralPill): string {
  return `<span class="pill" style="background:${background};color:${pillTextColor(background)}">${escHtml(label)}</span>`;
}

export const BRAND_PDF_CSS = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: ${PDF_COLORS.white}; }
  body { font-family: ${SANS}; font-size: 13px; line-height: 1.55; color: ${PDF_COLORS.noir}; margin: 0; padding: 32px; }
  @media print { body { padding: 0; } }
  h1, h2, h3 { font-family: ${SERIF}; color: ${PDF_COLORS.noir}; line-height: 1.25; }
  h1 { font-weight: 400; font-size: 26px; margin: 0; }
  h2 { font-weight: 700; font-size: 16px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid ${PDF_COLORS.gold}; page-break-after: avoid; }
  h3 { font-weight: 700; font-size: 14px; margin: 16px 0 6px; }
  p { margin: 0 0 10px; }
  b, strong { font-weight: 700; }
  .label { font-family: ${SANS}; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${PDF_COLORS.muted}; }
  .muted { color: ${PDF_COLORS.muted}; }
  .pdf-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid ${PDF_COLORS.gold}; margin-bottom: 24px; }
  .pdf-logo { display: block; width: 120px; height: auto; margin: 4px 24px 4px 0; }
  .pdf-title { text-align: right; }
  .pdf-title h1 { margin-top: 4px; }
  .pdf-title .muted { margin-top: 4px; font-size: 12px; }
  .stats { display: flex; gap: 12px; margin: 16px 0; }
  .stat { flex: 1; background: ${PDF_COLORS.ivory}; border: 1px solid ${PDF_COLORS.hairline}; border-radius: 12px; padding: 12px 14px; }
  .stat b { display: block; font-family: ${SERIF}; font-size: 20px; font-weight: 700; margin-bottom: 2px; }
  .stat span { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${PDF_COLORS.muted}; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 12px; }
  th { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${PDF_COLORS.muted}; border-bottom: 1px solid ${PDF_COLORS.noir}; padding: 8px 6px; }
  td { padding: 8px 6px; border-bottom: 1px solid ${PDF_COLORS.hairline}; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .r { text-align: right; }
  .tot td { border-bottom: none; font-weight: 700; }
  .tot.grand td { border-top: 1.5px solid ${PDF_COLORS.gold}; font-family: ${SERIF}; font-size: 14px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; }
  .parties { display: flex; gap: 48px; margin-bottom: 8px; }
  .parties p { margin-top: 4px; }
  .panel { background: ${PDF_COLORS.ivory}; border: 1px solid ${PDF_COLORS.hairline}; border-radius: 12px; padding: 14px 16px; margin-top: 24px; }
  ul { margin: 0; padding-left: 18px; } li { margin: 4px 0; }
  .pdf-footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid ${PDF_COLORS.hairline}; text-align: center; font-size: 10.5px; letter-spacing: 0.06em; color: ${PDF_COLORS.muted}; }
`;

export interface PdfHeaderOptions {
  title: string;
  subtitle?: string;
  /** A short caps label above the title, e.g. "Invoice" or "Progress report". */
  meta?: string;
}

/** The black logo with clear space on the left, the title block on the right, and a thin gold rule beneath. */
export function pdfHeader({ title, subtitle, meta }: PdfHeaderOptions): string {
  return `<header class="pdf-header">
  <img class="pdf-logo" src="${LOGO_BLACK_DATA_URI}" alt="Elite Education" width="120">
  <div class="pdf-title">
    ${meta ? `<div class="label">${escHtml(meta)}</div>` : ''}
    <h1>${escHtml(title)}</h1>
    ${subtitle ? `<div class="muted">${escHtml(subtitle)}</div>` : ''}
  </div>
</header>`;
}

export function pdfFooter(): string {
  return `<footer class="pdf-footer">${escHtml(PDF_FOOTER_TEXT)}</footer>`;
}

export interface PdfDocumentOptions {
  title: string;
  /** Trusted HTML for the page body (callers escape user data with escHtml). */
  body: string;
  extraCss?: string;
}

/** A complete printable HTML document in the Elite Education style, with the footer appended. */
export function pdfDocument({ title, body, extraCss }: PdfDocumentOptions): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>${BRAND_PDF_CSS}${extraCss ?? ''}</style></head><body>
${body}
${pdfFooter()}
</body></html>`;
}
