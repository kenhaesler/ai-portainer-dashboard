import { memo } from 'react';
import { Bot, RefreshCw, AlertCircle } from 'lucide-react';
import { useAiMetricsSummary } from '@/hooks/use-ai-metrics-summary';
import { cn } from '@/lib/utils';

interface AiMetricsSummaryProps {
  endpointId: number | undefined;
  containerId: string | undefined;
  timeRange: string;
}

export const AiMetricsSummary = memo(function AiMetricsSummary({ endpointId, containerId, timeRange }: AiMetricsSummaryProps) {
  const { summary, isStreaming, error, refresh } = useAiMetricsSummary(
    endpointId,
    containerId,
    timeRange,
  );

  // Hide entirely when LLM is unavailable
  if (error === 'unavailable') return null;

  // Don't render when no container is selected
  if (!endpointId || !containerId) return null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-purple-500" />
          <h4 className="text-sm font-medium text-muted-foreground">AI Summary</h4>
        </div>
        <button
          onClick={refresh}
          disabled={isStreaming}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors',
            isStreaming && 'opacity-50 cursor-not-allowed',
          )}
          title="Regenerate summary"
        >
          <RefreshCw className={cn('h-3 w-3', isStreaming && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && error !== 'unavailable' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
          <span>AI summary unavailable right now</span>
        </div>
      )}

      {!error && !summary && isStreaming && (
        <div className="space-y-2">
          <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
        </div>
      )}

      {summary && (
        <p className="text-sm leading-relaxed">
          {summary}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-purple-500 ml-0.5 animate-pulse align-text-bottom" />
          )}
        </p>
      )}
    </div>
  );
});
