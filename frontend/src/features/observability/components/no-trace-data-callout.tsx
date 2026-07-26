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
 * bordered card explaining why the panel is empty and pointing at the eBPF
 * coverage page, where operators roll Beyla onto endpoints.
 *
 * Use whenever a trace query succeeds but returns no data, so the UI gives a
 * clear next step instead of looking broken.
 *
 * Two deliberate choices, both from the design critique:
 * - **Theme tokens, not raw purple.** The card used `border-purple-400/30` /
 *   `bg-purple-500/5`, which assumes a dark surface and is the colour this
 *   design system reserves for AI insight. Traces are not an AI surface.
 * - **The link is a link.** The CTA used to be the only solid-fill button on
 *   `/llm-observability`, which made a documentation jump the loudest element
 *   on a page full of real telemetry. An empty state should not out-shout the
 *   data next to it.
 */
export function NoTraceDataCallout({ description, className }: NoTraceDataCalloutProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border bg-muted/20 p-6',
        'flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      data-testid="no-trace-data-callout"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Deploy Beyla
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
