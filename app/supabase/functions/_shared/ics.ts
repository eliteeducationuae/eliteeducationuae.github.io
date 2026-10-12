// Pure helpers for the ics calendar feed, unit-tested with Jest.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and Jest.

/**
 * Escapes text for an iCalendar property value (RFC 5545 3.3.11). Every kind of line break becomes \n, so text a person
 * typed (a lesson subject, an address, a meeting link) can never start a new property such as ATTENDEE or URL.
 */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, '\\n')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/** Whose lessons a feed shows: everything (admins), one tutor's, one family's, one student's, or nothing. */
export type FeedScope = 'all' | 'tutor' | 'parent' | 'student' | 'none';

/**
 * The lessons a feed token may show, from its profile. Only an admin sees every lesson. Any other role (for example
 * the accountant, who never sees lessons in the app) or a profile missing its link sees none.
 */
export function feedScope(p: { role?: string | null; tutor_id?: string | null; family_id?: string | null; student_id?: string | null }): FeedScope {
  if (p.role === 'admin') return 'all';
  if (p.role === 'tutor' && p.tutor_id) return 'tutor';
  if (p.role === 'parent' && p.family_id) return 'parent';
  if (p.role === 'student' && p.student_id) return 'student';
  return 'none';
}

/** A feed token is the profile's ics_token, a random UUID (122 random bits). Anything else is refused unread. */
export function isFeedToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}
