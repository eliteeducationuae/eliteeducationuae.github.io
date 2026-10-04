import type { ApplicationStatus } from '@/domain/types';

import type { Tone } from './ui';

export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  applied: { label: 'New', tone: 'gold' },
  interview: { label: 'Interview', tone: 'info' },
  offer: { label: 'Offer', tone: 'warning' },
  hired: { label: 'Hired', tone: 'success' },
  rejected: { label: 'Not now', tone: 'neutral' },
};
