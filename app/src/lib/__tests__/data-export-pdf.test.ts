import type { DataExport } from '@/domain/types';

import { dataExportHTML, exportCounts } from '../data-export-pdf';

const base: DataExport = {
  format: 'elite-education-export/1',
  exportedAt: '2026-10-04T08:00:00.000Z',
  account: { id: 'u1', role: 'parent', fullName: 'Fatima <script>alert(1)</script>', email: 'fatima@example.com', phone: null },
  family: { id: 'f1', name: 'Al Mansoori & Sons' },
  tutor: null,
  paymentDetails: null,
  students: [{ id: 's1' }, { id: 's2' }],
  lessons: [
    { id: 'l1', start: '2026-10-10T12:00:00.000Z', end: '2026-10-10T13:00:00.000Z', subject: 'Chemistry <b>HL</b>', status: 'scheduled', location: 'online' },
    { id: 'l2', start: '2026-09-10T12:00:00.000Z', end: '2026-09-10T13:00:00.000Z', subject: 'Past lesson', status: 'completed', location: 'online' },
  ],
  invoices: [
    { id: 'i1', number: 'INV-0001', familyId: 'f1', issueDate: '2026-09-01', dueDate: '2026-09-15', status: 'paid', items: [{ description: 'x', quantity: 2, unitPrice: 300 }], vatRate: 0.05, payments: [] },
  ],
  payments: [],
};

describe('dataExportHTML', () => {
  it('escapes everything taken from the export', () => {
    const html = dataExportHTML(base);
    expect(html).not.toContain('<script>');
    expect(html).toContain('Fatima &lt;script&gt;');
    expect(html).toContain('Al Mansoori &amp; Sons');
    expect(html).toContain('Chemistry &lt;b&gt;HL&lt;/b&gt;');
  });

  it('lists counts, upcoming lessons only, and invoices with their status', () => {
    const html = dataExportHTML(base);
    expect(html).toContain('Student profiles</td><td class="r">2');
    expect(html).toContain('Upcoming lessons');
    expect(html).not.toContain('Past lesson');
    expect(html).toContain('INV-0001');
    expect(html).toContain('AED 630');
    expect(html).toContain('Paid');
    expect(html).toContain('Elite Education | eliteeducation.me');
  });

  it('never shows more than the last four digits of a bank account', () => {
    const iban = 'AE070331234567890123456';
    const data = {
      ...base,
      account: { ...base.account, role: 'tutor' },
      paymentDetails: { accountName: 'Sarah Khan', bankName: 'Emirates NBD', ibanLast4: iban, iban } as DataExport['paymentDetails'],
    };
    const html = dataExportHTML(data);
    expect(html).toContain('Account ending 3456');
    expect(html).not.toContain(iban);
    expect(html).not.toContain(iban.slice(4, 14));
  });

  it('counts every section, including empty ones', () => {
    const counts = exportCounts(base);
    expect(counts.find((c) => c.label === 'Lessons')?.count).toBe(2);
    expect(counts.find((c) => c.label === 'Messages')?.count).toBe(0);
  });
});
