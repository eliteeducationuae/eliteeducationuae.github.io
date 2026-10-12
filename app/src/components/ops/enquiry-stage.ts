import type { Palette } from '@/constants/theme';
import type { EnquiryStatus } from '@/domain/types';

import { ENQUIRY_STATUS } from '../enquiries';

/** The colour of each enquiry stage's dot and label (palette keys, so dark mode follows). */
const STAGE_COLOR: Record<EnquiryStatus, keyof Palette> = {
  new: 'warning',
  contacted: 'text',
  'trial-booked': 'accent',
  enrolled: 'success',
  lost: 'textMuted',
};

export function stageOf(status: EnquiryStatus, theme: Palette): { label: string; color: string } {
  return { label: ENQUIRY_STATUS[status].label, color: theme[STAGE_COLOR[status]] };
}

/** The four pipeline steps shown on the enquiry page; Lost sits apart as its own action. */
export const PIPELINE: EnquiryStatus[] = ['new', 'contacted', 'trial-booked', 'enrolled'];

const SOURCE_LABEL: Record<string, string> = {
  app: 'the app',
  website: 'the website',
  referral: 'a referral',
  phone: 'phone',
  other: 'another route',
};

/** "via the website", "via phone". */
export function viaSource(source: string): string {
  return `via ${SOURCE_LABEL[source] ?? source}`;
}
