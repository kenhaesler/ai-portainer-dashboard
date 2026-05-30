import { useState, useEffect, useRef, useCallback } from 'react';

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface UseCountUpOptions {
  duration?: number;
  enabled?: boolean;
}

/**
 * Animates a number from its previous value to the target value using requestAnimationFrame.
 * On initial render, animates from 0. On subsequent changes, animates the delta.
 * Respects prefers-reduced-motion by returning the target value instantly.
 */
export function useCountUp(target: number, options: UseCountUpOptions = {}): number {
  const { duration = 1200, enabled = true } = options;
  const [display, setDisplay] = useState(0);
  const prevTarget = useRef(0);
  const rafId = useRef<number>(0);

  const prefersReducedMotion = useRef(false);
  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const animate = useCallback((from: number, to: number) => {
    if (rafId.current) cancelAnimationFrame(rafId.current);

    if (prefersReducedMotion.current || !enabled || duration <= 0) {
      setDisplay(to);
      return;
    }

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = from + (to - from) * eased;

      setDisplay(Math.round(current));

      if (progress < 1) {
        rafId.current = requestAnimationFrame(tick);
      }
    }

    rafId.current = requestAnimationFrame(tick);
  }, [duration, enabled]);

  useEffect(() => {
    animate(prevTarget.current, target);
    prevTarget.current = target;

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [target, animate]);

  return display;
}
