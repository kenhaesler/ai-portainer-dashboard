import { X, Info } from 'lucide-react';

export interface ContextBannerData {
  /** Human-readable source page name, e.g. "Remediation" */
  source: string;
  /** Container name involved in the action */
  containerName?: string;
  /** Optional analysis/rationale summary */
  containerSummary?: string;
}

interface ContextBannerProps {
  data: ContextBannerData;
  onDismiss: () => void;
}

/**
 * Dismissible context banner displayed above the LLM chat area when the
 * user arrives from another page via "Discuss with AI". Shows the source
 * page, container name, and an optional analysis summary.
 */
export function ContextBanner({ data, onDismiss }: ContextBannerProps) {
  const sourceLabel = data.source === 'remediation' ? 'From Remediation' : `From ${data.source}`;

  return (
    <div
      role="status"
      aria-label="Context from previous page"
      className="flex items-start gap-3 rounded-xl border border-blue-300/40 bg-blue-500/10 px-4 py-3 text-sm backdrop-blur-sm
                 animate-in fade-in slide-in-from-top-2 duration-300 dark:border-blue-500/30 dark:bg-blue-900/20"
    >
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400" />

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
            {sourceLabel}
          </span>
          {data.containerName && (
            <span className="font-medium text-foreground">{data.containerName}</span>
          )}
        </div>

        {data.containerSummary && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{data.containerSummary}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss context banner"
        className="flex-shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
