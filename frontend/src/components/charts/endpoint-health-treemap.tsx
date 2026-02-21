import { memo, useCallback, useMemo } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { useNavigate } from 'react-router-dom';

export interface EndpointHealthTreemapProps {
  endpoints: Array<{
    id: number;
    name: string;
    running: number;
    stopped: number;
    total: number;
  }>;
  isLoading?: boolean;
}

interface TreemapEntry {
  name: string;
  size: number;
  id: number;
  running: number;
  stopped: number;
  total: number;
  healthRatio: number;
  fill: string;
}

const HEALTH_COLORS = {
  good: '#22c55e',    // green-500
  warning: '#f59e0b', // amber-500
  critical: '#ef4444', // red-500
  empty: '#94a3b8', // slate-400
} as const;

function getHealthColor(ratio: number): string {
  if (ratio > 0.8) return HEALTH_COLORS.good;
  if (ratio >= 0.5) return HEALTH_COLORS.warning;
  return HEALTH_COLORS.critical;
}

export function getHealthColor_testable(ratio: number): string {
  return getHealthColor(ratio);
}

function CustomContent(props: any) {
  const { x, y, width, height, name, fill, running, total } = props;

  if (!width || !height || width < 2 || height < 2 || !name) return null;

  const safeFill = fill || HEALTH_COLORS.good;
  const textFill = getLuminance(safeFill) > 0.45 ? '#0f172a' : '#ffffff';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={safeFill}
        fillOpacity={0.85}
        stroke="hsl(var(--border))"
        strokeWidth={1}
        rx={3}
        style={{ cursor: 'pointer' }}
        data-testid={`treemap-cell-${name}`}
      />
      {width > 50 && height > 24 && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (height > 40 ? 8 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fill={textFill}
          fontSize={Math.min(12, width / 8)}
          fontWeight={500}
          style={{ pointerEvents: 'none' }}
        >
          {name.length > Math.floor(width / 7)
            ? name.slice(0, Math.floor(width / 7)) + '\u2026'
            : name}
        </text>
      )}
      {width > 50 && height > 40 && running !== undefined && total !== undefined && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          fill={textFill}
          fontSize={10}
          opacity={0.8}
          style={{ pointerEvents: 'none' }}
        >
          {running}/{total} running
        </text>
      )}
    </g>
  );
}

function getLuminance(hex: string): number {
  if (!hex) return 0.5;
  const c = hex.replace('#', '');
  if (c.length !== 6) return 0.5;
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const { name, running, stopped, total, healthRatio } = payload[0].payload as TreemapEntry;
  const pct = Math.round(healthRatio * 100);
  const hasTotals = total > 0;

  return (
    <div className="rounded-xl bg-popover/95 backdrop-blur-sm border border-border px-3 py-2 shadow-lg">
      <p className="text-xs font-medium mb-1.5 text-foreground">{name}</p>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Running</span>
          <span className="font-medium text-emerald-500">{running}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Stopped</span>
          <span className="font-medium text-red-500">{stopped}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium">{total}</span>
        </div>
        <div className="mt-1 pt-1 border-t border-border flex justify-between gap-4">
          <span className="text-muted-foreground">Health</span>
          <span className="font-medium">{hasTotals ? `${pct}%` : 'N/A'}</span>
        </div>
        {!hasTotals && (
          <div className="pt-1 text-[11px] text-muted-foreground">
            No containers reported
          </div>
        )}
      </div>
    </div>
  );
}

export const EndpointHealthTreemap = memo(function EndpointHealthTreemap({
  endpoints,
  isLoading,
}: EndpointHealthTreemapProps) {
  const navigate = useNavigate();

  const treemapData = useMemo(() => {
    return endpoints
      .map((ep): TreemapEntry => {
        const hasTotals = ep.total > 0;
        const healthRatio = hasTotals ? ep.running / ep.total : 0;
        return {
          name: ep.name,
          size: Math.max(ep.total, 1),
          id: ep.id,
          running: ep.running,
          stopped: ep.stopped,
          total: ep.total,
          healthRatio,
          fill: hasTotals ? getHealthColor(healthRatio) : HEALTH_COLORS.empty,
        };
      });
  }, [endpoints]);

  const handleClick = useCallback(
    (entry: any) => {
      if (entry?.id) {
        navigate(`/infrastructure`);
      }
    },
    [navigate],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }

  if (!endpoints.length || !treemapData.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No endpoint data
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="hsl(var(--border))"
            content={<CustomContent />}
            onClick={handleClick}
            isAnimationActive={
              typeof window.matchMedia === 'function'
                ? !window.matchMedia('(prefers-reduced-motion: reduce)').matches
                : true
            }
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-5 pt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: HEALTH_COLORS.good }} />
          <span className="text-xs text-muted-foreground">&gt;80% healthy</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: HEALTH_COLORS.warning }} />
          <span className="text-xs text-muted-foreground">50-80%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: HEALTH_COLORS.critical }} />
          <span className="text-xs text-muted-foreground">&lt;50%</span>
        </div>
      </div>
    </div>
  );
});
