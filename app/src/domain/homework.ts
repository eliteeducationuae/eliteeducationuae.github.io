import { addDays, relativeDay, toDateKey } from './dates';
import type { Attachment, Homework, HomeworkSubmission, Resource } from './types';

/** Where a piece of homework stands, from the student's point of view. */
export type HomeworkStatus = 'reviewed' | 'submitted' | 'done' | 'overdue' | 'due';

export const HOMEWORK_STATUS_LABEL: Record<HomeworkStatus, { label: string; tone: 'success' | 'gold' | 'neutral' | 'danger' | 'info' }> = {
  reviewed: { label: 'Feedback given', tone: 'success' },
  submitted: { label: 'Handed in', tone: 'info' },
  done: { label: 'Done', tone: 'neutral' },
  overdue: { label: 'Overdue', tone: 'danger' },
  due: { label: 'To do', tone: 'gold' },
};

/** The newest hand-in for a piece of homework, or undefined if none. */
export function latestSubmission(subs: HomeworkSubmission[], homeworkId: string): HomeworkSubmission | undefined {
  let latest: HomeworkSubmission | undefined;
  for (const s of subs) {
    if (s.homeworkId !== homeworkId) continue;
    if (!latest || s.submittedAt > latest.submittedAt) latest = s;
  }
  return latest;
}

/** Status of a piece of homework on a given day (YYYY-MM-DD). */
export function homeworkStatus(hw: Homework, subs: HomeworkSubmission[], today: string): HomeworkStatus {
  const latest = latestSubmission(subs, hw.id);
  if (latest?.feedback) return 'reviewed';
  if (latest) return 'submitted';
  if (hw.done) return 'done';
  if (hw.dueDate.slice(0, 10) < today) return 'overdue';
  return 'due';
}

/**
 * Tidy a typed web address. Adds https:// when no scheme is given; accepts only http and https
 * addresses whose host contains a dot. Returns null for anything else.
 */
