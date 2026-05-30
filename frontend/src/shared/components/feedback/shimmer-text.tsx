import { cn } from '@/shared/lib/utils';
import { useUiStore } from '@/stores/ui-store';

interface ShimmerTextProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Animated gradient text for AI loading states.
 * Shows a sweeping shimmer effect across the text.
 *
 * Respects prefers-reduced-motion (via CSS) and potato mode
 * (falls back to static muted text).
 */
export function ShimmerText({ children, className }: ShimmerTextProps) {
  const potatoMode = useUiStore((state) => state.potatoMode);

  if (potatoMode) {
    return (
      <span className={cn('text-muted-foreground', className)}>
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-block bg-gradient-to-r from-gray-400 via-white to-gray-400 bg-clip-text text-transparent',
        'shimmer-text-animate',
        className,
      )}
      style={{ backgroundSize: '200% auto' }}
    >
      {children}
    </span>
  );
}
