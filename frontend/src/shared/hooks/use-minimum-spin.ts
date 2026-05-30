import { useEffect, useRef, useState } from 'react';

const MIN_SPIN_MS = 1500;

/**
 * Drives a refresh spinner that stays visible for at least `MIN_SPIN_MS` after
 * `isLoading` flips back to false. A cache-warm refetch can resolve in a few
 * milliseconds; without the floor the icon would barely flicker and the click
 * wouldn't read as a deliberate action. Shared by `RefreshButton` and
 * `RefreshControls` so the timing stays identical across both.
 */
export function useMinimumSpin(isLoading: boolean | undefined): boolean {
  const [showSpin, setShowSpin] = useState(Boolean(isLoading));
  const spinStartedAtRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    if (isLoading) {
      spinStartedAtRef.current = Date.now();
      setShowSpin(true);
      return;
    }

    if (!showSpin) {
      return;
    }

    const elapsed = Date.now() - spinStartedAtRef.current;
    const remaining = Math.max(0, MIN_SPIN_MS - elapsed);
    stopTimerRef.current = window.setTimeout(() => {
      setShowSpin(false);
      stopTimerRef.current = null;
    }, remaining);
  }, [isLoading, showSpin]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    };
  }, []);

  return showSpin;
}
