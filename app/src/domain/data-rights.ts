import { toDateKey } from './dates';
import type { DeletionRequest, DeletionSummary, FamilyContact, Role } from './types';

/**
 * Data rights: what deleting an account removes and keeps, the typed confirmation, and file names for exports.
 * Mirrors the delete-account Edge Function and the admin deletion request functions.
 */

export interface DeletionConsequences {
  removed: string[];
  kept: string[];
  note: string;
}

/** Shown when the only administrator tries to delete their account (the server says the same). */
export const LAST_ADMIN_MESSAGE =
  'You are the only administrator. Please appoint another administrator before deleting this account.';

/** The word a person types to confirm deletion. */
export const DELETE_CONFIRM_WORD = 'DELETE';

export function deletionConsequences(role: Role): DeletionConsequences {
  switch (role) {
    case 'parent':
      return {
        removed: [
          'Your login and contact details',
          "Your children’s logins and any other parent login for your family",
          'The other contacts recorded for your family',
          "Your children's profiles",
          'Admissions advisory records, letters and documents',
          'Lesson notes, homework and submissions',
          'Lesson addresses and meeting links',
          'Your messages with Elite Education',
          'All future lessons, which will be cancelled',
        ],
        kept: [
          'Lesson dates and invoices, without contact details',
          'Payment records, credit notes and refunds, kept for the period UAE law requires',
        ],
        note: 'Everything else is removed straight away and cannot be recovered.',
      };
    case 'tutor':
      return {
        removed: [
          'Your login and contact details',
          'Your weekly availability',
          'Your bank details',
          'Your Google Calendar link',
          'Your police clearance and other vetting documents',
        ],
        kept: ['Your invoices and lesson history, kept for tax and pay records'],
        note: 'Elite Education will reassign your upcoming lessons to another tutor. Everything else is removed straight away and cannot be recovered.',
      };
    case 'student':
      return {
        removed: ['Your login'],
        kept: [
          "Messages you sent stay in your family’s conversation without your name",
          "Your lessons, notes and reports, which stay with your parent’s account",
        ],
        note: 'Your parent can ask us to remove these records at any time.',
      };
    case 'admin':
      return {
        removed: ['Your login and contact details', 'Your Google Calendar link'],
        kept: ['Business records, invoices and lesson history'],
        note: 'An administrator account can only be deleted when another administrator remains.',
      };
    default:
      // Roles added later (for example an accountant) lose their login; business records stay.
      return {
        removed: ['Your login and contact details'],
        kept: ['Business records, invoices and lesson history'],
        note: 'Your login is removed. Business records are kept for the period UAE law requires.',
      };
  }
}

/**
 * Whether a parent login closing its own account closes only that login, not the family. Mirrors
 * account_closes_own_login_only on the server: the login belongs to a contact who is not the family's main contact, and
 * another contact of the family can still sign in. The main contact, or the family's last sign-in contact, closes the
 * whole family.
 */
export function closesOwnLoginOnly(contacts: FamilyContact[], profileId: string): boolean {
  const mine = contacts.find((c) => c.profileId === profileId);
  if (!mine || mine.isPrimary) return false;
  return contacts.some((c) => c.id !== mine.id && c.canLogIn);
}

/** Shown on Delete my account to a family contact who is not the main contact. */
export const CONTACT_LOGIN_NOTE = "This closes your own sign-in only. The family's account and records stay with the main contact.";

/** What closing a family contact's own login removes and keeps (a contact who is not the main contact). */
export const CONTACT_LOGIN_CONSEQUENCES: DeletionConsequences = {
  removed: ['Your login and contact details', "Your place in the family's list of contacts"],
  kept: [
    "The family's account, children's profiles and lessons, which stay with the main contact",
    "Messages you sent stay in the family's conversation without your name",
    'Invoices and payment records',
  ],
  note: 'The main contact can add you to the family again at any time.',
};

/** True only when the person typed DELETE exactly (surrounding spaces are ignored). */
export function canConfirmDeletion(text: string): boolean {
  return text.trim() === DELETE_CONFIRM_WORD;
}

/** e.g. elite-education-data-2026-10-04.json (local date). */
export function exportFileName(date: Date, extension = 'json'): string {
  return `elite-education-data-${toDateKey(date)}.${extension}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
const listJoin = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * e.g. "Kept 4 invoices and 3 payments; cancelled 2 future lessons; 1 upcoming lesson needs a new tutor", or
 * "Kept 4 invoices, 1 credit note, 3 payments and 1 refund" when credit notes or refunds were kept too.
 */
export function deletionSummaryText(s: DeletionSummary | undefined | null): string {
  if (!s) return '';
  const parts: string[] = [];
  const invoices = s.invoicesRetained ?? 0;
  const payments = s.paymentsRetained ?? 0;
  const creditNotes = s.creditNotesRetained ?? 0;
  const refunds = s.refundsRetained ?? 0;
  if (invoices || payments || creditNotes || refunds) {
    const kept = [plural(invoices, 'invoice'), creditNotes ? plural(creditNotes, 'credit note') : '', plural(payments, 'payment'), refunds ? plural(refunds, 'refund') : ''];
    parts.push(`Kept ${listJoin(kept.filter(Boolean))}`);
  }
  if (s.studentsAnonymised) parts.push(`anonymised ${plural(s.studentsAnonymised, 'student')}`);
  if (s.futureLessonsCancelled) parts.push(`cancelled ${plural(s.futureLessonsCancelled, 'future lesson')}`);
  if (s.upcomingLessonsNeedingTutor) {
    const n = s.upcomingLessonsNeedingTutor;
    parts.push(`${plural(n, 'upcoming lesson')} ${n === 1 ? 'needs' : 'need'} a new tutor`);
  }
  if (!parts.length) return 'Nothing needed to be kept or cancelled.';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const DELETION_STATUS_LABEL: Record<DeletionRequest['status'], string> = {
  pending: 'Pending',
  processing: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Order the groups appear in on the admin screen. */
export const DELETION_STATUS_ORDER: DeletionRequest['status'][] = ['pending', 'failed', 'processing', 'completed', 'cancelled'];

export function canProcessRequest(r: Pick<DeletionRequest, 'status'>): boolean {
  return r.status === 'pending' || r.status === 'failed';
}

export function canCancelRequest(r: Pick<DeletionRequest, 'status'>): boolean {
  return r.status === 'pending';
}

/** Masks all but the last four characters of an account number, e.g. "•••• 1234". Never returns more than four. */
export function last4(value: string | undefined | null): string | undefined {
  const clean = (value ?? '').replace(/\s+/g, '');
  return clean ? clean.slice(-4) : undefined;
}
