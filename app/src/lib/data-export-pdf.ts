/**
 * A readable PDF summary of the signed-in person's data export, in the Elite Education document style.
 * Pure (no React Native or Expo imports) so it can be unit tested in Node.
 */
import { formatAED, invoiceTotals } from '@/domain/billing';
import { formatDate, formatDay, formatTime } from '@/domain/dates';
import type { DataExport, Invoice } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';

/** The list sections of an export, with the names shown in the summary. */
export const EXPORT_SECTIONS: { key: string; label: string }[] = [
  { key: 'students', label: 'Student profiles' },
  { key: 'enrolments', label: 'Subjects' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'lessonNotes', label: 'Lesson notes' },
  { key: 'homework', label: 'Homework' },
  { key: 'homeworkSubmissions', label: 'Homework handed in' },
  { key: 'reports', label: 'Reports' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'payments', label: 'Payments' },
  { key: 'packages', label: 'Lesson packages' },
  { key: 'messages', label: 'Messages' },
  { key: 'lessonRequests', label: 'Lesson requests' },
  { key: 'availability', label: 'Weekly availability' },
  { key: 'tutorInvoices', label: 'Tutor invoices' },
  { key: 'familyContacts', label: 'Family contacts' },
  { key: 'creditNotes', label: 'Credit notes' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'agreedPrices', label: 'Agreed prices' },
  { key: 'admissions', label: 'Admissions advisory' },
  { key: 'lessonPlans', label: 'Lesson plans' },
  { key: 'tutorPay', label: 'Pay rates' },
  { key: 'handovers', label: 'Handover packs' },
  { key: 'tutorDocuments', label: 'Vetting documents' },
  { key: 'vettingOverrides', label: 'Vetting permissions' },
  { key: 'handbookAcknowledgements', label: 'Handbook acknowledgements' },
];

const ROLE_NAMES: Record<string, string> = { admin: 'Administrator', tutor: 'Tutor', parent: 'Parent', student: 'Student', accountant: 'Accountant' };

const STATUS_NAMES: Record<string, string> = { draft: 'Draft', sent: 'Awaiting payment', paid: 'Paid', void: 'Cancelled' };

const list = (data: DataExport, key: string): unknown[] => (Array.isArray(data[key]) ? (data[key] as unknown[]) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Counts per section, including empty ones, in display order. */
export function exportCounts(data: DataExport): { label: string; count: number }[] {
  return EXPORT_SECTIONS.map((s) => ({ label: s.label, count: list(data, s.key).length }));
}

/** Never more than the last four characters of an account number. */
function lastFour(v: unknown): string {
  return text(v).replace(/\s+/g, '').slice(-4);
}

interface LessonLike {
  start?: string;
  end?: string;
  subject?: string;
  status?: string;
  location?: string;
}

export function dataExportHTML(data: DataExport): string {
  const account = data.account ?? {};
  const exportedAt = text(data.exportedAt) || new Date(0).toISOString();
  const role = ROLE_NAMES[text(account.role)] ?? text(account.role);

  const accountRows = [
    ['Name', text(account.fullName)],
    ['Email', text(account.email)],
    ['Telephone', text(account.phone)],
    ['Account type', role],
    ['Family', data.family ? text((data.family as Record<string, unknown>).name) : ''],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td class="label">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');

  const counts = exportCounts(data)
    .filter((c) => c.count > 0)
    .map((c) => `<tr><td>${esc(c.label)}</td><td class="r">${c.count}</td></tr>`)
    .join('');

  const upcoming = (list(data, 'lessons') as LessonLike[])
    .filter((l) => l.start && l.start > exportedAt && (l.status ?? 'scheduled') === 'scheduled')
    .sort((a, b) => text(a.start).localeCompare(text(b.start)))
    .slice(0, 20)
    .map(
      (l) =>
        `<tr><td>${esc(formatDay(text(l.start)))} ${esc(formatDate(text(l.start)).split(' ').pop() ?? '')}</td><td>${esc(formatTime(text(l.start)))}</td><td>${esc(text(l.subject) || 'Lesson')}</td><td>${esc(l.location === 'in-person' ? 'In person' : 'Online')}</td></tr>`,
    )
    .join('');

  const invoices = (list(data, 'invoices') as Invoice[])
    .filter((i) => i && Array.isArray(i.items))
    .map((i) => {
      const t = invoiceTotals({ items: i.items, vatRate: Number(i.vatRate) || 0, payments: Array.isArray(i.payments) ? i.payments : [] });
      return `<tr><td>${esc(text(i.number))}</td><td>${esc(i.issueDate ? formatDate(i.issueDate) : '')}</td><td class="r">${esc(formatAED(t.total))}</td><td>${esc(STATUS_NAMES[i.status] ?? text(i.status))}</td></tr>`;
    })
    .join('');

  const pd = data.paymentDetails;
  const bank = pd
    ? `<h2>Payment details</h2><p>${esc(text(pd.accountName))}${pd.bankName ? `, ${esc(text(pd.bankName))}` : ''}${
        pd.ibanLast4 ? `<br><span class="muted">Account ending ${esc(lastFour(pd.ibanLast4))}</span>` : ''
      }</p>`
    : '';

  const body = `${pdfHeader({ meta: 'Your data', title: 'Data summary', subtitle: `Prepared ${formatDate(exportedAt)}` })}
  <h2>Your account</h2>
  <table>${accountRows}</table>
  <h2>What we hold</h2>
  ${counts ? `<table><tr><th>Record</th><th class="r">Number</th></tr>${counts}</table>` : '<p class="muted">We hold no records beyond your account details.</p>'}
  ${upcoming ? `<h2>Upcoming lessons</h2><table><tr><th>Date</th><th>Time</th><th>Subject</th><th>Where</th></tr>${upcoming}</table>` : ''}
  ${invoices ? `<h2>Invoices</h2><table><tr><th>Number</th><th>Issued</th><th class="r">Total</th><th>Status</th></tr>${invoices}</table>` : ''}
  ${bank}
  <div class="panel"><p>This summary accompanies the full download of your data in JSON format. To ask a question about your data, please contact hello@eliteeducation.me.</p></div>`;
  return pdfDocument({ title: 'Your data with Elite Education', body });
}
