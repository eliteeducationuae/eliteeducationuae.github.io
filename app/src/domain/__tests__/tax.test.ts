import { displayStatus, invoiceTotals, roundMoney } from '../billing';
import { monthFigures, type FinanceData } from '../finance';
import {
  creditableLines,
  creditNoteDocumentTitle,
  creditRemaining,
  formatCreditNoteNumber,
  invoiceCustomer,
  invoiceDocumentTitle,
  invoiceLineTaxes,
  invoiceSupplier,
  isValidTrn,
  normaliseTrn,
  overpaid,
  planCreditFromGross,
  planCreditNote,
  recentVatQuarters,
  refundableAmount,
  refundNeedsCreditNote,
  round2,
  VAT_QUARTER_OPTIONS,
  vatQuarterFor,
  vatSummary,
  vatSummaryCsvRows,
} from '../tax';
import type { CreditNote, CreditNoteRef, Expense, Invoice, Refund } from '../types';

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    number: 'INV-0001',
    familyId: 'f1',
    issueDate: '2026-02-10',
    dueDate: '2026-02-17',
    status: 'sent',
    items: [
      { description: 'Lesson 1', quantity: 1, unitPrice: 333.33 },
      { description: 'Lesson 2', quantity: 1, unitPrice: 333.33 },
      { description: 'Lesson 3', quantity: 1, unitPrice: 333.33 },
    ],
    vatRate: 0.05,
    payments: [],
    ...over,
  };
}

/** A stored credit note from a plan, as the data sources keep it. */
function note(inv: Invoice, plan: ReturnType<typeof planCreditNote>, over: Partial<CreditNote> = {}): CreditNote {
  return {
    id: `cn-${Math.random()}`,
    number: 'CN-0001',
    issueDate: '2026-02-20',
    subtotal: plan.subtotal,
    vat: plan.vat,
    total: plan.total,
    rebilled: false,
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    familyId: inv.familyId,
    reason: 'Test',
    vatRate: inv.vatRate,
    lines: plan.lines,
    createdAt: '2026-02-20T10:00:00Z',
    ...over,
  };
}

const ref = (n: CreditNote): CreditNoteRef => ({
  id: n.id,
  number: n.number,
  issueDate: n.issueDate,
  subtotal: n.subtotal,
  vat: n.vat,
  total: n.total,
  rebilled: n.rebilled,
});

describe('round2', () => {
  it('rounds half away from zero without float surprises', () => {
    expect(round2(333.33 * 0.05)).toBe(16.67);
    expect(round2(999.99 * 0.05)).toBe(50);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(-0.001)).toBe(0);
    expect(Object.is(round2(-0.001), -0)).toBe(false);
    expect(round2(NaN)).toBe(0);
    expect(roundMoney(1.005)).toBe(1.01);
  });
});

describe('TRNs and titles', () => {
  it('normalises and validates 15-digit TRNs', () => {
    expect(normaliseTrn('100-0000 0000-0003')).toBe('100000000000003');
    expect(isValidTrn('100 000 000 000 003')).toBe(true);
    expect(isValidTrn('10000000000000')).toBe(false);
    expect(isValidTrn('1000000000000034')).toBe(false);
    expect(isValidTrn('10000000000000A')).toBe(false);
    expect(isValidTrn('')).toBe(false);
  });

  it('numbers credit notes', () => {
    expect(formatCreditNoteNumber(1)).toBe('CN-0001');
    expect(formatCreditNoteNumber(12345)).toBe('CN-12345');
  });

  it('calls it a tax invoice once a TRN is known, preferring the frozen supplier', () => {
    expect(invoiceDocumentTitle({}, { trn: '100000000000003' })).toBe('Tax Invoice');
    expect(invoiceDocumentTitle({}, {})).toBe('Invoice');
    expect(invoiceDocumentTitle({ supplier: { name: 'X' } }, { trn: '100000000000003' })).toBe('Invoice');
    expect(invoiceDocumentTitle({ supplier: { name: 'X', trn: '100000000000003' } })).toBe('Tax Invoice');
    expect(creditNoteDocumentTitle({ supplier: { name: 'X', trn: '100000000000003' } })).toBe('Tax Credit Note');
    expect(creditNoteDocumentTitle({}, {})).toBe('Credit Note');
  });

  it('prints the snapshot, or the live details for older invoices', () => {
    const settings = { businessName: 'Elite Education', legalName: 'Elite Education LLC', registeredAddress: 'Dubai', trn: '100000000000003' };
    expect(invoiceSupplier({}, settings)).toEqual({ name: 'Elite Education LLC', address: 'Dubai', trn: '100000000000003' });
    expect(invoiceSupplier({}, { businessName: 'Elite Education' })).toEqual({ name: 'Elite Education', address: undefined, trn: undefined });
    expect(invoiceSupplier({ supplier: { name: 'Frozen' } }, settings)).toEqual({ name: 'Frozen' });
    expect(invoiceSupplier({})).toBeUndefined();
    const family = { parentName: 'Rami Haddad', billingAddress: 'PO Box 1', trn: '100000000000012', email: 'r@example.com' };
    expect(invoiceCustomer({}, family)).toEqual({ name: 'Rami Haddad', address: 'PO Box 1', trn: '100000000000012', email: 'r@example.com' });
    expect(invoiceCustomer({ customer: { name: 'Frozen' } }, family)).toEqual({ name: 'Frozen' });
  });
});

