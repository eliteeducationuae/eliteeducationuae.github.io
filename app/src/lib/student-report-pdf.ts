import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { EFFORT_LABELS, PROGRESS_LABELS } from '@/domain/reports';
import { formatDate } from '@/domain/dates';
import type { ReportCycle, Student, StudentReport, Tutor } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';
import { printHtmlOnWeb } from './print-web';

const para = (s?: string) => (s ? esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') : '');

/** A published end-of-term report as a printable page for families. */
export function studentReportHTML(r: StudentReport, student: Student, tutor: Tutor | undefined, cycle: ReportCycle | undefined, businessName: string): string {
  const subject = r.subject?.trim();
  const subtitle = [subject ? undefined : student.curriculum, tutor ? `Tutor: ${tutor.fullName}` : '', r.publishedAt ? formatDate(r.publishedAt) : ''].filter(Boolean).join(' · ');
  const grades = [
    r.attainment ? `<div class="stat"><b>${esc(r.attainment)}</b><span>Working at</span></div>` : '',
    r.effort ? `<div class="stat"><b>${EFFORT_LABELS[r.effort]}</b><span>Effort</span></div>` : '',
    r.progress ? `<div class="stat"><b>${PROGRESS_LABELS[r.progress]}</b><span>Progress</span></div>` : '',
  ].join('');
  const body = `${pdfHeader({ meta: cycle?.name ?? 'Progress report', title: subject ? `${student.fullName} · ${subject}` : student.fullName, subtitle })}
  ${grades ? `<div class="stats">${grades}</div>` : ''}
  ${r.strengths ? `<h2>Strengths</h2>${para(r.strengths)}` : ''}
  ${r.nextSteps ? `<h2>Next steps</h2>${para(r.nextSteps)}` : ''}
  ${r.comment ? `<h2>Overall</h2>${para(r.comment)}` : ''}`;
  return pdfDocument({ title: `Report: ${student.fullName}${subject ? ` · ${subject}` : ''}${businessName ? ` | ${businessName}` : ''}`, body });
}

export async function shareStudentReport(...args: Parameters<typeof studentReportHTML>) {
  const html = studentReportHTML(...args);
  if (Platform.OS === 'web') return printHtmlOnWeb(html);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${args[1].fullName}${args[0].subject ? ` · ${args[0].subject}` : ''} report` });
  else await Print.printAsync({ uri });
}
