import { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A wrapper component that shows a radial gradient spotlight
 * following the mouse on hover. Uses CSS custom properties
 * (--x, --y) instead of React state for smooth, paint-only updates.
 *
 * Disabled in potato mode to avoid unnecessary GPU work.
 */
export function SpotlightCard({ children, className }: SpotlightCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const potatoMode = useUiStore((state) => state.potatoMode);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (potatoMode) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--y', `${e.clientY - rect.top}px`);
    },
    [potatoMode],
  );

  return (
    <div
      ref={containerRef}
      className={cn('spotlight-card rounded-xl', className)}
      onMouseMove={handleMouseMove}
    >
      {children}
    </div>
  );
}
