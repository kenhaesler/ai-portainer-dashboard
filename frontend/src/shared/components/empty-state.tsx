import { cn } from '@/lib/utils';
import { Inbox, Search, AlertCircle, FileQuestion } from 'lucide-react';

type EmptyStateVariant = 'default' | 'search' | 'error' | 'no-data';

const variantIcons = {
  default: Inbox,
  search: Search,
  error: AlertCircle,
  'no-data': FileQuestion,
};

const variantColors = {
  default: 'text-muted-foreground',
  search: 'text-blue-500',
  error: 'text-destructive',
  'no-data': 'text-amber-500',
};

interface EmptyStateProps {
  title: string;
  description?: string;
  variant?: EmptyStateVariant;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  variant = 'default',
  icon,
  action,
  className,
}: EmptyStateProps) {
  const Icon = variantIcons[variant];
  const iconColor = variantColors[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-12 text-center',
        className
      )}
    >
      <div
        className={cn(
          'flex h-16 w-16 items-center justify-center rounded-full bg-muted/50',
          iconColor
        )}
      >
        {icon || <Icon className="h-8 w-8" />}
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
