import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { duration, easing } from '@/lib/motion-tokens';

export interface EndpointHealthOctagonsProps {
  endpoints: Array<{
    id: number;
    name: string;
    running: number;
    stopped: number;
    total: number;
  }>;
  isLoading?: boolean;
}

const HEALTH_COLORS = {
  good: { fill: 'rgba(16,185,129,0.85)', stroke: 'rgba(52,211,153,0.4)', text: 'text-white', shadow: 'rgba(16,185,129,0.35)' },
  warning: { fill: 'rgba(245,158,11,0.85)', stroke: 'rgba(251,191,36,0.4)', text: 'text-white', shadow: 'rgba(245,158,11,0.35)' },
  critical: { fill: 'rgba(239,68,68,0.85)', stroke: 'rgba(248,113,113,0.4)', text: 'text-white', shadow: 'rgba(239,68,68,0.35)' },
  empty: { fill: 'rgba(148,163,184,0.6)', stroke: 'rgba(203,213,225,0.3)', text: 'text-white', shadow: 'rgba(148,163,184,0.2)' },
} as const;

type HealthLevel = keyof typeof HEALTH_COLORS;

function getHealthLevel(running: number, total: number): HealthLevel {
  if (total === 0) return 'empty';
  const ratio = running / total;
  if (ratio > 0.8) return 'good';
  if (ratio >= 0.5) return 'warning';
  return 'critical';
}

/** Exported for testing */
export { getHealthLevel as getHealthLevel_testable };

/**
 * Build an SVG octagon path with rounded corners.
 * The octagon is inscribed in a square of size `s`, with corners cut by `c` pixels.
 * `r` controls the corner rounding radius.
 */
function octagonPath(s: number, c: number, r: number): string {
  // 8 vertices of the octagon (clockwise from top-left cut)
  const pts: [number, number][] = [
    [c, 0],
    [s - c, 0],
    [s, c],
    [s, s - c],
    [s - c, s],
    [c, s],
    [0, s - c],
    [0, c],
  ];

  // Build path with rounded corners using quadratic bezier at each vertex
  const segments: string[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [cx, cy] = pts[i];
    const [px, py] = pts[(i - 1 + n) % n];
    const [nx, ny] = pts[(i + 1) % n];

    // Points along the edges, offset by `r` from the vertex
    const dx1 = px - cx, dy1 = py - cy;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const ax = cx + (dx1 / len1) * r;
    const ay = cy + (dy1 / len1) * r;

    const dx2 = nx - cx, dy2 = ny - cy;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const bx = cx + (dx2 / len2) * r;
    const by = cy + (dy2 / len2) * r;

    if (i === 0) {
      segments.push(`M ${ax} ${ay}`);
    } else {
      segments.push(`L ${ax} ${ay}`);
    }
    segments.push(`Q ${cx} ${cy} ${bx} ${by}`);
  }

  // Close back to the start
  const [cx0, cy0] = pts[0];
  const [pxLast, pyLast] = pts[n - 1];
  const dx = pxLast - cx0, dy = pyLast - cy0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const closePt = `${cx0 + (dx / len) * r} ${cy0 + (dy / len) * r}`;
  segments.push(`L ${closePt}`);
  segments.push('Z');

  return segments.join(' ');
}

const SIZE = 110;
const CUT = 33; // ~30% of size
const CORNER_RADIUS = 8;
const SVG_PATH = octagonPath(SIZE, CUT, CORNER_RADIUS);

const itemVariants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: duration.base, ease: [...easing.pop] },
  },
};

interface OctagonCardProps {
  name: string;
  running: number;
  total: number;
  level: HealthLevel;
  onClick: () => void;
  index: number;
}

function OctagonCard({ name, running, total, level, onClick }: OctagonCardProps) {
  const colors = HEALTH_COLORS[level];
  const pct = total > 0 ? Math.round((running / total) * 100) : 0;

  return (
    <motion.button
      variants={itemVariants}
      onClick={onClick}
      className="group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
      data-testid={`octagon-${name}`}
      title={`${name} — ${running}/${total} running (${pct}%)`}
    >
      <div
        className="relative w-[110px] h-[110px] m-[5px] transition-all duration-150 group-hover:scale-105"
        style={{ filter: `drop-shadow(0 4px 8px ${colors.shadow}) drop-shadow(0 1px 3px ${colors.shadow})` }}
      >
        {/* SVG octagon with rounded corners */}
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0"
          aria-hidden="true"
        >
          <path
            d={SVG_PATH}
            fill={colors.fill}
            stroke={colors.stroke}
            strokeWidth={1.5}
          />
        </svg>

        {/* Inner content */}
        <div className={cn('relative flex flex-col items-center justify-center h-full px-3', colors.text)}>
          <span className="text-[11px] font-semibold leading-tight text-center line-clamp-2 max-w-[80px]">
            {name}
          </span>
          <span className="text-[10px] mt-0.5 opacity-80 font-medium">
            {total > 0 ? `${running}/${total} running` : 'No containers'}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

export const EndpointHealthOctagons = memo(function EndpointHealthOctagons({
  endpoints,
  isLoading,
}: EndpointHealthOctagonsProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const items = useMemo(() => {
    return endpoints.map((ep) => ({
      ...ep,
      level: getHealthLevel(ep.running, ep.total),
    }));
  }, [endpoints]);

  const handleClick = useCallback(() => {
    navigate('/fleet');
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }

  if (!endpoints.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No endpoint data
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Octagon grid */}
      <motion.div
        className="flex flex-wrap justify-center items-start gap-1 flex-1 content-start overflow-y-auto py-2"
        variants={{
          hidden: { opacity: 1 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: reducedMotion ? 0 : 0.04 },
          },
        }}
        initial={reducedMotion ? false : 'hidden'}
        animate="visible"
      >
        {items.map((ep, i) => (
          <OctagonCard
            key={ep.id}
            name={ep.name}
            running={ep.running}
            total={ep.total}
            level={ep.level}
            onClick={handleClick}
            index={i}
          />
        ))}
      </motion.div>

      {/* Legend */}
      <div className="flex justify-center gap-5 pt-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-xs text-muted-foreground">&gt;80% healthy</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-xs text-muted-foreground">50-80%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-xs text-muted-foreground">&lt;50%</span>
        </div>
      </div>
    </div>
  );
});
