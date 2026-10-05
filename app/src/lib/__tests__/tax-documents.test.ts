/** Tax invoice, tax credit note and VAT return documents (Expo and React Native mocked). */
import { formatDate } from '@/domain/dates';
import { vatSummary } from '@/domain/tax';
import type { CreditNote, Expense, Family, Invoice, Settings } from '@/domain/types';

import { creditNoteHTML } from '../credit-note-pdf';
import { invoiceHTML } from '../invoice-pdf';
import { vatSummaryHTML } from '../vat-pdf';

// ts-jest hoists these above the imports.
jest.mock('expo-print', () => ({}), { virtual: true });
jest.mock('expo-sharing', () => ({}), { virtual: true });
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }), { virtual: true });

const BANK = 'Elite Education FZ LLC, Emirates NBD, IBAN AE070331234567890123456';

const settings: Settings = {
  businessName: 'Elite Education',
  legalName: 'Elite Education FZ-LLC',
  trn: '100123456700003',
  registeredAddress: 'Office 12\nDubai Knowledge Park',
  invoiceFooter: 'Registered in Dubai.',
  currency: 'AED',
  vatRate: 0.05,
  cancellationHours: 24,
  lateCancelFee: 1,
  noShowFee: 1,
  payTutorForLateCancel: true,
  invoiceDueDays: 7,
  nextInvoiceNumber: 10,
  nextCreditNoteNumber: 2,
  vatQuarterStartMonth: 1,
  bankDetails: BANK,
  emailLessonNotes: true,
  emailInvoices: true,
  emailMessages: true,
  bookingNoticeHours: 24,
};

const family = {
  id: 'f1',
  name: 'Haddad',
  parentName: 'Acme Trading LLC',
  email: 'accounts@acme.ae',
  trn: '100999888700003',
  billingAddress: 'Tower 1, Business Bay',
} as Family;

const invoice: Invoice = {
  id: 'i1',
  number: 'INV-0042',
  familyId: 'f1',
  issueDate: '2026-09-30',
  supplyDate: '2026-09-15',
  dueDate: '2026-10-07',
  status: 'sent',
  vatRate: 0.05,
  items: [
    { description: 'Maths lesson <script>alert(1)</script>', quantity: 2, unitPrice: 400 },
    { description: 'Physics lesson', quantity: 1, unitPrice: 250 },
  ],
  payments: [{ id: 'p1', invoiceId: 'i1', amount: 500, method: 'bank-transfer', paidAt: '2026-10-01T09:00:00Z' }],
  creditNotes: [{ id: 'c1', number: 'CN-0001', issueDate: '2026-10-02', subtotal: 100, vat: 5, total: 105, rebilled: false }],
};

const note: CreditNote = {
  id: 'c1',
  number: 'CN-0001',
  issueDate: '2026-10-02',
  subtotal: 100,
  vat: 5,
  total: 105,
  rebilled: false,
  invoiceId: 'i1',
  invoiceNumber: 'INV-0042',
  familyId: 'f1',
  reason: 'Lesson cancelled by the tutor <b>',
  vatRate: 0.05,
  lines: [{ description: 'Maths lesson', invoiceLine: 0, net: 100, vat: 5 }],
  createdAt: '2026-10-02T10:00:00Z',
};

describe('tax invoice', () => {
  const html = invoiceHTML(invoice, family, settings);

  it('is titled Tax Invoice with both TRNs and the date of supply', () => {
    expect(html).toContain('Tax Invoice');
    expect(html).toContain('TRN 100123456700003');
    expect(html).toContain('TRN 100999888700003');
    expect(html).toContain('Elite Education FZ-LLC');
    expect(html).toContain('Office 12<br>Dubai Knowledge Park');
    expect(html).toContain('Tower 1, Business Bay');
    expect(html).toContain('Date of supply');
    expect(html).toContain(formatDate('2026-09-15'));
  });

  it('shows per-line VAT and gross and the AED totals', () => {
    // 2 x 400 = 800 net, 40 VAT, 840 gross; 250 net, 12.50 VAT, 262.50 gross.
    expect(html).toContain('AED 800.00');
    expect(html).toContain('AED 40.00');
    expect(html).toContain('AED 840.00');
    expect(html).toContain('AED 12.50');
    expect(html).toContain('AED 262.50');
    expect(html).toContain('5%');
    expect(html).toContain('Total excluding VAT');
    expect(html).toContain('AED 1,050.00');
    expect(html).toContain('VAT at 5%');
    expect(html).toContain('AED 52.50');
    expect(html).toContain('Total including VAT (AED)');
    expect(html).toContain('AED 1,102.50');
    expect(html).toContain('Credited');
    expect(html).toContain('AED 105.00');
    expect(html).toContain('Balance due');
    // 1,102.50 - 105 - 500
    expect(html).toContain('AED 497.50');
    expect(html).toContain('Registered in Dubai.');
    expect(html).toContain(BANK);
  });

  it('is a plain Invoice without a TRN', () => {
    const plain = invoiceHTML(invoice, family, { ...settings, trn: undefined });
    expect(plain).toContain('Invoice');
    expect(plain).not.toContain('Tax Invoice');
  });

  it('escapes descriptions', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('tax credit note', () => {
  const html = creditNoteHTML(note, invoice, family, settings);

  it('is titled Tax Credit Note and names the original invoice and reason', () => {
    expect(html).toContain('Tax Credit Note');
    expect(html).toContain('CN-0001');
    expect(html).toContain('INV-0042');
    expect(html).toContain('Lesson cancelled by the tutor &lt;b&gt;');
    expect(html).toContain('TRN 100123456700003');
    expect(html).toContain('TRN 100999888700003');
    expect(html).toContain('AED 1,102.50');
  });

  it('shows the credit totals', () => {
    expect(html).toContain('Credit excluding VAT');
    expect(html).toContain('AED 100.00');
    expect(html).toContain('AED 5.00');
    expect(html).toContain('AED 105.00');
  });

  it('never carries bank details', () => {
    expect(html).not.toContain(BANK);
    expect(html).not.toContain('IBAN');
    expect(html).not.toContain('bank transfer');
  });
});

describe('VAT return summary', () => {
  const expenses: Expense[] = [{ id: 'e1', date: '2026-08-01', category: 'Rent', amount: 2100, vatAmount: 100 }];
  const summary = vatSummary(
    { start: '2026-07-01', end: '2026-09-30', label: 'Jul – Sep 2026' },
    { invoices: [invoice], creditNotes: [], expenses, familyName: () => 'Haddad <family>' },
  );
  const html = vatSummaryHTML(summary, settings);

  it('shows output, input and net figures', () => {
    expect(summary.outputVat).toBe(52.5);
    expect(html).toContain('Jul – Sep 2026');
    expect(html).toContain('TRN 100123456700003');
    expect(html).toContain('Output VAT');
    expect(html).toContain('AED 52.50');
    expect(html).toContain('Input VAT');
    expect(html).toContain('AED 100.00');
    // 52.50 - 100 is reclaimable.
    expect(html).toContain('VAT reclaimable');
    expect(html).toContain('AED 47.50');
    expect(html).toContain('INV-0042');
    expect(html).toContain('Haddad &lt;family&gt;');
  });
});