describe('invoiceLineTaxes', () => {
  it.each([
    [[333.33, 333.33, 333.33], 0.05],
    [[0.1, 0.1, 0.1], 0.05],
    [[99.99, 0.01, 1234.567], 0.05],
    [[450, 450, 99.99], 0.05],
    [[12.345, 67.891], 0.05],
    [[450], 0],
  ])('sums to the invoice totals for %j at %p', (prices, vatRate) => {
    const inv = invoice({ items: prices.map((p, i) => ({ description: `L${i}`, quantity: 1, unitPrice: p })), vatRate });
    const lines = invoiceLineTaxes(inv);
    const t = invoiceTotals(inv);
    expect(round2(lines.reduce((s, l) => s + l.net, 0))).toBe(t.subtotal);
    expect(round2(lines.reduce((s, l) => s + l.vat, 0))).toBe(t.vat);
    expect(round2(lines.reduce((s, l) => s + l.gross, 0))).toBe(t.total);
  });

  it('puts the rounding difference on the first largest line', () => {
    const lines = invoiceLineTaxes(invoice());
    // 3 × 16.67 = 50.01 but the invoice VAT is 50.00.
    expect(lines.map((l) => l.vat)).toEqual([16.66, 16.67, 16.67]);
  });
});

describe('planCreditNote', () => {
  it('follows the worked example exactly', () => {
    const inv = invoice();
    expect(invoiceTotals(inv)).toMatchObject({ subtotal: 999.99, vat: 50, total: 1049.99 });
    const first = planCreditNote(inv, [], [{ description: 'Lesson 1', invoiceLine: 0, net: 333.33 }]);
    expect(first).toMatchObject({ subtotal: 333.33, vat: 16.67, total: 350, full: false });
    const n1 = note(inv, first);
    const rest = planCreditNote(inv, [n1], [
      { description: 'Lesson 2', invoiceLine: 1, net: 333.33 },
      { description: 'Lesson 3', invoiceLine: 2, net: 333.33 },
    ]);
    expect(rest).toMatchObject({ subtotal: 666.66, vat: 33.33, total: 699.99, full: true });
    expect(rest.lines.map((l) => l.vat)).toEqual([16.66, 16.67]);
    const n2 = note(inv, rest);
    expect(creditRemaining(inv, [n1, n2])).toEqual({ net: 0, vat: 0, gross: 0 });
    expect(round2(n1.total + n2.total)).toBe(1049.99);
  });

  it('refuses nothing, too much on a line, and too much in all, with exact messages', () => {
    const inv = invoice();
    expect(() => planCreditNote(inv, [], [])).toThrow('Enter an amount to credit.');
    expect(() => planCreditNote(inv, [], [{ description: 'x', net: 0 }])).toThrow('Enter an amount to credit.');
    expect(() => planCreditNote(inv, [], [{ description: 'x', net: -5 }])).toThrow('Enter an amount to credit.');
    const n1 = note(inv, planCreditNote(inv, [], [{ description: 'x', invoiceLine: 1, net: 300 }]));
    expect(() => planCreditNote(inv, [n1], [{ description: 'x', invoiceLine: 1, net: 40 }])).toThrow('Line 2 has only AED 33.33 left to credit.');
    // Two new lines on the same invoice line count together.
    expect(() =>
      planCreditNote(inv, [], [
        { description: 'a', invoiceLine: 0, net: 200 },
        { description: 'b', invoiceLine: 0, net: 200 },
      ]),
    ).toThrow('Line 1 has only AED 333.33 left to credit.');
    expect(() => planCreditNote(inv, [n1], [{ description: 'x', net: 700 }])).toThrow('Only AED 699.99 is left to credit on this invoice.');
    expect(() => planCreditNote(inv, [], [{ description: 'x', invoiceLine: 7, net: 1 }])).toThrow('Choose a line on this invoice to credit.');
    expect(creditableLines(inv, [n1]).map((l) => l.remaining)).toEqual([333.33, 33.33, 333.33]);
  });

  it('credits exactly the VAT left after several partial notes', () => {
    const inv = invoice({ items: [{ description: 'Course', quantity: 7, unitPrice: 142.857 }] });
    const t = invoiceTotals(inv);
    const notes: CreditNote[] = [];
    for (const net of [100.01, 33.33, 0.07, 250.55]) {
      notes.push(note(inv, planCreditNote(inv, notes, [{ description: 'part', invoiceLine: 0, net }])));
    }
    const left = creditRemaining(inv, notes);
    const last = planCreditNote(inv, notes, [{ description: 'rest', invoiceLine: 0, net: left.net }]);
    expect(last.full).toBe(true);
    notes.push(note(inv, last));
    expect(round2(notes.reduce((s, n) => s + n.subtotal, 0))).toBe(t.subtotal);
    expect(round2(notes.reduce((s, n) => s + n.vat, 0))).toBe(t.vat);
    expect(round2(notes.reduce((s, n) => s + n.total, 0))).toBe(t.total);
    expect(invoiceTotals({ ...inv, creditNotes: notes.map(ref) }).balance).toBe(0);
  });

  it('defaults a blank description to the invoice line', () => {
    const plan = planCreditNote(invoice(), [], [{ description: ' ', invoiceLine: 2, net: 10 }]);
    expect(plan.lines[0].description).toBe('Lesson 3');
  });
});

