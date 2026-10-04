import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { EFFORT_LABELS, PROGRESS_LABELS } from '@/domain/reports';
import { formatDate } from '@/domain/dates';
import type { ReportCycle, Student, StudentReport, Tutor } from '@/domain/types';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const para = (s?: string) => (s ? esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') : '');

/** A published end-of-term report as a printable page for families. */
export function studentReportHTML(r: StudentReport, student: Student, tutor: Tutor | undefined, cycle: ReportCycle | undefined, businessName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report — ${esc(student.fullName)}</title><style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a202c;margin:40px;line-height:1.5}
  h1{color:#1a365d;margin:0}h2{color:#1a365d;font-size:16px;margin-top:24px;border-bottom:2px solid #d69e2e;padding-bottom:4px}
  .brand{color:#d69e2e;font-weight:700}.muted{color:#64748b}
  .grades{display:flex;gap:12px;margin-top:16px}.g{flex:1;background:#f4f6fb;border-radius:10px;padding:12px}
  .g b{display:block;font-size:18px;color:#1a365d}</style></head><body>
  <div class="brand">${esc(businessName)}</div>
  <h1>${esc(student.fullName)}</h1>
  <div class="muted">${esc(cycle?.name ?? 'Progress report')} · ${esc(student.curriculum)}${tutor ? ` · Tutor: ${esc(tutor.fullName)}` : ''}${r.publishedAt ? ` · ${formatDate(r.publishedAt)}` : ''}</div>
  <div class="grades">
    ${r.attainment ? `<div class="g"><b>${esc(r.attainment)}</b>Working at</div>` : ''}
    ${r.effort ? `<div class="g"><b>${EFFORT_LABELS[r.effort]}</b>Effort</div>` : ''}
    ${r.progress ? `<div class="g"><b>${PROGRESS_LABELS[r.progress]}</b>Progress</div>` : ''}
  </div>
  ${r.strengths ? `<h2>Strengths</h2>${para(r.strengths)}` : ''}
  ${r.nextSteps ? `<h2>Next steps</h2>${para(r.nextSteps)}` : ''}
  ${r.comment ? `<h2>Overall</h2>${para(r.comment)}` : ''}
  </body></html>`;
}

export async function shareStudentReport(...args: Parameters<typeof studentReportHTML>) {
  const html = studentReportHTML(...args);
  if (Platform.OS === 'web') return Print.printAsync({ html });
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${args[1].fullName} — report` });
  else await Print.printAsync({ uri });
}
