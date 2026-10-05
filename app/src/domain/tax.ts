/**
 * UAE VAT: tax invoices, credit notes, refunds and VAT return figures.
 * Pure functions shared by every data source; the SQL in the tax migration follows the same rules.
 */
import { formatAED, invoiceTotals } from './billing';
import { round2 } from './money';
import type {
  CreditNote,
  CreditNoteLine,
  CreditNoteRef,
  Expense,
  Family,
  Invoice,
  Payment,
  Refund,
  Settings,
  TaxParty,
  VatQuarter,
  VatQuarterStartMonth,
  VatSummary,
  VatSummaryRow,
} from './types';

/** A line to credit: net amount before VAT, optionally against an invoice line (same shape as the data source input). */
type CreditNoteLineInput = { description: string; invoiceLine?: number; net: number };

export { round2 };

const EPS = 0.005;

// ---------------------------------------------------------------------------
// Tax Registration Numbers and document titles
// ---------------------------------------------------------------------------

/** Remove spaces and hyphens from a TRN as typed. */
export function normaliseTrn(s: string): string {
  return (s ?? '').replace(/[\s-]/g, '');
}

/** A UAE TRN is 15 digits. */
export function isValidTrn(s: string): boolean {
  return /^\d{15}$/.test(normaliseTrn(s));
}

export function formatCreditNoteNumber(n: number): string {
  return `CN-${String(n).padStart(4, '0')}`;
}

export const CREDIT_NOTE_TITLE = 'Tax Credit Note';

function supplierTrn(doc: { supplier?: TaxParty }, settings?: Pick<Settings, 'trn'>): string | undefined {
  return doc.supplier ? doc.supplier.trn || undefined : settings?.trn || undefined;
}

/** 'Tax Invoice' once the business has a TRN (the invoice's frozen supplier first, else settings), otherwise 'Invoice'. */
export function invoiceDocumentTitle(inv: Pick<Invoice, 'supplier'>, settings?: Pick<Settings, 'trn'>): string {
  return supplierTrn(inv, settings) ? 'Tax Invoice' : 'Invoice';
}

/** 'Tax Credit Note' once the business has a TRN, otherwise 'Credit Note'. */
export function creditNoteDocumentTitle(note: Pick<CreditNote, 'supplier'>, settings?: Pick<Settings, 'trn'>): string {
  return supplierTrn(note, settings) ? CREDIT_NOTE_TITLE : 'Credit Note';
}

/** The supplier as printed: the invoice's snapshot, or for older invoices the live settings. */
export function invoiceSupplier(
  inv: Pick<Invoice, 'supplier'>,
  settings?: Pick<Settings, 'businessName' | 'legalName' | 'registeredAddress' | 'trn'>,
): TaxParty | undefined {
  if (inv.supplier) return inv.supplier;
  if (!settings) return undefined;
  return {
    name: settings.legalName || settings.businessName,
    address: settings.registeredAddress || undefined,
    trn: settings.trn || undefined,
  };
}

/** The customer as printed: the invoice's snapshot, or for older invoices the live family. */
export function invoiceCustomer(
  inv: Pick<Invoice, 'customer'>,
  family?: Pick<Family, 'parentName' | 'billingAddress' | 'trn' | 'email'> & Partial<Pick<Family, 'billingName'>>,
): TaxParty | undefined {
  if (inv.customer) return inv.customer;
  if (!family) return undefined;
  return {
    name: family.billingName?.trim() || family.parentName,
    address: family.billingAddress || undefined,
    trn: family.trn || undefined,
    email: family.email || undefined,
  };
}

// ---------------------------------------------------------------------------
// Line-level VAT
// ---------------------------------------------------------------------------

export interface LineTax {
  index: number;
  description: string;
  quantity: number;
  unitPrice: number;
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
}