describe('planCreditFromGross', () => {
  it('splits a partial gross amount into net and VAT', () => {
    const inv = invoice();
    const plan = planCreditFromGross(inv, [], 105, 'Refund: one hour');
    expect(plan).toMatchObject({ subtotal: 100, vat: 5, total: 105, full: false });
    expect(plan.lines).toEqual([{ description: 'Refund: one hour', net: 100, vat: 5 }]);
  });

  it('takes exactly what is left when the remainder is credited', () => {
    const inv = invoice();
    const n1 = note(inv, planCreditNote(inv, [], [{ description: 'x', invoiceLine: 0, net: 333.33 }]));
    const plan = planCreditFromGross(inv, [n1], 699.99, 'Refund: the rest');
    expect(plan).toMatchObject({ subtotal: 666.66, vat: 33.33, total: 699.99, full: true });
    expect(() => planCreditFromGross(inv, [n1], 700, 'x')).toThrow('Only AED 699.99 is left to credit on this invoice.');
    expect(() => planCreditFromGross(inv, [n1], 0, 'x')).toThrow('Enter an amount to credit.');
  });

  it('always totals exactly the gross asked for (AED 10.00 to 199.99 at 5%)', () => {
    const inv = invoice();
    for (let fils = 1000; fils < 20000; fils++) {
      const gross = fils / 100;
      const plan = planCreditFromGross(inv, [], gross, 'Credit');
      expect(plan.total).toBe(gross);
      expect(round2(plan.subtotal + plan.vat)).toBe(gross);
    }
    // The amounts QA found a fils out when only the net was sent.
    expect(planCreditFromGross(inv, [], 10.18, 'x')).toMatchObject({ subtotal: 9.7, vat: 0.48, total: 10.18 });
    expect(planCreditFromGross(inv, [], 105.1, 'x')).toMatchObject({ subtotal: 100.1, vat: 5, total: 105.1 });
  });
});

describe('refunds', () => {
  const payment = { id: 'p1', invoiceId: 'i1', amount: 1049.99, method: 'card' as const, paidAt: '2026-02-11' };
  const refund = (amount: number, status: Refund['status'], paymentId = 'p1'): Refund => ({
    id: `r-${amount}-${status}`,
    invoiceId: 'i1',
    familyId: 'f1',
    paymentId,
    amount,
    method: 'card',
    status,
    reason: 'x',
    createdAt: '2026-02-20T10:00:00Z',
  });

  it('works out what is still refundable (failed refunds do not count)', () => {
    expect(refundableAmount(payment, [])).toBe(1049.99);
    expect(refundableAmount(payment, [refund(100, 'succeeded'), refund(50, 'pending'), refund(500, 'failed'), refund(9, 'succeeded', 'other')])).toBe(899.99);
  });

  it('needs a credit note to refund a settled invoice beyond the overpayment', () => {
    const paid = invoice({ status: 'paid', payments: [{ ...payment, amount: 1100 }] });
    expect(overpaid(paid)).toBe(50.01);
    expect(refundNeedsCreditNote(paid, 50.01)).toBe(false);
    expect(refundNeedsCreditNote(paid, 50.02)).toBe(true);
    // A part-paid invoice can be refunded without one: the family simply owes more.
    expect(refundNeedsCreditNote(invoice({ payments: [{ ...payment, amount: 100 }] }), 100)).toBe(false);
    expect(overpaid(invoice())).toBe(0);
  });
});

