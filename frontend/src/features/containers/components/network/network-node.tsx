import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/shared/lib/utils';

export function NetworkNode({ data }: NodeProps) {
  const label = (data as any).label || 'Unknown';
  const driver = (data as any).driver || '';
  const subnet = (data as any).subnet || '';
  const selected = Boolean((data as any).selected);
  const related = Boolean((data as any).related);
  const usedHandles = (data as any).usedHandles as Array<'top' | 'right' | 'bottom' | 'left'> | undefined;
  const showHandle = (id: 'top' | 'right' | 'bottom' | 'left') =>
    usedHandles === undefined || usedHandles.includes(id);

  return (
    <div className="flex flex-col items-center gap-1">
      {showHandle('top') && <Handle id="top" type="target" position={Position.Top} className="!bg-gray-400" />}
      {showHandle('right') && <Handle id="right" type="target" position={Position.Right} className="!bg-gray-400" />}
      <div
        className={cn(
          'h-12 w-12 rotate-45 border-2 border-blue-500 bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center transition-all duration-200',
          selected && 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-background scale-110',
          !selected && related && 'ring-1 ring-emerald-300/70 ring-offset-1 ring-offset-background',
          !selected && !related && 'opacity-80',
        )}
        title={`${label} (${driver})`}
      >
        <span className="-rotate-45 text-xs font-bold text-blue-700 dark:text-blue-300">
          N
        </span>
      </div>
      <div className="text-xs font-medium max-w-[120px] truncate text-center">
        {label}
      </div>
      {driver && (
        <div className="text-[10px] text-muted-foreground">{driver}</div>
      )}
      {subnet && (
        <div className="text-[10px] text-muted-foreground">{subnet}</div>
      )}
      {showHandle('bottom') && <Handle id="bottom" type="target" position={Position.Bottom} className="!bg-gray-400" />}
      {showHandle('left') && <Handle id="left" type="target" position={Position.Left} className="!bg-gray-400" />}
    </div>
  );
}
