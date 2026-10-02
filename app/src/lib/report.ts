import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { MasteryColors } from '@/constants/theme';
import { topicName } from '@/data/curriculum';
import { formatDate } from '@/domain/dates';
import { focusTopics, masteryByTopic, RATING_LABELS, summariseSyllabus, type Syllabus } from '@/domain/progress';
import type { Homework, Lesson, LessonNote, Student, TopicRating } from '@/domain/types';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

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
      (u) => `<tr><td>${esc(u.unit.name)}</td><td>${u.covered}/${u.total}</td><td>
        <span class="pill" style="background:${u.covered ? MasteryColors[Math.round(u.average) - 1] : '#e2e8f0'}">
        ${u.covered ? RATING_LABELS[Math.round(u.average)] : 'Not started'}</span></td></tr>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Progress report — ${esc(student.fullName)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#1a202c; margin:32px; }
  h1 { color:#1a365d; margin:0 } h2 { color:#1a365d; font-size:16px; margin-top:28px; border-bottom:2px solid #d69e2e; padding-bottom:4px }
  .brand { color:#d69e2e; font-weight:700 } .muted { color:#64748b }
  .stats { display:flex; gap:12px; margin-top:16px } .stat { flex:1; background:#f4f6fb; border-radius:10px; padding:12px }
  .stat b { display:block; font-size:22px; color:#1a365d }
  table { width:100%; border-collapse:collapse; font-size:13px } td { padding:6px 4px; border-bottom:1px solid #e2e8f0 }
  .pill { display:inline-block; padding:2px 8px; border-radius:99px; color:#fff; font-size:11px; font-weight:700 }
  .note { margin:10px 0; font-size:13px } .note b { color:#1a365d }
</style></head><body>
  <div class="brand">${esc(input.businessName)}</div>
  <h1>${esc(student.fullName)}</h1>
  <div class="muted">${esc(syllabus.name)}${student.school ? ` · ${esc(student.school)}` : ''} · Report generated ${formatDate(now)}</div>
  <div class="stats">
    <div class="stat"><b>${summary.coveragePercent}%</b>Syllabus covered</div>
    <div class="stat"><b>${summary.masteryPercent}%</b>Average mastery</div>
    <div class="stat"><b>${attended}/${taught.length}</b>Lessons attended</div>
    <div class="stat"><b>${homework.length ? Math.round((hwDone / homework.length) * 100) : 0}%</b>Homework done</div>
  </div>
  ${student.currentGrade || student.targetGrade ? `<p>Working at <b>${esc(student.currentGrade ?? '–')}</b>, target <b>${esc(student.targetGrade ?? '–')}</b>.</p>` : ''}
  <h2>Progress by unit</h2><table>${unitRows}</table>
  ${focus.length ? `<h2>Focus for the next few weeks</h2><ul>${focus.map((f) => `<li>${esc(topicName(f.topicId))} — ${RATING_LABELS[f.rating]}</li>`).join('')}</ul>` : ''}
  <h2>Recent lessons</h2>
  ${recent
    .map((n) => {
      const l = lessonById.get(n.lessonId);
      return `<div class="note"><b>${l ? formatDate(l.start) : ''}</b> — ${esc(n.summary)}</div>`;
    })
    .join('')}
</body></html>`;
}

export async function shareProgressReport(input: ReportInput) {
  const html = progressReportHTML(input);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${input.student.fullName} — progress report` });
  } else {
    await Print.printAsync({ uri });
  }
}