describe('invoice totals with credit notes and refunds', () => {
  it('reduces the balance by credits and adds back refunds (failed ones ignored)', () => {
    const inv = invoice({
      status: 'paid',
      payments: [{ id: 'p1', invoiceId: 'i1', amount: 1049.99, method: 'card', paidAt: '2026-02-11' }],
      creditNotes: [{ id: 'c1', number: 'CN-0001', issueDate: '2026-02-20', subtotal: 333.33, vat: 16.67, total: 350, rebilled: false }],
      refunds: [
        { id: 'r1', invoiceId: 'i1', familyId: 'f1', paymentId: 'p1', amount: 350, method: 'card', status: 'succeeded', reason: 'x', createdAt: '2026-02-21' },
        { id: 'r2', invoiceId: 'i1', familyId: 'f1', paymentId: 'p1', amount: 99, method: 'card', status: 'failed', reason: 'x', createdAt: '2026-02-21' },
      ],
    });
    expect(invoiceTotals(inv)).toEqual({ subtotal: 999.99, vat: 50, total: 1049.99, paid: 1049.99, credited: 350, refunded: 350, balance: 0 });
  });

  it("shows 'credited' for an invoice cancelled by credit notes and 'void' for older cancellations", () => {
    const full: CreditNoteRef = { id: 'c1', number: 'CN-0001', issueDate: '2026-02-20', subtotal: 999.99, vat: 50, total: 1049.99, rebilled: true };
    expect(displayStatus(invoice({ status: 'void', creditNotes: [full] }))).toBe('credited');
    expect(displayStatus(invoice({ status: 'void' }))).toBe('void');
    expect(displayStatus(invoice({ status: 'void', creditNotes: [{ ...full, total: 10 }] }))).toBe('void');
    // A sent invoice cleared by a partial credit and a payment shows as paid.
    const cleared = invoice({
      creditNotes: [{ ...full, subtotal: 100, vat: 5, total: 105 }],
      payments: [{ id: 'p', invoiceId: 'i1', amount: 944.99, method: 'cash', paidAt: '2026-02-11' }],
    });
    expect(displayStatus(cleared)).toBe('paid');
  });
});

