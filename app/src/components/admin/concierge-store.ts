import { create } from 'zustand';

/** Whether the admin concierge (the sheet / drawer behind the gold "+" and Ctrl/Cmd-K) is open, and its first query. */
export const useConcierge = create<{ open: boolean; query: string; show: (query?: string) => void; hide: () => void }>((set) => ({
  open: false,
  query: '',
  show: (query = '') => set({ open: true, query }),
  hide: () => set({ open: false }),
}));
