import { Link, useLocation } from 'react-router-dom';
import { FileQuestion, ArrowRight } from 'lucide-react';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { closestDestination, findDestination } from '@/features/core/lib/navigation-manifest';

/**
 * Real 404, rendered inside AppLayout so the shell (sidebar, breadcrumb,
 * search) survives. The catch-all used to be `<Navigate to="/" replace />`,
 * which silently turned every bad URL into Home — a stale bookmark landed the
 * operator on a page they had not asked for, and `replace` meant Back could
 * not get them out of it.
 */
export default function NotFound() {
  const location = useLocation();
  const attempted = location.pathname;
  const suggestion = closestDestination(attempted);
  const home = findDestination('/');
  const workloads = findDestination('/workloads');

  const fallbacks = [home, workloads].filter(
    (d): d is NonNullable<typeof d> => Boolean(d) && d!.path !== suggestion?.path,
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>

      <EmptyState
        variant="error"
        icon={FileQuestion}
        title={`No route matches ${attempted}`}
        description="The URL may be a stale bookmark, or the page may have been renamed. Nothing was loaded and nothing changed."
      />

      <nav aria-label="Suggested pages" className="flex flex-col gap-2">
        {suggestion && (
          <Link
            to={suggestion.path}
            data-testid="not-found-suggestion"
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/60"
          >
            <suggestion.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground">{suggestion.label}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {suggestion.path}
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}
        {fallbacks.map((destination) => (
          <Link
            key={destination.path}
            to={destination.path}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/60"
          >
            <destination.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground">{destination.label}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {destination.path}
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
