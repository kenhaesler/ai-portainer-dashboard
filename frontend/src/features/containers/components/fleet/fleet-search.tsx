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
  /** Show the filtered count badge when isFiltered. Defaults to true. */
  showCount?: boolean;
  /** Seed the input value on mount (e.g. from a URL-persisted query). */
  initialValue?: string;
  /** Called once after autoFocus moves focus into the input. */
  onAutoFocused?: () => void;
}

export function FleetSearch({
  onSearch,
  totalCount,
  filteredCount,
  placeholder = 'Search...',
  label,
  examples,
  autoFocus = false,
  showCount = true,
  initialValue,
  onAutoFocused,
}: FleetSearchProps) {
  const [query, setQuery] = useState(initialValue ?? '');
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
    if (autoFocus) {
      inputRef.current?.focus();
      onAutoFocused?.();
    }
  }, [autoFocus, onAutoFocused]);

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
    <div className="flex flex-col gap-1.5">
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
              'w-full rounded-xl border bg-card/80 py-3 pl-11 pr-9 text-[16px] sm:text-sm backdrop-blur-sm',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
              'transition-all duration-200',
            )}
            aria-label={label}
          />
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
        {isFiltered && showCount && (
          <span className="shrink-0 text-sm text-muted-foreground" data-testid="fleet-search-count">
            {filteredCount} of {totalCount}
          </span>
        )}
      </div>
      {showExamples && (
        // Chips sit *below* the field, not overlaid on it. Overlaying meant the
        // placeholder had to be made transparent to avoid a collision, so the
        // field rendered as a blank slab with pills floating in it and the one
        // string explaining the query syntax was invisible. They stay mounted
        // while the field is empty (including while focused) so they remain
        // keyboard-reachable, mirroring WorkloadSmartSearch.
        <div
          role="group"
          aria-label="Example searches"
          className="flex flex-wrap items-center gap-1.5 pl-1"
        >
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => handleExampleClick(ex)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-card/80 px-2 py-0.5 text-xs font-medium',
                'text-muted-foreground backdrop-blur-sm transition-colors duration-200',
                'hover:bg-primary/10 hover:text-primary hover:border-primary/30',
              )}
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
