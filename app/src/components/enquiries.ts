import type { EnquiryStatus } from '@/domain/types';

import type { Tone } from './ui';

export const ENQUIRY_STATUS: Record<EnquiryStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'gold' },
  contacted: { label: 'Contacted', tone: 'info' },
  'trial-booked': { label: 'Trial booked', tone: 'warning' },
  enrolled: { label: 'Enrolled', tone: 'success' },
  lost: { label: 'Lost', tone: 'neutral' },
};
