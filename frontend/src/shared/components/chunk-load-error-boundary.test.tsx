import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChunkLoadErrorBoundary } from './chunk-load-error-boundary';

const RELOAD_KEY = 'chunk_load_last_reload';

describe('ChunkLoadErrorBoundary', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadSpy = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // jsdom doesn't allow reassigning window.location directly, so patch reload
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when no error occurs', () => {
    render(
      <ChunkLoadErrorBoundary>
        <div>content</div>
      </ChunkLoadErrorBoundary>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('auto-reloads on first ChunkLoadError', () => {
    const ThrowChunkError = () => {
      throw Object.assign(new Error('Failed to fetch dynamically imported module'), {
        name: 'ChunkLoadError',
      });
    };

    render(
      <ChunkLoadErrorBoundary>
        <ThrowChunkError />
      </ChunkLoadErrorBoundary>,
    );

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).not.toBeNull();
  });

  it('auto-reloads when reload key is older than cooldown', () => {
    // Simulate a reload that happened more than 10 seconds ago
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 15_000));

    const ThrowChunkError = () => {
      throw new Error('Failed to fetch dynamically imported module');
    };

    render(
      <ChunkLoadErrorBoundary>
        <ThrowChunkError />
      </ChunkLoadErrorBoundary>,
    );

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('shows manual refresh UI when reload already happened within cooldown', () => {
    // Simulate reload that happened 5 seconds ago (within 10s cooldown)
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 5_000));

    const ThrowChunkError = () => {
      throw new Error('Failed to fetch dynamically imported module');
    };

    render(
      <ChunkLoadErrorBoundary>
        <ThrowChunkError />
      </ChunkLoadErrorBoundary>,
    );

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByText(/new version/i)).toBeInTheDocument();
  });

  it('shows generic fallback for non-chunk errors without reloading', () => {
    const ThrowGenericError = () => {
      throw new Error('Something else went wrong');
    };

    render(
      <ChunkLoadErrorBoundary>
        <ThrowGenericError />
      </ChunkLoadErrorBoundary>,
    );

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
  });

  it('detects ChunkLoadError by error name', () => {
    const err = new Error('Chunk load failed');
    err.name = 'ChunkLoadError';
    const Throw = () => { throw err; };

    render(<ChunkLoadErrorBoundary><Throw /></ChunkLoadErrorBoundary>);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('detects ChunkLoadError by "Loading chunk" message pattern', () => {
    const Throw = () => { throw new Error('Loading chunk 42 failed.'); };

    render(<ChunkLoadErrorBoundary><Throw /></ChunkLoadErrorBoundary>);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
