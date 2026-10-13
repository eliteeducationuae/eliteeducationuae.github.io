import { Platform } from 'react-native';
import { create } from 'zustand';

/** The element that had focus when the concierge opened (web only), so closing it can hand focus back. */
let opener: HTMLElement | null = null;

/** Returns (and forgets) the element that opened the concierge. */
export function takeConciergeOpener(): HTMLElement | null {
  const el = opener;
  opener = null;
  return el;
}

/** Whether the admin concierge (the sheet / drawer behind the gold "+" and Ctrl/Cmd-K) is open, and its first query. */
export const useConcierge = create<{ open: boolean; query: string; show: (query?: string) => void; hide: () => void }>((set) => ({
  open: false,
  query: '',
  show: (query = '') => {
    // Captured before the modal mounts and moves focus inside itself.
    if (Platform.OS === 'web' && typeof document !== 'undefined') opener = document.activeElement as HTMLElement | null;
    set({ open: true, query });
  },
  hide: () => set({ open: false }),
}));
