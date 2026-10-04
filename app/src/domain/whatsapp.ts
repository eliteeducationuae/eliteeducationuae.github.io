/**
 * WhatsApp reminders: number handling and who may receive which messages.
 * Pure helpers shared by the settings card, the demo backend and their tests.
 */
import type { Role } from './types';

/** An E.164 number, the same rule the database enforces on profiles.whatsapp_number. */
export const WHATSAPP_NUMBER_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Turn what someone typed into an E.164 number, or null if it cannot be one.
 * Accepts international forms ('+44 7700 900123', '0044…') and UAE local forms ('050 123 4567', '501234567').
 */
export function normaliseWhatsAppNumber(input: string, defaultCountryCode = '971'): string | null {
  let s = (input ?? '').trim().replace(/[\s\-.()[\]]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  else if (s.startsWith('+')) {
    // Already international.
  } else if (/^0\d+$/.test(s)) s = `+${defaultCountryCode}${s.slice(1)}`;
  else if (/^5\d{8}$/.test(s)) s = `+${defaultCountryCode}${s}`;
  else if (s.startsWith(defaultCountryCode) && s.length === defaultCountryCode.length + 9) s = `+${s}`;
  return WHATSAPP_NUMBER_RE.test(s) ? s : null;
}

/** Country codes of one or two digits (ITU-T E.164); every other code has three. */
const SHORT_COUNTRY_CODES = new Set([
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52',
  '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94',
  '95', '98',
]);

/**
 * Display an E.164 number. UAE numbers follow local style ('+971 50 123 4567', '+971 4 123 4567'); others are grouped lightly
 * after the country code, ending in a group of four ('+44 770 090 0123', '+1 202 555 0123'). Anything else is left as it is.
 */
export function formatWhatsAppNumber(e164: string): string {
  const mobile = /^\+971(5\d)(\d{3})(\d{4})$/.exec(e164);
  if (mobile) return `+971 ${mobile[1]} ${mobile[2]} ${mobile[3]}`;
  const landline = /^\+971([1-9])(\d{3})(\d{4})$/.exec(e164);
  if (landline) return `+971 ${landline[1]} ${landline[2]} ${landline[3]}`;
  if (!WHATSAPP_NUMBER_RE.test(e164)) return e164;
  const digits = e164.slice(1);
  const ccLength = SHORT_COUNTRY_CODES.has(digits.slice(0, 1)) ? 1 : SHORT_COUNTRY_CODES.has(digits.slice(0, 2)) ? 2 : 3;
  const national = digits.slice(ccLength);
  const head = national.slice(0, -4);
  const groups: string[] = [];
  // Threes from the right, so any shorter group comes first.
  for (let end = head.length; end > 0; end -= 3) groups.unshift(head.slice(Math.max(0, end - 3), end));
  return `+${digits.slice(0, ccLength)} ${[...groups, national.slice(-4)].join(' ')}`;
}

/** Parents, tutors and the office may receive WhatsApp reminders; students may not. */
export function canUseWhatsApp(role: Role): boolean {
  return role === 'parent' || role === 'tutor' || role === 'admin';
}

/** The messages someone in this role will receive on WhatsApp, in plain words. */
export function whatsAppMessageKinds(role: Role): string[] {
  switch (role) {
    case 'parent':
      return [
        'Lesson reminders the day before each lesson',
        'A note when lesson notes are ready',
        'New invoices, and a reminder if one becomes overdue',
        'Homework due the next day',
      ];
    case 'tutor':
    case 'admin':
      return ['Lesson reminders the day before each of your lessons'];
    default:
      return [];
  }
}
