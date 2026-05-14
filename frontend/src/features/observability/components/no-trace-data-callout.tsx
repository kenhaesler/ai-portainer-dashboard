import { Link } from 'react-router-dom';
import { Activity, ArrowRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface NoTraceDataCalloutProps {
  /** Optional override for the secondary description text. */
  description?: string;
  className?: string;
}

/**
 * Empty-state callout for any page that consumes trace/RED data. Renders a
 * glassmorphic card with a friendly explanation and a CTA pointing at the
 * eBPF coverage page where operators can roll Beyla onto endpoints.
 *
 * Use whenever a trace query succeeds but returns no data, so the UI gives a
 * clear next step instead of looking broken.
 */
export function NoTraceDataCallout({ description, className }: NoTraceDataCalloutProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-purple-400/30 bg-purple-500/5 p-6',
        'backdrop-blur-sm shadow-sm',
        'flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      data-testid="no-trace-data-callout"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-purple-500">
          <Activity className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">No trace data for this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {description
              ?? 'Roll out Beyla on this endpoint to start collecting RED metrics (rate, errors, duration) without changing application code.'}
          </p>
        </div>
      </div>
      <Link
        to="/ebpf-coverage"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2"
      >
        Deploy Beyla
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
