import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, Loader2, ArrowRight, AlertCircle, X } from 'lucide-react';
import { useNlQuery, type NlQueryResult } from '@/hooks/use-nl-query';
import { cn } from '@/lib/utils';
import type { Container } from '@/hooks/use-containers';
import { filterContainers } from '@/lib/workload-search-filter';

const FILTER_CHIPS = [
  { label: 'state:running' },
  { label: 'image:nginx' },
  { label: 'stack:traefik' },
  { label: 'endpoint:prod' },
];

const AI_CHIPS = [
  { label: 'stopped containers using high memory' },
  { label: 'all nginx containers on prod' },
];

type SearchMode = 'filter' | 'ai';

export interface WorkloadSmartSearchProps {
  containers: Container[];
  knownStackNames: string[];
  onFiltered: (containers: Container[]) => void;
  totalCount: number;
  placeholder?: string;
}

export function WorkloadSmartSearch({
  containers,
  knownStackNames,
  onFiltered,
  totalCount,
  placeholder = 'Filter by name, image, state, stack... or press Enter for AI search',
}: WorkloadSmartSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('filter');
  const [aiResult, setAiResult] = useState<NlQueryResult | null>(null);
  const [filteredCount, setFilteredCount] = useState(containers.length);
  const nlQuery = useNlQuery();

  const applyFilter = useCallback(
    (q: string, conts: Container[]) => {
      const filtered = filterContainers(conts, q, knownStackNames);
      setFilteredCount(filtered.length);
      onFiltered(filtered);
    },
    [knownStackNames, onFiltered],
  );

  // Re-apply filter when upstream containers change (dropdown filter changed)
  useEffect(() => {
    setFilteredCount(containers.length);
    if (query && mode === 'filter') {
      applyFilter(query, containers);
    }
    // Intentionally omit query/mode/applyFilter — we only want to re-run when the
    // upstream containers list changes (endpoint/stack dropdown changed).
  }, [containers]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newQuery = e.target.value;
      setQuery(newQuery);
      setMode('filter');
      setAiResult(null);
      applyFilter(newQuery, containers);
    },
    [applyFilter, containers],
  );

  const handleAiSearch = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || nlQuery.isPending) return;
    setMode('ai');
    setAiResult(null);
    nlQuery.mutate(trimmed, {
      onSuccess: (data) => setAiResult(data),
      onError: () =>
        setAiResult({ action: 'error', text: 'Failed to process query. Is the LLM service available?' }),
    });
  }, [query, nlQuery]);

  const handleClear = useCallback(() => {
    setQuery('');
    setMode('filter');
    setAiResult(null);
    setFilteredCount(containers.length);
    onFiltered(containers);
  }, [containers, onFiltered]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAiSearch();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    },
    [handleAiSearch, handleClear],
  );

  const handleFilterChipClick = useCallback(
    (label: string) => {
      setQuery(label);
      setMode('filter');
      setAiResult(null);
      applyFilter(label, containers);
    },
    [applyFilter, containers],
  );

  const handleAiChipClick = useCallback(
    (label: string) => {
      setQuery(label);
      setMode('ai');
      setAiResult(null);
      nlQuery.mutate(label, {
        onSuccess: (data) => setAiResult(data),
        onError: () =>
          setAiResult({ action: 'error', text: 'Failed to process query. Is the LLM service available?' }),
      });
    },
    [nlQuery],
  );

  const isAiMode = mode === 'ai';
  const showFilteredCount = query && mode === 'filter' && filteredCount !== totalCount;

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          {nlQuery.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
          ) : isAiMode ? (
            <Sparkles className="h-4 w-4 text-purple-500" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-xl border bg-card/80 py-3 pl-11 pr-24 text-sm backdrop-blur-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none transition-all duration-200',
            'text-[16px] sm:text-sm',
            isAiMode
              ? 'ring-2 ring-purple-500/40 border-purple-500/50 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/50'
              : 'focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
          )}
          aria-label="Workload smart search"
        />
        <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-3">
          {isAiMode && !nlQuery.isPending && (
            <span className="inline-flex items-center rounded-md bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              AI
            </span>
          )}
          {query && (
            <button
              onClick={handleClear}
              className="flex items-center text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Example chips — shown when input is empty */}
      {!query && !nlQuery.isPending && (
        <div className="flex flex-wrap gap-2">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => handleFilterChipClick(chip.label)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium',
                'text-muted-foreground backdrop-blur-sm transition-all duration-200',
                'hover:bg-primary/10 hover:text-primary hover:border-primary/30',
                'min-h-[36px] sm:min-h-0',
              )}
            >
              {chip.label}
            </button>
          ))}
          {AI_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => handleAiChipClick(chip.label)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium',
                'text-muted-foreground backdrop-blur-sm transition-all duration-200',
                'hover:bg-purple-500/10 hover:text-purple-600 hover:border-purple-500/30',
                'min-h-[36px] sm:min-h-0',
              )}
            >
              <Sparkles className="h-3 w-3" />
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Hint text — filter mode with query */}
      {query && mode === 'filter' && !aiResult && !nlQuery.isPending && (
        <p className="text-xs text-muted-foreground">
          Filtering locally... Press{' '}
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Enter</kbd> for AI search
        </p>
      )}

      {/* Loading state */}
      {nlQuery.isPending && (
        <div className="flex items-center gap-3 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="relative">
            <div className="h-8 w-8 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
            <Sparkles className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-purple-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Processing query...</p>
            <p className="text-xs text-muted-foreground">Analyzing with AI</p>
          </div>
        </div>
      )}

      {/* AI result card */}
      {aiResult && !nlQuery.isPending && (
        <div
          className={cn(
            'rounded-xl border p-4',
            aiResult.action === 'error'
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-purple-500/20 bg-purple-500/5',
          )}
        >
          {aiResult.action === 'answer' && (
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{aiResult.text}</p>
                {aiResult.description && (
                  <p className="text-xs text-muted-foreground">{aiResult.description}</p>
                )}
              </div>
            </div>
          )}

          {aiResult.action === 'navigate' && aiResult.page && (
            <button
              onClick={() => navigate(aiResult.page!)}
              className="group flex w-full items-center gap-3 text-left transition-colors hover:bg-purple-500/10 rounded-lg -m-1 p-1"
            >
              <ArrowRight className="h-4 w-4 shrink-0 text-purple-500 group-hover:translate-x-0.5 transition-transform" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{aiResult.description || 'View result'}</p>
                <p className="text-xs text-muted-foreground truncate">{aiResult.page}</p>
              </div>
            </button>
          )}

          {aiResult.action === 'error' && (
            <div className="flex items-center gap-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{aiResult.text}</p>
            </div>
          )}
        </div>
      )}

      {/* Count display */}
      <p className="text-sm text-muted-foreground">
        {showFilteredCount
          ? `Showing ${filteredCount} of ${totalCount} container${totalCount !== 1 ? 's' : ''}`
          : `${totalCount} container${totalCount !== 1 ? 's' : ''}`}
      </p>
    </div>
  );
}
