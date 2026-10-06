import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import {
  CASE_KIND_LABELS,
  keyDateHeading,
  keyDateTimeLabel,
  typographic,
  type AdmissionsCase,
  type AdmissionsKeyDate,
  type AdmissionsTarget,
  type AdvisoryUpdate,
} from '@/domain/admissions';
import { formatDate } from '@/domain/dates';
import type { Student } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader } from './pdf-brand';
import { printHtmlOnWeb } from './print-web';

const para = (s?: string) =>
  s
    ? esc(s)
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('')
    : '';

/** '6 Oct 2026' for a YYYY-MM-DD key, read as a local date. */
function dateKeyLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return formatDate(new Date(y, (m || 1) - 1, d || 1));
}

/** An advisory update as a printable letter for the family, in the Elite Education style. */
export function advisoryUpdateHTML(
  update: AdvisoryUpdate,
  caseRow: Pick<AdmissionsCase, 'kind' | 'title'>,
  student: Pick<Student, 'fullName'>,
  adviserName: string | undefined,
  businessName: string,
  upcoming: AdmissionsKeyDate[],
  targets: AdmissionsTarget[],
): string {
  const sent = update.publishedAt ?? update.approvedAt ?? update.submittedAt ?? update.createdAt;
  const subtitle = [
    CASE_KIND_LABELS[caseRow.kind],
    update.period,
    adviserName ? (adviserName === 'Elite Education' ? 'Led by the Elite Education office' : `Adviser: ${adviserName}`) : '',
    sent ? formatDate(sent) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const rows = upcoming
    .map((d) => {
      const target = d.targetId ? targets.find((t) => t.id === d.targetId) : undefined;
      const when = `${dateKeyLabel(d.dueOn)}${d.time ? ` at ${keyDateTimeLabel(d.time)}` : ''}`;
      return `<tr><td>${esc(when)}</td><td>${esc(keyDateHeading(d))}</td><td>${esc(target?.institution ?? '')}</td></tr>`;
    })
    .join('');
  const table = rows
    ? `<h2>Key dates at a glance</h2><table><thead><tr><th>Date</th><th>Key date</th><th>Institution</th></tr></thead><tbody>${rows}</tbody></table>`
    : '';
  const body = `${pdfHeader({ meta: 'Admissions advisory', title: `${student.fullName} · ${typographic(update.title)}`, subtitle })}
  <p class="label">${esc(caseRow.title)}</p>
  ${para(typographic(update.body))}
  ${table}`;
  return pdfDocument({ title: `${update.title}: ${student.fullName}${businessName ? ` | ${businessName}` : ''}`, body });
}

/** Print (web) or share as a PDF (iOS and Android). */
export async function shareAdvisoryUpdate(...args: Parameters<typeof advisoryUpdateHTML>) {
  const html = advisoryUpdateHTML(...args);
  if (Platform.OS === 'web') return printHtmlOnWeb(html);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${args[2].fullName} · ${args[0].title}` });
  } else await Print.printAsync({ uri });
}
