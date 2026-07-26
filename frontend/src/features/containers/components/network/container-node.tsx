import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { shouldShowHandle, type HandleDirection } from './handle-visibility';

const stateColors: Record<string, string> = {
  running: 'bg-emerald-500 border-emerald-600',
  stopped: 'bg-red-500 border-red-600',
  paused: 'bg-amber-500 border-amber-600',
  unknown: 'bg-gray-500 border-gray-600',
};

/**
 * Drop the compose project's own name from a child node's label.
 *
 * Inside a stack group box titled `container-insights`, every child is called
 * `container-insights-<something>`. The label had `max-w-[100px] truncate`,
 * which fits ~14 characters at `text-xs` — and the prefix alone is 19 — so six
 * different containers all rendered as `container-insig…` and the operator
 * could not tell backend from frontend from redis. The group box already shows
 * the project name, so repeating it in every child is pure noise.
 *
 * Only a real prefix followed by a separator is stripped, and never the whole
 * label: a container named exactly after its project keeps its name.
 */
export function stripGroupPrefix(label: string, groupLabel?: string): string {
  if (!groupLabel || groupLabel === label) return label;
  for (const separator of ['-', '_']) {
    const prefix = `${groupLabel}${separator}`;
    if (label.startsWith(prefix) && label.length > prefix.length) {
      return label.slice(prefix.length);
    }
  }
  return label;
}

export function ContainerNode({ data }: NodeProps) {
  const state = (data as any).state || 'unknown';
  const label = (data as any).label || 'Unknown';
  const image = (data as any).image || '';
  const groupLabel = (data as any).groupLabel as string | undefined;
  const selected = Boolean((data as any).selected);
  const related = Boolean((data as any).related);
  const usedHandles = (data as any).usedHandles as HandleDirection[] | undefined;

  const displayLabel = stripGroupPrefix(label, groupLabel);
  // The full name and the image go on the hover title. The image line used to
  // occupy its own row and truncated as badly as the name did.
  const title = image ? `${label} (${state}) — ${image}` : `${label} (${state})`;

  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      {shouldShowHandle(usedHandles, 'top') && <Handle id="top" type="source" position={Position.Top} className="!bg-gray-400" />}
      {shouldShowHandle(usedHandles, 'right') && <Handle id="right" type="source" position={Position.Right} className="!bg-gray-400" />}
      <div
        className={cn(
          'h-10 w-10 rounded-full border-2 flex items-center justify-center text-white transition-all duration-200',
          // Selection chrome is a neutral ring, not a status hue — cyan on a
          // green/red/amber state swatch read as a sixth state.
          selected && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background scale-110',
          !selected && related && 'ring-1 ring-foreground/40 ring-offset-1 ring-offset-background',
          !selected && !related && 'opacity-80',
          stateColors[state] || stateColors.unknown
        )}
        aria-hidden="true"
      >
        {/*
          This used to be `label.charAt(0).toUpperCase()` — the first letter of
          the container name, which inside a compose project is constant by
          construction: six green circles all reading "C". It looked like a type
          code and encoded nothing. The circle is the state swatch; the glyph
          says "container", which is what actually distinguishes it from the
          diamond network nodes.
        */}
        <Box className="h-4 w-4" />
      </div>
      <div className="text-xs font-medium max-w-[160px] truncate text-center">
        {displayLabel}
      </div>
      {shouldShowHandle(usedHandles, 'bottom') && <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-gray-400" />}
      {shouldShowHandle(usedHandles, 'left') && <Handle id="left" type="source" position={Position.Left} className="!bg-gray-400" />}
    </div>
  );
}
