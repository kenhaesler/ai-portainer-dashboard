import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

/**
 * Syncs a single key in URL search params with React state.
 * When the value equals the default, the key is removed from the URL.
 */
export function useURLState<T extends string>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = (searchParams.get(key) || defaultValue) as T;

  const setValue = useCallback(
    (newValue: T) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (newValue === defaultValue || !newValue) {
            next.delete(key);
          } else {
            next.set(key, String(newValue));
          }
          return next;
        },
        { replace: true }
      );
    },
    [key, defaultValue, setSearchParams]
  );

  return [value, setValue];
}
