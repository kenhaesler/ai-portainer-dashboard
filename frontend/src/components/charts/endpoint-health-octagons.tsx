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
  good: { bg: 'bg-emerald-500/85', text: 'text-white', border: 'border-emerald-400/30' },
  warning: { bg: 'bg-amber-500/85', text: 'text-white', border: 'border-amber-400/30' },
  critical: { bg: 'bg-red-500/85', text: 'text-white', border: 'border-red-400/30' },
  empty: { bg: 'bg-slate-400/60', text: 'text-white', border: 'border-slate-300/30' },
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

const OCTAGON_CLIP = 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';

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
      {/* Octagonal outer shape */}
      <div
        className={cn(
          'relative w-[110px] h-[110px] m-[5px] transition-transform duration-150',
          'group-hover:scale-105',
        )}
        style={{ clipPath: OCTAGON_CLIP }}
      >
        {/* Background fill */}
        <div className={cn('absolute inset-0', colors.bg, 'backdrop-blur-sm')} />

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