export function normaliseLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  // "example.org:8080/x" is a host and port, not a scheme.
  const hostWithPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(trimmed);
  const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  const match = /^(https?):\/\/([^/?#]+)(.*)$/i.exec(candidate);
  if (!match) return null;
  const authority = match[2];
  if (authority.includes('@')) return null;
  const host = authority.replace(/:\d+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  if (host.split('.').some((part) => !part)) return null;
  return `${match[1].toLowerCase()}://${authority}${match[3]}`;
}

/** A link attachment. The address should already have passed normaliseLink. */
export function linkAttachment(url: string, name?: string): Attachment {
  const label = name?.trim() || url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return { kind: 'link', name: label, url };
}

export function fileAttachment(path: string, name: string, mimeType?: string): Attachment {
  return mimeType ? { kind: 'file', name, path, mimeType } : { kind: 'file', name, path };
}

/** Attach a library resource to homework or a hand-in. */
export function resourceAttachment(r: Resource): Attachment {
  const a: Attachment = { kind: r.kind, name: r.title, resourceId: r.id };
  if (r.kind === 'file') a.path = r.path;
  else a.url = r.url;
  if (r.mimeType) a.mimeType = r.mimeType;
  return a;
}

function extension(a: Attachment): string {
  const source = a.path ?? a.name ?? '';
  const dot = source.lastIndexOf('.');
  return dot >= 0 ? source.slice(dot + 1).toLowerCase() : '';
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif']);
const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'rtf', 'txt', 'pages', 'ppt', 'pptx', 'key', 'xls', 'xlsx', 'csv', 'numbers']);

export function isImageAttachment(a: Attachment): boolean {
  if (a.kind !== 'file') return false;
  if (a.mimeType?.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(extension(a));
}

export function attachmentKindLabel(a: Attachment): 'Photo' | 'PDF' | 'Document' | 'Link' | 'File' {
  if (a.kind === 'link') return 'Link';
  if (isImageAttachment(a)) return 'Photo';
  const ext = extension(a);
  const mime = a.mimeType?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (DOCUMENT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime.includes('word') || mime.includes('document') || mime.includes('presentation') || mime.includes('spreadsheet')) {
    return 'Document';
  }
  return 'File';
}

/** Folder in the classwork bucket: a student's own folder, or the shared resource library. */
export function classworkFolder(target: { studentId: string } | 'resources'): string {
  return target === 'resources' ? 'resources' : `students/${target.studentId}`;
}

/** Case-insensitive filter of the resource library. The query matches title, description and tags. */
export function filterResources(list: Resource[], filter: { subject?: string; level?: string; query?: string }): Resource[] {
  const subject = filter.subject?.trim().toLowerCase();
  const level = filter.level?.trim().toLowerCase();
  const query = filter.query?.trim().toLowerCase();
  return list.filter((r) => {
    if (subject && (r.subject ?? '').trim().toLowerCase() !== subject) return false;
    if (level && (r.level ?? '').trim().toLowerCase() !== level) return false;
    if (query) {
      const haystack = [r.title, r.description ?? '', ...r.tags].join('\n').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function uniqueSorted(values: (string | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v?.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The subjects and levels present in the library, for filter chips. */
export function resourceFacets(list: Resource[]): { subjects: string[]; levels: string[] } {
  return { subjects: uniqueSorted(list.map((r) => r.subject)), levels: uniqueSorted(list.map((r) => r.level)) };
}

/** Comma-separated tags: trimmed, empties dropped, duplicates (ignoring case) removed. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** "Subject · Level · Curriculum", leaving out a curriculum that merely repeats the level. */
export function resourceMeta(r: Pick<Resource, 'subject' | 'level' | 'curriculum'>): string {
  const subject = r.subject?.trim();
  const level = r.level?.trim();
  let curriculum = r.curriculum?.trim();
  if (curriculum && level && curriculum.toLowerCase() === level.toLowerCase()) curriculum = undefined;
  return [subject, level, curriculum].filter(Boolean).join(' · ');
}

/** "Due today", "Due tomorrow", "Due yesterday" or "Due Mon 5 Oct", for a YYYY-MM-DD due date. */
export function dueLabel(dueDate: string, now: Date = new Date()): string {
  const day = relativeDay(`${dueDate.slice(0, 10)}T12:00:00`, now);
  return `Due ${['Today', 'Tomorrow', 'Yesterday'].includes(day) ? day.toLowerCase() : day}`;
}

/** Quick due-date choices for the homework form. "Next lesson" is offered when one is booked. */
export function dueDateChoices(now: Date, nextLesson?: string): { label: string; date: string }[] {
  const choices = [
    { label: 'Tomorrow', date: toDateKey(addDays(now, 1)) },
    { label: 'In 3 days', date: toDateKey(addDays(now, 3)) },
    { label: 'In a week', date: toDateKey(addDays(now, 7)) },
    { label: 'In two weeks', date: toDateKey(addDays(now, 14)) },
  ];
  const next = nextLesson ? toDateKey(new Date(nextLesson)) : undefined;
  if (next && next > toDateKey(now)) choices.unshift({ label: 'Next lesson', date: next });
  return choices;
}

/** The notice shown when a lesson was recorded but some homework details or attachments were not saved. */
export function lessonHomeworkWarning(titles: string[]): string {
  const named = titles.filter(Boolean).map((t) => `"${t}"`);
  const which = named.length ? ` for ${named.join(', ')}` : '';
  return `The lesson has been recorded, but the details or attachments${which} could not be saved. Please open the homework and add them there.`;
}

/**
 * True when removing this attachment should also delete its stored file: a file uploaded while this
 * form was open, not a library resource, which homework elsewhere may share.
 */
export function shouldDiscardUpload(a: Attachment, uploadedNow: ReadonlySet<string>): boolean {
  return a.kind === 'file' && !a.resourceId && !!a.path && uploadedNow.has(a.path);
}
