/** Brand template for printable documents, and the four documents that use it (Expo and React Native mocked). */
import type { Family, Invoice, PaymentDetails, Settings, Student, StudentReport, Tutor, TutorInvoice } from '@/domain/types';
import { SYLLABUSES } from '@/data/curriculum';
import { BRAND_PDF_CSS, PDF_COLORS, PDF_FOOTER_TEXT, contrastRatio, escHtml, pdfDocument, pdfHeader, pdfPill, pillTextColor } from '../pdf-brand';
import { LOGO_BLACK_DATA_URI } from '../logo-data';
import { invoiceHTML } from '../invoice-pdf';
import { progressReportHTML } from '../report';
import { studentReportHTML } from '../student-report-pdf';
import { tutorInvoiceHTML } from '../tutor-invoice-pdf';

// ts-jest hoists these above the imports.
jest.mock('expo-print', () => ({}), { virtual: true });
jest.mock('expo-sharing', () => ({}), { virtual: true });
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }), { virtual: true });
// The real mastery palette (palette.ts is plain data), so the legibility test follows any change to it.
jest.mock('@/constants/theme', () => ({ MasteryColors: jest.requireActual('@/constants/palette').MasteryColors }));

// The pre-brand navy, gold and slate colours, written without the leading hash so they never match a source sweep.
const OLD_HEX = ['1a365d', 'd69e2e', '64748b', '1a202c', 'e2e8f0', 'f4f6fb'].map((h) => `#${h}`);

describe('pdf-brand', () => {
  const doc = pdfDocument({ title: 'Progress report <script>alert(1)</script>', body: pdfHeader({ title: '<script>x</script>', subtitle: 'Term 1', meta: 'Report' }) });

  it('is a complete branded document', () => {
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain(PDF_FOOTER_TEXT);
    expect(PDF_FOOTER_TEXT).toBe('Elite Education | eliteeducation.me');
    expect(doc).toContain('Georgia');
    expect(doc).toContain('Calibri');
    expect(doc).toContain('Carlito');
    expect(doc).toContain(LOGO_BLACK_DATA_URI);
    expect(LOGO_BLACK_DATA_URI.startsWith('data:image/png;base64,')).toBe(true);
    expect(BRAND_PDF_CSS).toMatch(/1\.5px solid #C9A84C/);
    expect(BRAND_PDF_CSS).toContain('print-color-adjust: exact');
    expect(BRAND_PDF_CSS).toContain('@page');
  });

  it('escapes user text in titles', () => {
    expect(doc).not.toContain('<script>');
    expect(doc).toContain('&lt;script&gt;');
    expect(escHtml(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;');
  });

  it('contains none of the old navy and gold colours', () => {
    const lower = doc.toLowerCase();
    for (const hex of OLD_HEX) expect(lower).not.toContain(hex);
  });

  it('keeps pill and body text legible', () => {
    const { MasteryColors } = jest.requireMock('@/constants/theme') as { MasteryColors: string[] };
    expect(MasteryColors[0]).toBe('#A84E44');
    for (const bg of [...MasteryColors, PDF_COLORS.neutralPill]) {
      expect(contrastRatio(pillTextColor(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(pdfPill('Not started')).toContain(`background:${PDF_COLORS.neutralPill}`);
    expect(contrastRatio(PDF_COLORS.muted, PDF_COLORS.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PDF_COLORS.muted, PDF_COLORS.ivory)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('printable documents', () => {
  const EVIL = '<script>alert(1)</script>';

  const student = { id: 's1', familyId: 'f1', fullName: `Amira ${EVIL}`, curriculum: 'IB', syllabusId: SYLLABUSES[0].id } as Student;
  const tutor = { id: 't1', fullName: 'Craig O’Brien' } as Tutor;
  const family = { id: 'f1', parentName: 'Mrs Haddad', email: 'parent@example.com' } as Family;
  const settings = { businessName: 'Elite Education', vatRate: 0, bankDetails: 'Emirates NBD, IBAN AE00 1234' } as Settings;
  const invoice: Invoice = {
    id: 'i1', number: 'INV-0001', familyId: 'f1', issueDate: '2026-10-01', dueDate: '2026-10-15', status: 'sent', vatRate: 0, payments: [],
    items: [{ description: `Lessons ${EVIL}`, quantity: 2, unitPrice: 400 }],
  };
  const tutorInvoice = {
    id: 'ti1', createdAt: '2026-10-01', tutorId: 't1', number: 'TI-0001', periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'submitted',
    items: [{ description: 'Lessons', quantity: 3, unitPrice: 150 }],
  } as TutorInvoice;
  const bank: PaymentDetails = { tutorId: 't1', accountName: 'C O’Brien', bankName: 'Bank', iban: 'AE070331234567890123456' };
  const report = { id: 'r1', cycleId: 'c1', studentId: 's1', tutorId: 't1', subject: `Chemistry ${EVIL}`, attainment: '6', strengths: `Good ${EVIL}` } as StudentReport;
  const topicName = (id: string) => (id === SYLLABUSES[0].units[0].topics[0].id ? `Named topic ${EVIL}` : id);

  const docs: Record<string, string> = {
    progress: progressReportHTML(
      {
        student,
        syllabus: SYLLABUSES[0],
        ratings: [{ id: 'tr1', studentId: 's1', lessonId: 'l1', topicId: SYLLABUSES[0].units[0].topics[0].id, rating: 2, ratedAt: '2026-10-01T10:00:00Z' }],
        notes: [],
        lessons: [],
        homework: [],
        businessName: 'Elite Education',
        topicName,
        subject: `IGCSE Chemistry ${EVIL}`,
      },
      new Date('2026-10-04T10:00:00Z'),
    ),
    invoice: invoiceHTML(invoice, family, settings),
    report: studentReportHTML(report, student, tutor, undefined, 'Elite Education'),
    tutorInvoice: tutorInvoiceHTML(tutorInvoice, tutor, bank, 'Elite Education'),
  };

  describe.each(Object.entries(docs))('%s document', (_name, html) => {
    it('uses the brand template', () => {
      expect(html).toContain(PDF_FOOTER_TEXT);
      expect(html).toContain('data:image/png;base64,');
      expect(html).toContain('Georgia');
      for (const hex of OLD_HEX) expect(html.toLowerCase()).not.toContain(hex);
    });
    it('escapes user data', () => {
      expect(html).not.toContain(EVIL);
    });
  });

  it('prints bank details only on the family invoice, and only a masked IBAN on tutor invoices', () => {
    expect(docs.invoice).toContain('Emirates NBD');
    expect(docs.progress).not.toContain('Emirates NBD');
    expect(docs.report).not.toContain('Emirates NBD');
    expect(docs.tutorInvoice).not.toContain('AE070331234567890123456');
  });

  it('names the subject in the heading, escaped', () => {
    expect(docs.progress).toContain('IGCSE Chemistry &lt;script&gt;alert(1)&lt;/script&gt; progress');
    expect(docs.report).toContain('Chemistry &lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('names focus topics through the lookup it is given, escaped', () => {
    expect(docs.progress).toContain('Named topic &lt;script&gt;');
  });

  it('shows unstarted units with a neutral pill', () => {
    expect(docs.progress).toContain('Not started');
  });
});
