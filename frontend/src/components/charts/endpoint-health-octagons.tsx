import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
 * Build a flat-top hexagon SVG path with rounded corners.
 * Flat-top: the two flat edges are on top and bottom.
 * `w` = width, `h` = height (for a regular hexagon h = w * sqrt(3)/2).
 * `r` = corner rounding radius.
 */
function hexagonPath(w: number, h: number, r: number): string {
  const cx = w / 2;
  const cy = h / 2;
  // 6 vertices of a flat-top hexagon (clockwise from top-right)
  const pts: [number, number][] = [
    [cx + w / 4, 0],        // top-right
    [w, cy],                 // right
    [cx + w / 4, h],         // bottom-right
    [cx - w / 4, h],         // bottom-left
    [0, cy],                 // left
    [cx - w / 4, 0],         // top-left
  ];

  const segments: string[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [vx, vy] = pts[i];
    const [px, py] = pts[(i - 1 + n) % n];
    const [nx, ny] = pts[(i + 1) % n];

    const dx1 = px - vx, dy1 = py - vy;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const ax = vx + (dx1 / len1) * r;
    const ay = vy + (dy1 / len1) * r;

    const dx2 = nx - vx, dy2 = ny - vy;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const bx = vx + (dx2 / len2) * r;
    const by = vy + (dy2 / len2) * r;

    if (i === 0) {
      segments.push(`M ${ax} ${ay}`);
    } else {
      segments.push(`L ${ax} ${ay}`);
    }
    segments.push(`Q ${vx} ${vy} ${bx} ${by}`);
  }

  // Close path
  const [vx0, vy0] = pts[0];
  const [pxLast, pyLast] = pts[n - 1];
  const dx = pxLast - vx0, dy = pyLast - vy0;
  const len = Math.sqrt(dx * dx + dy * dy);
  segments.push(`L ${vx0 + (dx / len) * r} ${vy0 + (dy / len) * r}`);
  segments.push('Z');

  return segments.join(' ');
}

// Hexagon dimensions — flat-top: width is the wider axis
const HEX_W = 116;
const HEX_H = Math.round(HEX_W * (Math.sqrt(3) / 2)); // ~100
const CORNER_RADIUS = 6;
const SVG_PATH = hexagonPath(HEX_W, HEX_H, CORNER_RADIUS);

// Honeycomb layout constants (flat-top, odd-column-offset)
// Horizontal spacing: 3/4 hex width so angled edges interlock, plus small gap
const COL_STEP = Math.round(HEX_W * 0.78);
// Vertical spacing between rows
const ROW_STEP = HEX_H + 8;
// Odd-column vertical offset: half hex height for honeycomb nesting
const COL_OFFSET_Y = Math.round(HEX_H / 2) + 2;

const itemVariants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: duration.base, ease: [...easing.pop] },
  },
};

interface HexagonCardProps {
  name: string;
  running: number;
  total: number;
  level: HealthLevel;
  onClick: () => void;
  index: number;
}

