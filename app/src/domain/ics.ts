import type { Lesson } from './types';

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Build an iCalendar feed for lessons (works with Apple and Google Calendar). */
export function lessonsToICS(
  lessons: Lesson[],
  describe: (lesson: Lesson) => { title: string; description?: string },
  calendarName = 'Elite Education',
  now: Date = new Date(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Elite Education//Tutoring//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escape(calendarName)}`,
  ];
  for (const lesson of lessons) {
    if (lesson.status === 'cancelled' || lesson.status === 'late-cancel') continue;
    const { title, description } = describe(lesson);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${lesson.id}@eliteeducation`,
      `DTSTAMP:${icsDate(now.toISOString())}`,
      `DTSTART:${icsDate(lesson.start)}`,
      `DTEND:${icsDate(lesson.end)}`,
      `SUMMARY:${escape(title)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    const where = lesson.location === 'online' ? lesson.meetingUrl : lesson.address;
    if (where) lines.push(`LOCATION:${escape(where)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
