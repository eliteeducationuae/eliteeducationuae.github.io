import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { MasteryColors } from '@/constants/theme';
import { topicName } from '@/data/curriculum';
import { formatDate } from '@/domain/dates';
import { focusTopics, masteryByTopic, RATING_LABELS, summariseSyllabus, type Syllabus } from '@/domain/progress';
import type { Homework, Lesson, LessonNote, Student, TopicRating } from '@/domain/types';

import { escHtml as esc, pdfDocument, pdfHeader, pdfPill } from './pdf-brand';
import { printHtmlOnWeb } from './print-web';

export interface ReportInput {
  student: Student;
  syllabus: Syllabus;
  ratings: TopicRating[];
  notes: LessonNote[];
  lessons: Lesson[];
  homework: Homework[];
  businessName: string;
}

/** A printable progress report for parents. */
export function progressReportHTML(input: ReportInput, now: Date = new Date()): string {
  const { student, syllabus, ratings, notes, lessons, homework } = input;
  const mastery = masteryByTopic(ratings);
  const summary = summariseSyllabus(syllabus, mastery);
  const focus = focusTopics(mastery, 5);
  const taught = lessons.filter((l) => l.status === 'completed' || l.status === 'no-show');
  const attended = taught.filter((l) => l.status === 'completed').length;
  const hwDone = homework.filter((h) => h.done).length;
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const recent = [...notes]
    .sort((a, b) => (lessonById.get(b.lessonId)?.start ?? '').localeCompare(lessonById.get(a.lessonId)?.start ?? ''))
    .slice(0, 6);

  const unitRows = summary.units
    .map(
      (u) =>
        `<tr><td>${esc(u.unit.name)}</td><td class="r">${u.covered}/${u.total}</td><td class="r">${
          u.covered ? pdfPill(RATING_LABELS[Math.round(u.average)], MasteryColors[Math.round(u.average) - 1]) : pdfPill('Not started')
        }</td></tr>`,
    )
    .join('');
  const subtitle = [syllabus.name, student.school, `Prepared ${formatDate(now)}`].filter(Boolean).join(' · ');

  const body = `${pdfHeader({ meta: 'Progress report', title: student.fullName, subtitle })}
  <div class="stats">
    <div class="stat"><b>${summary.coveragePercent}%</b><span>Syllabus covered</span></div>
    <div class="stat"><b>${summary.masteryPercent}%</b><span>Average mastery</span></div>
    <div class="stat"><b>${attended}/${taught.length}</b><span>Lessons attended</span></div>
    <div class="stat"><b>${homework.length ? Math.round((hwDone / homework.length) * 100) : 0}%</b><span>Homework completed</span></div>
  </div>
  ${student.currentGrade || student.targetGrade ? `<p>${esc(student.fullName)} is currently working at <b>${esc(student.currentGrade ?? '–')}</b>, with a target of <b>${esc(student.targetGrade ?? '–')}</b>.</p>` : ''}
  <h2>Progress by unit</h2>
  <table><tr><th>Unit</th><th class="r">Topics covered</th><th class="r">Mastery</th></tr>${unitRows}</table>
  ${focus.length ? `<h2>Focus for the coming weeks</h2><ul>${focus.map((f) => `<li>${esc(topicName(f.topicId))}: ${RATING_LABELS[f.rating]}</li>`).join('')}</ul>` : ''}
  ${recent.length ? '<h2>Recent lessons</h2>' : ''}
  ${recent
    .map((n) => {
      const l = lessonById.get(n.lessonId);
      return `<p><span class="label">${l ? formatDate(l.start) : ''}</span><br>${esc(n.summary)}</p>`;
    })
    .join('')}`;

  return pdfDocument({ title: `Progress report: ${student.fullName}${input.businessName ? ` | ${input.businessName}` : ''}`, body });
}

export async function shareProgressReport(input: ReportInput) {
  const html = progressReportHTML(input);
  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${input.student.fullName} — progress report` });
  } else {
    await Print.printAsync({ uri });
  }
}
