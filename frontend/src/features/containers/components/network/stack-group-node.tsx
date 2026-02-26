import type { NodeProps } from '@xyflow/react';

export function StackGroupNode({ data }: NodeProps) {
  const label = (data as Record<string, unknown>).label as string || 'Unknown';

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm p-2 h-full w-full">
      <div className="text-xs font-semibold text-muted-foreground px-1 pb-1">
        {label}
      </div>
    </div>
  );
}
