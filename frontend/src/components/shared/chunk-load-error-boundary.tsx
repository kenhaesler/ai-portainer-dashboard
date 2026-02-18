import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const RELOAD_KEY = 'chunk_load_last_reload';
/** Minimum ms between auto-reloads — prevents infinite reload loops. */
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /loading chunk/i.test(error.message) ||
    /failed to fetch dynamically imported module/i.test(error.message) ||
    /error loading dynamically imported module/i.test(error.message)
  );
}

function shouldAutoReload(): boolean {
  const last = sessionStorage.getItem(RELOAD_KEY);
  if (!last) return true;
  return Date.now() - Number(last) > RELOAD_COOLDOWN_MS;
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

/**
 * Catches ChunkLoadError thrown by React.lazy() when a code-split chunk can
 * no longer be fetched (e.g. after a deployment renames hashed filenames).
 *
 * On first occurrence: silently reloads the page so the browser fetches
 * fresh chunk URLs from the new index.html.
 *
 * If a reload already happened within the last 10 s and the error persists,
 * falls back to a manual refresh prompt instead of looping.
 */
export class ChunkLoadErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error) && shouldAutoReload()) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return;
    }
    console.error('[ChunkLoadErrorBoundary] Unrecoverable error:', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.isChunkError
      ? 'A new version of this page is available. Please refresh to continue.'
      : 'This section encountered an unexpected error.';

    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
    );
  }
}
