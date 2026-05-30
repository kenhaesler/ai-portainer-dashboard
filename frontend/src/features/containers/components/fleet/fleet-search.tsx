import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface FleetSearchProps {
  onSearch: (query: string) => void;
  totalCount: number;
  filteredCount: number;
  placeholder?: string;
  label: string;
  /** Example query chips shown inside the field while it is empty. */
  examples?: string[];
  /** Focus the input on mount (e.g. when the page first opens). */
  autoFocus?: boolean;
}

export function FleetSearch({
  onSearch,
  totalCount,
  filteredCount,
  placeholder = 'Search...',
  label,
  examples,
  autoFocus = false,
}: FleetSearchProps) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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

  const handleExampleClick = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSearch(value);
      inputRef.current?.focus();
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleClear();
        // Exit the field on Escape so keyboard users can leave the search.
        inputRef.current?.blur();
      }
    },
    [handleClear],
  );

  const isFiltered = query.length > 0 && filteredCount !== totalCount;
  const showExamples = !query && !!examples && examples.length > 0;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-xl border bg-card/80 py-3 pl-11 pr-9 text-sm backdrop-blur-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
            'transition-all duration-200',
            // While example chips overlay the empty field, hide the placeholder
            // text (kept in the DOM for a11y/tests) so the two don't collide.
            showExamples && 'placeholder:text-transparent',
          )}
          aria-label={label}
        />
        {showExamples && (
          // Chips stay mounted while the field is empty (including while it is
          // focused) so they remain keyboard-reachable, mirroring WorkloadSmartSearch.
          <div
            role="group"
            aria-label="Example searches"
            onClick={(e) => {
              // A click on the empty strip (not a chip) focuses the input.
              if (e.target === e.currentTarget) {
                inputRef.current?.focus();
              }
            }}
            className="absolute inset-y-0 left-11 right-3 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {examples.map((ex, i) => (
              <button
                key={ex}
                type="button"
                onClick={() => handleExampleClick(ex)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-card/80 px-2 py-0.5 text-xs font-medium',
                  'text-muted-foreground backdrop-blur-sm transition-colors duration-200',
                  'hover:bg-primary/10 hover:text-primary hover:border-primary/30',
                  // Right-align the chip row: ml-auto on the first chip absorbs
                  // free space so chips sit right when they fit, and collapse to
                  // a left-aligned scrollable row when they overflow.
                  i === 0 && 'ml-auto',
                )}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        {query && (
          <button
            type="button"
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
