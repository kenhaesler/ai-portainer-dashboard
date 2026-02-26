import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, Loader2, ArrowRight, AlertCircle, X } from 'lucide-react';
import { useNlQuery, type NlQueryResult } from '@/features/ai-intelligence/hooks/use-nl-query';
import { cn } from '@/shared/lib/utils';

const EXAMPLE_QUERIES_DEFAULT = [
  'high memory containers',
  'running nginx',
  'stopped containers',
  'top CPU consumers',
];

const EXAMPLE_QUERIES_CONTAINER = [
  'containers using >80% CPU',
  'stopped nginx containers',
  'high memory usage',
  'running containers',
];

interface NlqSearchBarProps {
  scope?: 'default' | 'container';
  placeholder?: string;
}

export function NlqSearchBar({ scope = 'default', placeholder }: NlqSearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<NlQueryResult | null>(null);
  const nlQuery = useNlQuery();

  const exampleQueries = scope === 'container' ? EXAMPLE_QUERIES_CONTAINER : EXAMPLE_QUERIES_DEFAULT;
  const defaultPlaceholder =
    scope === 'container'
      ? 'Search containers by name, CPU, memory, or status...'
      : 'Ask about your containers... (e.g., \'show high memory containers\')';

  const handleSearch = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || nlQuery.isPending) return;
    setResult(null);
    nlQuery.mutate(trimmed, {
      onSuccess: (data) => setResult(data),
      onError: () =>
        setResult({ action: 'error', text: 'Failed to process query. Is the LLM service available?' }),
    });
  }, [query, nlQuery]);

  const handleExampleClick = useCallback(
    (example: string) => {
      setQuery(example);
      setResult(null);
      nlQuery.mutate(example, {
        onSuccess: (data) => setResult(data),
        onError: () =>
          setResult({ action: 'error', text: 'Failed to process query. Is the LLM service available?' }),
      });
    },
    [nlQuery],
  );

  const clearResult = useCallback(() => {
    setResult(null);
    setQuery('');
  }, []);

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          {nlQuery.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (result) setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder={placeholder || defaultPlaceholder}
          className={cn(
            'w-full rounded-xl border bg-card/80 py-3 pl-11 pr-12 text-sm backdrop-blur-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
            'transition-all duration-200',
            // Prevent iOS zoom on focus
            'text-[16px] sm:text-sm',
          )}
          aria-label="Natural language search"
        />
        {query && (
          <button
            onClick={clearResult}
            className="absolute inset-y-0 right-0 flex items-center pr-4 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Example query chips */}
      {!result && !nlQuery.isPending && (
        <div className="flex flex-wrap gap-2">
          {exampleQueries.map((example) => (
            <button
              key={example}
              onClick={() => handleExampleClick(example)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium',
                'text-muted-foreground backdrop-blur-sm transition-all duration-200',
                'hover:bg-primary/10 hover:text-primary hover:border-primary/30',
                // Touch target: min 48px height on mobile
                'min-h-[36px] sm:min-h-0',
              )}
            >
              <Sparkles className="h-3 w-3" />
              {example}
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {nlQuery.isPending && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="relative">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <Sparkles className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-primary">Processing query...</p>
            <p className="text-xs text-muted-foreground">Analyzing infrastructure</p>
          </div>
        </div>
      )}

      {/* Result display */}
      {result && !nlQuery.isPending && (
        <div
          className={cn(
            'rounded-xl border p-4',
            result.action === 'error'
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-primary/20 bg-primary/5',
          )}
        >
          {result.action === 'answer' && (
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{result.text}</p>
                {result.description && (
                  <p className="text-xs text-muted-foreground">{result.description}</p>
                )}
              </div>
            </div>
          )}

          {result.action === 'navigate' && result.page && (
            <button
              onClick={() => navigate(result.page!)}
              className="group flex w-full items-center gap-3 text-left transition-colors hover:bg-primary/10 rounded-lg -m-1 p-1"
            >
              <ArrowRight className="h-4 w-4 shrink-0 text-primary group-hover:translate-x-0.5 transition-transform" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{result.description || 'View result'}</p>
                <p className="text-xs text-muted-foreground truncate">{result.page}</p>
              </div>
            </button>
          )}

          {result.action === 'error' && (
            <div className="flex items-center gap-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{result.text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
