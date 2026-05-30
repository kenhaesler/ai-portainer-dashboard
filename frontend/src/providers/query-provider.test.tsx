import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { QueryProvider } from './query-provider';
import { ApiError } from '@/shared/lib/api-error';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from 'sonner';

beforeEach(() => {
  vi.clearAllMocks();
});

function Inspector() {
  const client = useQueryClient();
  const defaults = client.getDefaultOptions();
  return <pre data-testid="defaults">{JSON.stringify(defaults)}</pre>;
}

function TestMutationComponent({
  mutateFn,
  onError,
}: {
  mutateFn: () => Promise<unknown>;
  onError?: (err: Error) => void;
}) {
  const mutation = useMutation({
    mutationFn: mutateFn,
    onError,
  });
  return (
    <button onClick={() => mutation.mutate()}>
      {mutation.isError ? 'Error' : 'Mutate'}
    </button>
  );
}

describe('QueryProvider', () => {
  it('should set correct default query options', () => {
    const { getByTestId } = render(
      <QueryProvider>
        <Inspector />
      </QueryProvider>,
    );

    const defaults = JSON.parse(getByTestId('defaults').textContent ?? '{}');

    expect(defaults.queries.staleTime).toBe(2 * 60_000);
    expect(defaults.queries.gcTime).toBe(600_000);
    expect(defaults.queries.retry).toBe(2);
    expect(defaults.queries.refetchOnWindowFocus).toBe(false);
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

describe('QueryProvider global error handling', () => {
  it('toasts mutation errors when no local onError is provided', async () => {
    const mutateFn = vi.fn().mockRejectedValue(new ApiError(500, 'Server error'));

    const { getByText } = render(
      <QueryProvider>
        <TestMutationComponent mutateFn={mutateFn} />
      </QueryProvider>
    );

    getByText('Mutate').click();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Server error')
    );
  });

  it('does not toast mutation errors when local onError handles them', async () => {
    const mutateFn = vi.fn().mockRejectedValue(new ApiError(422, 'Validation failed'));
    const localOnError = vi.fn();

    const { getByText } = render(
      <QueryProvider>
        <TestMutationComponent mutateFn={mutateFn} onError={localOnError} />
      </QueryProvider>
    );

    getByText('Mutate').click();

    await waitFor(() => expect(localOnError).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not toast mutation 401 errors (handled by auth:expired)', async () => {
    const mutateFn = vi.fn().mockRejectedValue(new ApiError(401, 'Session expired'));

    const { getByText } = render(
      <QueryProvider>
        <TestMutationComponent mutateFn={mutateFn} />
      </QueryProvider>
    );

    getByText('Mutate').click();

    await waitFor(() => expect(mutateFn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
