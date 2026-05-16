import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

export type EmptyStateVariant = 'empty' | 'error' | 'not-configured';

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

const iconTintByVariant: Record<EmptyStateVariant, string> = {
  empty: 'text-muted-foreground',
  error: 'text-destructive/80',
  'not-configured': 'text-amber-500/80',
};

export function EmptyState({
  variant = 'empty',
  icon: Icon,
  title,
  description,
  className,
}: EmptyStateProps) {
  return (
    <SpotlightCard>
      <div
        data-testid="empty-state-card"
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border bg-card p-8 text-center shadow-sm',
          className,
        )}
      >
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
          <Icon className={cn('h-6 w-6', iconTintByVariant[variant])} />
        </div>
        <h3 className="text-sm font-semibold text-foreground/80">{title}</h3>
        {description && (
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </SpotlightCard>
  );
}
