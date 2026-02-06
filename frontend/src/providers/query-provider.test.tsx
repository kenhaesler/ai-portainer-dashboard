import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from './query-provider';

function Inspector() {
  const client = useQueryClient();
  const defaults = client.getDefaultOptions();
  return <pre data-testid="defaults">{JSON.stringify(defaults)}</pre>;
}

describe('QueryProvider', () => {
  it('should set correct default query options', () => {
    const { getByTestId } = render(
      <QueryProvider>
        <Inspector />
      </QueryProvider>,
    );

    const defaults = JSON.parse(getByTestId('defaults').textContent ?? '{}');

    expect(defaults.queries.staleTime).toBe(30_000);
    expect(defaults.queries.gcTime).toBe(600_000);
    expect(defaults.queries.retry).toBe(2);
    expect(defaults.queries.refetchOnWindowFocus).toBe(true);
    expect(defaults.queries.refetchOnReconnect).toBe('always');
  });

  it('should set correct default mutation options', () => {
    const { getByTestId } = render(
      <QueryProvider>
        <Inspector />
      </QueryProvider>,
    );

    const defaults = JSON.parse(getByTestId('defaults').textContent ?? '{}');
    expect(defaults.mutations.retry).toBe(0);
  });
});