describe('VAT quarters', () => {
  it('offers the three FTA cycles', () => {
    expect(VAT_QUARTER_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3]);
    expect(VAT_QUARTER_OPTIONS[1].label).toBe('February, May, August and November');
  });

  it('finds the quarter for each start month, across year ends and leap years', () => {
    expect(vatQuarterFor('2026-03-31', 1)).toEqual({ start: '2026-01-01', end: '2026-03-31', label: 'Jan – Mar 2026' });
    expect(vatQuarterFor('2026-01-01', 1)).toEqual({ start: '2026-01-01', end: '2026-03-31', label: 'Jan – Mar 2026' });
    expect(vatQuarterFor('2026-12-31', 1)).toEqual({ start: '2026-10-01', end: '2026-12-31', label: 'Oct – Dec 2026' });
    // Start month 2: quarters begin in February, May, August and November.
    expect(vatQuarterFor('2026-01-15', 2)).toEqual({ start: '2025-11-01', end: '2026-01-31', label: 'Nov 2025 – Jan 2026' });
    expect(vatQuarterFor('2026-05-20', 2)).toEqual({ start: '2026-05-01', end: '2026-07-31', label: 'May – Jul 2026' });
    expect(vatQuarterFor('2026-12-01', 2)).toEqual({ start: '2026-11-01', end: '2027-01-31', label: 'Nov 2026 – Jan 2027' });
    expect(vatQuarterFor('2027-12-20', 2)).toEqual({ start: '2027-11-01', end: '2028-01-31', label: 'Nov 2027 – Jan 2028' });
    expect(vatQuarterFor('2028-02-29', 2)).toEqual({ start: '2028-02-01', end: '2028-04-30', label: 'Feb – Apr 2028' });
    // Start month 3: quarters begin in March, June, September and December, so winter straddles the year end.
    expect(vatQuarterFor('2026-01-15', 3)).toEqual({ start: '2025-12-01', end: '2026-02-28', label: 'Dec 2025 – Feb 2026' });
    expect(vatQuarterFor('2028-02-29', 3)).toEqual({ start: '2027-12-01', end: '2028-02-29', label: 'Dec 2027 – Feb 2028' });
    expect(vatQuarterFor('2026-02-14', 3)).toEqual({ start: '2025-12-01', end: '2026-02-28', label: 'Dec 2025 – Feb 2026' });
    expect(vatQuarterFor('2026-03-01', 3)).toEqual({ start: '2026-03-01', end: '2026-05-31', label: 'Mar – May 2026' });
    expect(vatQuarterFor('2026-11-30', 3)).toEqual({ start: '2026-09-01', end: '2026-11-30', label: 'Sep – Nov 2026' });
  });

  it('lists recent quarters newest first, including the current one', () => {
    const qs = recentVatQuarters(new Date(2026, 0, 15), 1, 3);
    expect(qs.map((q) => q.label)).toEqual(['Jan – Mar 2026', 'Oct – Dec 2025', 'Jul – Sep 2025']);
    const two = recentVatQuarters(new Date(2026, 1, 1), 3, 2);
    expect(two.map((q) => [q.start, q.end])).toEqual([
      ['2025-12-01', '2026-02-28'],
      ['2025-09-01', '2025-11-30'],
    ]);
    expect(recentVatQuarters(new Date(2026, 0, 31), 2, 2).map((q) => q.label)).toEqual(['Nov 2025 – Jan 2026', 'Aug – Oct 2025']);
  });
});

describe('vatSummary', () => {
  const q = vatQuarterFor('2026-02-01', 1);
  const issued = invoice({ id: 'a', number: 'INV-0002', issueDate: '2026-02-10' });
  const zeroRated = invoice({
    id: 'b',
    number: 'INV-0003',
    issueDate: '2026-03-01',
    vatRate: 0,
    items: [{ description: 'x', quantity: 1, unitPrice: 200 }],
    supplier: { name: 'Elite Education', trn: '100000000000003' },
  });
  // Issued at 0% before the business registered for VAT (no TRN): outside the scope of VAT, not zero-rated.
  const preRegistration = invoice({ id: 'g', number: 'INV-0008', issueDate: '2026-03-02', vatRate: 0, items: [{ description: 'y', quantity: 1, unitPrice: 150 }], supplier: { name: 'Elite Education' } });
  const draft = invoice({ id: 'c', number: 'INV-0004', status: 'draft' });
  const legacyVoid = invoice({ id: 'd', number: 'INV-0005', status: 'void' });
  const outside = invoice({ id: 'e', number: 'INV-0006', issueDate: '2026-04-01' });
  const credit = note(issued, planCreditNote(issued, [], [{ description: 'x', invoiceLine: 0, net: 333.33 }]), { number: 'CN-0001', issueDate: '2026-03-05' });
  const closing = note(issued, planCreditNote(issued, [credit], [{ description: 'y', invoiceLine: 1, net: 100 }]), {
    number: 'CN-0002',
    issueDate: '2026-03-06',
    rebilled: true,
  });
  const cancelled = invoice({ id: 'f', number: 'INV-0007', status: 'void', issueDate: '2026-01-05', creditNotes: [ref(closing)] });
  const expenses: Expense[] = [
    { id: 'x1', date: '2026-01-31', category: 'Rent', description: 'Room', amount: 2625, vatAmount: 125 },
    { id: 'x2', date: '2026-04-01', category: 'Rent', amount: 2625, vatAmount: 125 },
  ];

  const summary = vatSummary(q, {
    invoices: [issued, zeroRated, preRegistration, draft, legacyVoid, outside, cancelled],
    creditNotes: [credit, closing],
    expenses,
    familyName: () => 'Haddad',
  });

  it('adds up output VAT, credits and input VAT', () => {
    expect(summary).toMatchObject({
      invoiceCount: 4,
      standardRatedNet: 1999.98,
      standardRatedCreditsNet: 433.33,
      zeroRatedNet: 200,
      outOfScopeNet: 150,
      outputVat: 100,
      creditNoteCount: 2,
      creditsNet: 433.33,
      creditsVat: 21.67,
      netOutputVat: 78.33,
      expenseCount: 1,
      expensesGross: 2625,
      inputVat: 125,
      netVatPayable: -46.67,
    });
  });

  it('lists rows by date with credit notes negative', () => {
    expect(summary.rows.map((r) => r.reference)).toEqual(['INV-0007', 'Room', 'INV-0002', 'INV-0003', 'INV-0008', 'CN-0001', 'CN-0002']);
    const cn = summary.rows.find((r) => r.reference === 'CN-0001')!;
    expect(cn).toMatchObject({ kind: 'credit-note', net: -333.33, vat: -16.67, gross: -350, party: 'Haddad' });
    expect(summary.rows.find((r) => r.kind === 'expense')).toMatchObject({ net: 2500, vat: 125, gross: 2625, party: 'Rent' });
  });

  it('exports CSV rows with a totals block', () => {
    const rows = vatSummaryCsvRows(summary);
    expect(rows[0]).toEqual(['Type', 'Date', 'Reference', 'Customer or category', 'Net (AED)', 'VAT rate', 'VAT (AED)', 'Gross (AED)']);
    expect(rows[1]).toEqual(['Invoice', '2026-01-05', 'INV-0007', 'Haddad', 999.99, '5%', 50, 1049.99]);
    expect(rows[summary.rows.length + 1]).toEqual([]);
    expect(rows.slice(-8).map((r) => r[0])).toEqual([
      'Standard-rated supplies',
      'Less credit notes (net)',
      'Zero-rated supplies',
      'Outside the scope of VAT',
      'Output VAT',
      'Credit notes VAT',
      'Input VAT',
      'Net VAT payable',
    ]);
    expect(rows[rows.length - 1][6]).toBe(-46.67);
  });
});

