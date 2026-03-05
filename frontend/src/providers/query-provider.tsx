import { QueryClient, QueryClientProvider, QueryCache, MutationCache, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/shared/lib/api-error';

function shouldShowError(error: unknown): error is ApiError {
  // Don't toast 401 errors — handled by auth:expired event
  return error instanceof ApiError && error.status !== 401;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
            refetchOnWindowFocus: false,
            refetchOnReconnect: 'always',
            placeholderData: keepPreviousData,
          },
          mutations: {
            retry: 0,
          },
        },
        queryCache: new QueryCache({
          onError: (error, query) => {
            // Only toast for background refetches that had previous data
            if (query.state.data !== undefined && shouldShowError(error)) {
              toast.error(`Background update failed: ${error.userMessage}`);
            }
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            // Only show global toast if the mutation didn't define its own onError
            if (!mutation.options.onError && shouldShowError(error)) {
              toast.error(error.userMessage);
            }
          },
        }),
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