function HexagonCard({ name, running, total, level, onClick }: HexagonCardProps) {
  const colors = HEALTH_COLORS[level];
  const blurId = `hex-blur-${level}`;

  return (
    <motion.div
      variants={itemVariants}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      role="button"
      tabIndex={0}
      aria-label={`${name} endpoint - ${running}/${total} running`}
      className="octagon-button absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer select-none [-webkit-user-select:none] [-webkit-tap-highlight-color:transparent] hover:!bg-transparent"
      data-testid={`octagon-${name}`}
      style={{
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
        background: 'transparent',
        border: 'none',
      }}
    >
      <div
        className="relative transition-all duration-150 hover:scale-105"
        style={{ width: HEX_W, height: HEX_H }}
      >
        <svg
          width={HEX_W}
          height={HEX_H}
          viewBox={`0 0 ${HEX_W} ${HEX_H}`}
          className="absolute inset-0"
          aria-hidden="true"
        >
          <defs>
            <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
          </defs>

          {/* Shadow layer */}
          <g transform="translate(0, 3)" opacity="0.4" filter={`url(#${blurId})`}>
            <path d={SVG_PATH} fill={colors.shadow} />
          </g>

          {/* Glow layer */}
          <g opacity="0.2" filter={`url(#${blurId})`}>
            <path d={SVG_PATH} fill={colors.shadow} />
          </g>

          {/* Main hexagon */}
          <path
            d={SVG_PATH}
            fill={colors.fill}
            stroke={colors.stroke}
            strokeWidth={1.5}
          />
        </svg>

        {/* Inner content */}
        <div
          className={cn('relative flex flex-col items-center justify-center h-full px-3 [&:hover]:!bg-transparent', colors.text)}
          style={{ background: 'transparent' }}
        >
          <span className="text-[11px] font-semibold leading-tight text-center line-clamp-2 max-w-[80px]">
            {name}
          </span>
          <span className="text-[10px] mt-0.5 opacity-80 font-medium">
            {total > 0 ? `${running}/${total} running` : 'No containers'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Compute honeycomb grid positions (flat-top, odd-column-offset).
 * Items fill left-to-right per row. Odd columns are shifted down by COL_OFFSET_Y
 * so hexagons nest into each other like a beehive / honeymesh.
 * Returns { positions, totalWidth, totalHeight }.
 */
function computeHoneycombLayout(
  count: number,
  containerWidth: number,
): { positions: { x: number; y: number }[]; totalWidth: number; totalHeight: number } {
  if (count === 0 || containerWidth <= 0) {
    return { positions: [], totalWidth: 0, totalHeight: 0 };
  }

  // How many columns fit in the container?
  const maxCols = Math.max(1, Math.floor((containerWidth - HEX_W) / COL_STEP) + 1);

  const positions: { x: number; y: number }[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % maxCols;
    const row = Math.floor(i / maxCols);
    const isOddCol = col % 2 === 1;

    const x = col * COL_STEP;
    const y = row * ROW_STEP + (isOddCol ? COL_OFFSET_Y : 0);

    positions.push({ x, y });
  }

  // Center the whole grid horizontally
  const maxX = positions.length > 0 ? Math.max(...positions.map((p) => p.x)) + HEX_W : 0;
  const offsetX = Math.round((containerWidth - maxX) / 2);
  for (const pos of positions) {
    pos.x += offsetX;
  }

  const maxY = positions.length > 0 ? Math.max(...positions.map((p) => p.y)) + HEX_H : 0;
  return { positions, totalWidth: containerWidth, totalHeight: maxY };
}

export const EndpointHealthOctagons = memo(function EndpointHealthOctagons({
  endpoints,
  isLoading,
}: EndpointHealthOctagonsProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    // Set initial width
    setContainerWidth(el.clientWidth);

    return () => observer.disconnect();
  }, []);

  const items = useMemo(() => {
    return endpoints.map((ep) => ({
      ...ep,
      level: getHealthLevel(ep.running, ep.total),
    }));
  }, [endpoints]);

  const layout = useMemo(
    () => computeHoneycombLayout(items.length, containerWidth),
    [items.length, containerWidth],
  );

  const handleClick = useCallback(() => {
    navigate('/infrastructure');
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
    <div className="flex flex-col">
      {/* Hexagon honeycomb grid */}
      <div ref={containerRef} className="py-2">
        <motion.div
          className="relative w-full"
          style={{ height: layout.totalHeight || 'auto' }}
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
          {items.map((ep, i) => {
            const pos = layout.positions[i];
            if (!pos) return null;
            return (
              <div
                key={ep.id}
                className="absolute"
                style={{ left: pos.x, top: pos.y }}
              >
                <HexagonCard
                  name={ep.name}
                  running={ep.running}
                  total={ep.total}
                  level={ep.level}
                  onClick={handleClick}
                  index={i}
                />
              </div>
            );
          })}
        </motion.div>
      </div>

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