/** Index of the first line with the largest value. */
function firstLargest(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

/** Per-line net, VAT and gross whose sums equal invoiceTotals exactly (rounding differences go on the first largest line). */
export function invoiceLineTaxes(inv: Pick<Invoice, 'items' | 'vatRate'>): LineTax[] {
  if (inv.items.length === 0) return [];
  const totals = invoiceTotals({ items: inv.items, vatRate: inv.vatRate, payments: [] });
  const nets = inv.items.map((i) => round2(i.quantity * i.unitPrice));
  const big = firstLargest(nets);
  nets[big] = round2(nets[big] + totals.subtotal - sum(nets));
  const vats = nets.map((n) => round2(n * inv.vatRate));
  vats[big] = round2(vats[big] + totals.vat - sum(vats));
  return inv.items.map((item, index) => ({
    index,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    net: nets[index],
    vatRate: inv.vatRate,
    vat: vats[index],
    gross: round2(nets[index] + vats[index]),
  }));
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

type InvoiceForCredit = Pick<Invoice, 'items' | 'vatRate'>;
type NoteLines = Pick<CreditNote, 'lines'>;

function credited(notes: NoteLines[]): { net: number; vat: number } {
  const lines = notes.flatMap((n) => n.lines);
  return { net: sum(lines.map((l) => l.net)), vat: sum(lines.map((l) => l.vat)) };
}

function headline(inv: InvoiceForCredit) {
  const S = round2(inv.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const V = round2(S * inv.vatRate);
  return { S, V, T: round2(S + V) };
}

/** What is left to credit on each invoice line. */
export function creditableLines(
  inv: InvoiceForCredit,
  notes: NoteLines[],
): { index: number; description: string; net: number; credited: number; remaining: number }[] {
  const lines = notes.flatMap((n) => n.lines);
  return inv.items.map((item, index) => {
    const net = round2(item.quantity * item.unitPrice);
    const done = sum(lines.filter((l) => l.invoiceLine === index).map((l) => l.net));
    return { index, description: item.description, net, credited: done, remaining: Math.max(0, round2(net - done)) };
  });
}

/** Net, VAT and gross still creditable on an invoice. */
export function creditRemaining(inv: InvoiceForCredit, notes: NoteLines[]): { net: number; vat: number; gross: number } {
  const { S, V } = headline(inv);
  const c = credited(notes);
  const net = Math.max(0, round2(S - c.net));
  const vat = Math.max(0, round2(V - c.vat));
  return { net, vat, gross: round2(net + vat) };
}

export interface CreditNotePlan {
  lines: CreditNoteLine[];
  subtotal: number;
  vat: number;
  total: number;
  /** True when this note credits everything left on the invoice. */
  full: boolean;
}

/**
 * Line VATs of round(net * rate); the difference to the note's VAT goes to the first line with the largest net. A
 * negative difference is taken from the lines largest first without taking any line below zero (as the SQL does).
 */
function spreadVat(nets: number[], vat: number, rate: number): number[] {
  const vats = nets.map((n) => round2(n * rate));
  let diff = round2(vat - sum(vats));
  const order = nets.map((_, i) => i).sort((a, b) => nets[b] - nets[a] || a - b);
  if (diff > 0) {
    vats[order[0]] = round2(vats[order[0]] + diff);
  } else if (diff < 0) {
    for (const i of order) {
      if (diff === 0) break;
      const take = Math.min(vats[i], -diff);
      vats[i] = round2(vats[i] - take);
      diff = round2(diff + take);
    }
  }
  return vats;
}

/**
 * Plan a credit note from net amounts per line. A note that credits everything left takes exactly the VAT
 * not yet credited, so the invoice and its notes always net to zero.
 */
export function planCreditNote(inv: InvoiceForCredit, existing: NoteLines[], lines: CreditNoteLineInput[]): CreditNotePlan {
  const nets = lines.map((l) => round2(l.net));
  if (nets.length === 0 || nets.some((n) => !(n > 0))) throw new Error('Enter an amount to credit.');
  const R = inv.vatRate;
  const { S, V } = headline(inv);
  const c = credited(existing);

  const perLine = creditableLines(inv, existing);
  const asked = new Map<number, number>();
  lines.forEach((l, i) => {
    if (l.invoiceLine === undefined || l.invoiceLine === null) return;
    if (!perLine[l.invoiceLine]) throw new Error('Choose a line on this invoice to credit.');
    asked.set(l.invoiceLine, round2((asked.get(l.invoiceLine) ?? 0) + nets[i]));
  });
  for (const [index, amount] of [...asked.entries()].sort((a, b) => a[0] - b[0])) {
    const line = perLine[index];
    if (round2(line.credited + amount) > line.net + 1e-9) {
      throw new Error(`Line ${index + 1} has only ${formatAED(line.remaining)} left to credit.`);
    }
  }

  const N = sum(nets);
  if (round2(c.net + N) > S + 1e-9) {
    throw new Error(`Only ${formatAED(Math.max(0, round2(S - c.net)))} is left to credit on this invoice.`);
  }
  const full = round2(c.net + N) === S;
  const vatLeft = Math.max(0, round2(V - c.vat));
  const vat = full ? vatLeft : Math.min(round2(N * R), vatLeft);
  const vats = spreadVat(nets, vat, R);
  return {
    lines: lines.map((l, i) => ({
      description: l.description?.trim() || (l.invoiceLine !== undefined && l.invoiceLine !== null ? inv.items[l.invoiceLine]?.description?.trim() : '') || 'Credit',
      ...(l.invoiceLine !== undefined && l.invoiceLine !== null ? { invoiceLine: l.invoiceLine } : {}),
      net: nets[i],
      vat: vats[i],
    })),
    subtotal: N,
    vat,
    total: round2(N + vat),
    full,
  };
}

/** Plan a one-line credit note for a gross (VAT-inclusive) amount, e.g. to go with a refund. */
export function planCreditFromGross(inv: InvoiceForCredit, existing: NoteLines[], gross: number, description: string): CreditNotePlan {
  const G = round2(gross);
  if (!(G > 0)) throw new Error('Enter an amount to credit.');
  const R = inv.vatRate;
  const { S, V, T } = headline(inv);
  const c = credited(existing);
  const left = round2(T - c.net - c.vat);
  if (G > left + 1e-9) throw new Error(`Only ${formatAED(Math.max(0, left))} is left to credit on this invoice.`);
  let net: number;
  let vat: number;
  if (G === left) {
    vat = Math.max(0, round2(V - c.vat));
    net = round2(G - vat);
  } else {
    net = round2(G / (1 + R));
    if (round2(c.net + net) > S) net = round2(S - c.net);
    vat = round2(G - net);
  }
  if (!(net > 0)) throw new Error('Enter an amount to credit.');
  return { lines: [{ description, net, vat }], subtotal: net, vat, total: round2(net + vat), full: round2(c.net + net) === S };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/** What can still be refunded on a payment (failed refunds do not count). */
export function refundableAmount(payment: Pick<Payment, 'id' | 'amount'>, refunds: Pick<Refund, 'paymentId' | 'amount' | 'status'>[]): number {
  const done = sum(refunds.filter((r) => r.paymentId === payment.id && r.status !== 'failed').map((r) => r.amount));
  return Math.max(0, round2(payment.amount - done));
}

type InvoiceForBalance = Pick<Invoice, 'items' | 'vatRate' | 'payments'> & Partial<Pick<Invoice, 'creditNotes' | 'refunds'>>;

/** Money the family has paid beyond what the invoice (less credits) asks for. */
export function overpaid(inv: InvoiceForBalance): number {
  return Math.max(0, round2(-invoiceTotals(inv).balance));
}

/**
 * Refunding a settled invoice beyond any overpayment reduces the supply, so it needs a credit note.
 */
export function refundNeedsCreditNote(inv: InvoiceForBalance & Pick<Invoice, 'status'>, amount: number): boolean {
  return (inv.status === 'paid' || inv.status === 'void') && amount > overpaid(inv) + EPS;
}

// ---------------------------------------------------------------------------
// VAT quarters and the VAT return summary
// ---------------------------------------------------------------------------

export const VAT_QUARTER_OPTIONS: { value: VatQuarterStartMonth; label: string }[] = [
  { value: 1, label: 'January, April, July and October' },
  { value: 2, label: 'February, May, August and November' },
  { value: 3, label: 'March, June, September and December' },
];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The VAT quarter containing a `YYYY-MM-DD` date. */
export function vatQuarterFor(dateKey: string, startMonth: VatQuarterStartMonth): VatQuarter {
  const [y, m] = dateKey.split('-').map(Number);
  const offset = (m - startMonth + 12) % 3;
  let sy = y;
  let sm = m - offset;
  if (sm < 1) {
    sm += 12;
    sy -= 1;
  }
  let ey = sy;
  let em = sm + 2;
  if (em > 12) {
    em -= 12;
    ey += 1;
  }
  const label = sy === ey ? `${MON[sm - 1]} – ${MON[em - 1]} ${ey}` : `${MON[sm - 1]} ${sy} – ${MON[em - 1]} ${ey}`;
  return { start: `${sy}-${pad(sm)}-01`, end: `${ey}-${pad(em)}-${pad(daysInMonth(ey, em))}`, label };
}

/** The date in Dubai (UTC+4 all year, no daylight saving) as YYYY-MM-DD, wherever the device is. */
export function dubaiDateKey(now: Date): string {
  const d = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The current quarter (by the date in Dubai, where the business files its returns) and the ones before it, newest first. */
export function recentVatQuarters(now: Date, startMonth: VatQuarterStartMonth, count: number): VatQuarter[] {
  const key = dubaiDateKey(now);
  const out: VatQuarter[] = [];
  let q = vatQuarterFor(key, startMonth);
  for (let i = 0; i < count; i++) {
    out.push(q);
    const [y, m] = q.start.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
    q = vatQuarterFor(prev, startMonth);
  }
  return out;
}

const within = (d: string, q: VatQuarter) => d.slice(0, 10) >= q.start && d.slice(0, 10) <= q.end;

/**
 * Figures for a VAT return. Output VAT from issued invoices (drafts and legacy voids left out) less credit
 * notes, input VAT from expenses. A negative net figure is reclaimable.
 */
export function vatSummary(
  q: VatQuarter,
  data: {
    invoices: Invoice[];
    creditNotes: (CreditNoteRef & Partial<Pick<CreditNote, 'familyId' | 'customer' | 'vatRate'>>)[];
    expenses: Expense[];
    familyName?: (id: string) => string | undefined;
  },
): VatSummary {
  const rows: VatSummaryRow[] = [];
  let standardRatedNet = 0;
  let zeroRatedNet = 0;
  let outOfScopeNet = 0;
  let outputVat = 0;
  let invoiceCount = 0;
  for (const inv of data.invoices) {
    if (inv.status === 'draft') continue;
    if (inv.status === 'void' && !(inv.creditNotes && inv.creditNotes.length > 0)) continue;
    if (!within(inv.issueDate, q)) continue;
    const t = invoiceTotals({ items: inv.items, vatRate: inv.vatRate, payments: [] });
    invoiceCount++;
    if (inv.vatRate > 0) standardRatedNet += t.subtotal;
    // A 0% invoice is zero-rated only when issued as a VAT-registered business; before registration it is out of scope.
    else if (inv.supplier?.trn) zeroRatedNet += t.subtotal;
    else outOfScopeNet += t.subtotal;
    outputVat += t.vat;
    rows.push({
      kind: 'invoice',
      date: inv.issueDate,
      reference: inv.number,
      party: data.familyName?.(inv.familyId) ?? inv.customer?.name,
      net: t.subtotal,
      vatRate: inv.vatRate,
      vat: t.vat,
      gross: t.total,
    });
  }
  let creditsNet = 0;
  let creditsVat = 0;
  let standardRatedCreditsNet = 0;
  let creditNoteCount = 0;
  for (const n of data.creditNotes) {
    if (!within(n.issueDate, q)) continue;
    creditNoteCount++;
    creditsNet += n.subtotal;
    creditsVat += n.vat;
    if ((n.vatRate ?? 0) > 0 || n.vat > 0) standardRatedCreditsNet += n.subtotal;
    rows.push({
      kind: 'credit-note',
      date: n.issueDate,
      reference: n.number,
      party: (n.familyId ? data.familyName?.(n.familyId) : undefined) ?? n.customer?.name,
      net: -n.subtotal,
      vatRate: n.vatRate,
      vat: -n.vat,
      gross: -n.total,
    });
  }
  let expensesGross = 0;
  let inputVat = 0;
  let expenseCount = 0;
  for (const e of data.expenses) {
    if (!within(e.date, q)) continue;
    expenseCount++;
    expensesGross += e.amount;
    inputVat += e.vatAmount;
    rows.push({
      kind: 'expense',
      date: e.date,
      reference: e.description || e.category,
      party: e.category,
      net: round2(e.amount - e.vatAmount),
      vat: round2(e.vatAmount),
      gross: round2(e.amount),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  const netOutputVat = round2(outputVat - creditsVat);
  return {
    quarter: q,
    invoiceCount,
    standardRatedNet: round2(standardRatedNet),
    standardRatedCreditsNet: round2(standardRatedCreditsNet),
    zeroRatedNet: round2(zeroRatedNet),
    outOfScopeNet: round2(outOfScopeNet),
    outputVat: round2(outputVat),
    creditNoteCount,
    creditsNet: round2(creditsNet),
    creditsVat: round2(creditsVat),
    netOutputVat,
    expenseCount,
    expensesGross: round2(expensesGross),
    inputVat: round2(inputVat),
    netVatPayable: round2(netOutputVat - inputVat),
    rows,
  };
}

const KIND_LABEL: Record<VatSummaryRow['kind'], string> = { invoice: 'Invoice', 'credit-note': 'Credit note', expense: 'Expense' };

/** The VAT summary as spreadsheet rows (pass to toCSV). */
export function vatSummaryCsvRows(summary: VatSummary): (string | number)[][] {
  const header = ['Type', 'Date', 'Reference', 'Customer or category', 'Net (AED)', 'VAT rate', 'VAT (AED)', 'Gross (AED)'];
  const rows = summary.rows.map((r) => [
    KIND_LABEL[r.kind],
    r.date,
    r.reference,
    r.party ?? '',
    r.net,
    r.vatRate === undefined ? '' : `${round2(r.vatRate * 100)}%`,
    r.vat,
    r.gross,
  ]);
  const total = (label: string, net: number | '', vat: number | '') => [label, '', '', '', net, '', vat, ''];
  return [
    header,
    ...rows,
    [],
    total('Standard-rated supplies', summary.standardRatedNet, ''),
    total('Less credit notes (net)', round2(-summary.standardRatedCreditsNet), ''),
    total('Zero-rated supplies', summary.zeroRatedNet, ''),
    total('Outside the scope of VAT', summary.outOfScopeNet, ''),
    total('Output VAT', '', summary.outputVat),
    total('Credit notes VAT', '', round2(-summary.creditsVat)),
    total('Input VAT', '', summary.inputVat),
    total('Net VAT payable', '', summary.netVatPayable),
  ];
}
