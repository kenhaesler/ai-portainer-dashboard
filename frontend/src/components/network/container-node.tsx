import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

const stateColors: Record<string, string> = {
  running: 'bg-emerald-500 border-emerald-600',
  stopped: 'bg-red-500 border-red-600',
  paused: 'bg-amber-500 border-amber-600',
  unknown: 'bg-gray-500 border-gray-600',
};

export function ContainerNode({ data }: NodeProps) {
  const state = (data as any).state || 'unknown';
  const label = (data as any).label || 'Unknown';
  const image = (data as any).image || '';
  const selected = Boolean((data as any).selected);
  const related = Boolean((data as any).related);

  return (
    <div className="flex flex-col items-center gap-1">
      <Handle id="top" type="source" position={Position.Top} className="!bg-gray-400" />
      <Handle id="right" type="source" position={Position.Right} className="!bg-gray-400" />
      <div
        className={cn(
          'h-10 w-10 rounded-full border-2 flex items-center justify-center text-white text-xs font-bold transition-all duration-200',
          selected && 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-background scale-110',
          !selected && related && 'ring-1 ring-emerald-300/70 ring-offset-1 ring-offset-background',
          !selected && !related && 'opacity-80',
          stateColors[state] || stateColors.unknown
        )}
        title={`${label} (${state})`}
      >
        {label.charAt(0).toUpperCase()}
      </div>
      <div className="text-xs font-medium max-w-[100px] truncate text-center">
        {label}
      </div>
      <div className="text-[10px] text-muted-foreground max-w-[100px] truncate">
        {image}
      </div>
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-gray-400" />
      <Handle id="left" type="source" position={Position.Left} className="!bg-gray-400" />
    </div>
  );
}
