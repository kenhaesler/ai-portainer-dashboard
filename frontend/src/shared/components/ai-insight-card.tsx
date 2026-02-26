import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';

interface AiInsightCardProps {
  title?: string;
  children: React.ReactNode;
  streaming?: boolean;
  confidence?: number;
  className?: string;
}

export function AiInsightCard({
  title = 'AI Insight',
  children,
  streaming,
  confidence,
  className,
}: AiInsightCardProps) {
  const potatoMode = useUiStore((state) => state.potatoMode);

  return (
    <div
      data-testid="ai-insight-card"
      className={cn(
        'relative overflow-hidden rounded-xl border border-purple-200 bg-purple-50/30 p-4 dark:border-purple-800/50 dark:bg-purple-950/20',
        className,
      )}
    >
      {/* Shimmer overlay when streaming */}
      {streaming && !potatoMode && (
        <div
          data-testid="ai-insight-shimmer"
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(168, 85, 247, 0.08) 50%, transparent 100%)',
              animation: 'ai-insight-shimmer 1.5s ease-in-out infinite',
            }}
          />
        </div>
      )}

      {/* Label */}
      <p className="text-xs font-semibold uppercase tracking-widest text-purple-500">
        {title}
      </p>

      {/* Content */}
      <div className="relative mt-2 text-sm">
        {children}
        {streaming && (
          <span
            data-testid="ai-insight-cursor"
            className={cn(
              'ml-1 inline-block h-4 w-1.5 align-text-bottom bg-purple-400',
              !potatoMode && 'animate-pulse',
            )}
          />
        )}
      </div>

      {/* Confidence bar */}
      {confidence != null && (
        <div
          data-testid="ai-insight-confidence"
          className="mt-3 h-1 rounded-full bg-purple-100 dark:bg-purple-900"
        >
          <div
            style={{ width: `${Math.min(100, Math.max(0, confidence))}%` }}
            className="h-full rounded-full bg-purple-500 transition-all duration-800 ease-out"
          />
        </div>
      )}
    </div>
  );
}
