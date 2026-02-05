import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SearchHistoryItem {
  term: string;
  lastUsed: number;
}

interface SearchState {
  recent: SearchHistoryItem[];
  addRecent: (term: string) => void;
  clearRecent: () => void;
}

const MAX_RECENT = 6;

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      recent: [],
      addRecent: (term) =>
        set((state) => {
          const trimmed = term.trim();
          if (!trimmed) return state;
          const next = [
            { term: trimmed, lastUsed: Date.now() },
            ...state.recent.filter((item) => item.term.toLowerCase() !== trimmed.toLowerCase()),
          ];
          return { recent: next.slice(0, MAX_RECENT) };
        }),
      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: 'search-history',
      partialize: (state) => ({ recent: state.recent }),
    },
  ),
);
