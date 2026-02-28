import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface FleetSearchProps {
  onSearch: (query: string) => void;
  totalCount: number;
  filteredCount: number;
  placeholder?: string;
  label: string;
}

export function FleetSearch({
  onSearch,
  totalCount,
  filteredCount,
  placeholder = 'Search...',
  label,
}: FleetSearchProps) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatchSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(value);
      }, 300);
    },
    [onSearch],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      dispatchSearch(value);
    },
    [dispatchSearch],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch('');
  }, [onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleClear();
      }
    },
    [handleClear],
  );

  const isFiltered = query.length > 0 && filteredCount !== totalCount;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-lg border bg-card/80 py-2 pl-10 pr-9 text-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
            'transition-all duration-200',
          )}
          aria-label={label}
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isFiltered && (
        <span className="shrink-0 text-sm text-muted-foreground" data-testid="fleet-search-count">
          {filteredCount} of {totalCount}
        </span>
      )}
    </div>
  );
}
