import { createContext, useContext, type ReactNode } from 'react';
import { useSearchStore, type SearchHistoryItem } from '@/stores/search-store';

interface SearchContextValue {
  recent: SearchHistoryItem[];
  addRecent: (term: string) => void;
  clearRecent: () => void;
}

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const recent = useSearchStore((s) => s.recent);
  const addRecent = useSearchStore((s) => s.addRecent);
  const clearRecent = useSearchStore((s) => s.clearRecent);

  return (
    <SearchContext.Provider value={{ recent, addRecent, clearRecent }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within SearchProvider');
  }
  return context;
}
