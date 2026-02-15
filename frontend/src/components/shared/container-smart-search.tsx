import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, Loader2, ArrowRight, AlertCircle, X } from 'lucide-react';
import { useNlQuery, type NlQueryResult } from '@/hooks/use-nl-query';
import { cn } from '@/lib/utils';

const EXAMPLE_QUERIES = [
  'containers using >80% CPU',
  'stopped nginx containers',
  'high memory usage',
  'running containers',
];

interface ContainerSmartSearchProps {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
}

export function ContainerSmartSearch({
  value,
  onChange,
  onClear,
  placeholder = 'Search containers by name, CPU, memory, or status...',
}: ContainerSmartSearchProps) {
  const navigate = useNavigate();
  const [result, setResult] = useState<NlQueryResult | null>(null);
  const nlQuery = useNlQuery();

  const handleLlmSearch = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || nlQuery.isPending) return;
    setResult(null);
    nlQuery.mutate(trimmed, {
      onSuccess: (data) => setResult(data),
      onError: () =>
        setResult({ action: 'error', text: 'Failed to process query. Is the LLM service available?' }),
    });
  }, [value, nlQuery]);

  const handleExampleClick = useCallback(
    (example: string) => {
      onChange(example);
      setResult(null);
      nlQuery.mutate(example, {
        onSuccess: (data) => setResult(data),
        onError: () =>
          setResult({ action: 'error', text: 'Failed to process query. Is the LLM service available?' }),
      });
    },
    [nlQuery, onChange],
  );

  const handleClear = useCallback(() => {
    setResult(null);
    onChange('');
    onClear?.();
  }, [onChange, onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLlmSearch();
      }
    },
    [handleLlmSearch],
  );

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
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (result) setResult(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-xl border bg-card/80 py-3 pl-11 pr-12 text-sm backdrop-blur-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
            'transition-all duration-200',
            // Prevent iOS zoom on focus
            'text-[16px] sm:text-sm',
          )}
          aria-label="Smart container search"
        />
        {value && (
          <button
            onClick={handleClear}
            className="absolute inset-y-0 right-0 flex items-center pr-4 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Example query chips - only show when no search value */}
      {!value && !result && !nlQuery.isPending && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((example) => (
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

      {/* Hint text */}
      {value && !result && !nlQuery.isPending && (
        <p className="text-xs text-muted-foreground">
          Filtering locally... Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Enter</kbd> for AI search
        </p>
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
            <p className="text-xs text-muted-foreground">Analyzing containers with AI</p>
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