describe('finance with credit notes and refunds', () => {
  const at = (m: number, d: number) => new Date(2026, m, d, 12);
  const base: FinanceData = {
    charges: [{ id: 'c', lessonId: 'l', studentId: 's', familyId: 'f1', description: 'x', amount: 1000, status: 'invoiced', date: at(1, 3).toISOString() }],
    packages: [],
    invoices: [
      invoice({ payments: [{ id: 'p1', invoiceId: 'i1', amount: 1049.99, method: 'card', paidAt: at(1, 11).toISOString() }] }),
    ],
    lessons: [],
    tutors: [],
    tutorInvoices: [],
    expenses: [],
    settings: { payTutorForLateCancel: true },
  };

  it('takes credit notes off profit (not re-invoiced ones) and refunds off cash', () => {
    const creditNotes: CreditNoteRef[] = [
      { id: 'n1', number: 'CN-0001', issueDate: '2026-02-20', subtotal: 100, vat: 5, total: 105, rebilled: false },
      { id: 'n2', number: 'CN-0002', issueDate: '2026-02-21', subtotal: 500, vat: 25, total: 525, rebilled: true },
      { id: 'n3', number: 'CN-0003', issueDate: '2026-03-01', subtotal: 50, vat: 2.5, total: 52.5, rebilled: false },
    ];
    const refunds: Refund[] = [
      { id: 'r1', invoiceId: 'i1', familyId: 'f1', paymentId: 'p1', amount: 105, method: 'card', status: 'succeeded', reason: 'x', createdAt: at(1, 20).toISOString(), settledAt: at(1, 22).toISOString() },
      { id: 'r2', invoiceId: 'i1', familyId: 'f1', paymentId: 'p1', amount: 40, method: 'card', status: 'pending', reason: 'x', createdAt: at(1, 23).toISOString() },
      { id: 'r3', invoiceId: 'i1', familyId: 'f1', paymentId: 'p1', amount: 30, method: 'card', status: 'failed', reason: 'x', createdAt: at(1, 23).toISOString() },
    ];
    const feb = monthFigures(at(1, 1), { ...base, creditNotes, refunds });
    expect(feb).toMatchObject({ revenue: 1000, credits: 100, refunds: 105, profit: 900, cashIn: 944.99 });
    // Without explicit lists the invoice's attached credit notes and refunds are used.
    const attached = monthFigures(at(1, 1), { ...base, invoices: [{ ...base.invoices[0], creditNotes, refunds }] });
    expect(attached).toMatchObject({ credits: 100, refunds: 105, profit: 900, cashIn: 944.99 });
    expect(monthFigures(at(1, 1), base)).toMatchObject({ credits: 0, refunds: 0, profit: 1000, cashIn: 1049.99 });
  });
});
