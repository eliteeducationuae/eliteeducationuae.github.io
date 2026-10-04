import { canUseWhatsApp, WHATSAPP_NUMBER_RE } from '@/domain/whatsapp';
import type { Profile } from '@/domain/types';

import type { WhatsAppPrefs } from '../source';
import type { DemoDB } from './db';

/** Mirrors public.set_whatsapp: parents and tutors only, E.164 numbers, and opting out keeps the number. */
export function setWhatsAppPrefs(db: DemoDB, viewer: Profile, prefs: WhatsAppPrefs): Profile {
  const me = db.profiles.find((p) => p.id === viewer.id);
  if (!me || !canUseWhatsApp(me.role)) throw new Error('WhatsApp reminders are available to parents and tutors.');
  const number = prefs.number?.trim() || null;
  if (number && !WHATSAPP_NUMBER_RE.test(number)) {
    throw new Error('Please enter your WhatsApp number with its country code, for example +971 50 123 4567.');
  }
  if (prefs.optIn && !number) throw new Error('Please enter your WhatsApp number.');
  me.whatsappOptIn = prefs.optIn;
  if (number) me.whatsappNumber = number;
  return me;
}
