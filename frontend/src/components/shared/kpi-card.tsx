import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { KpiSparkline } from '@/components/charts/kpi-sparkline';
import { useUiStore } from '@/stores/ui-store';
import { SpotlightCard } from '@/components/shared/spotlight-card';
import { spring, duration } from '@/lib/motion-tokens';

interface KpiCardProps {
  label: string;
  value: number | string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
  /** Sparkline data points (e.g., last 24h of this KPI value) */
  sparklineData?: number[];
  /** CSS color for the sparkline */
  sparklineColor?: string;
  /** Detail stats shown on hover: e.g., "Last hour: +3 | Peak: 52 | Avg: 45" */
  hoverDetail?: string;
}

export function KpiCard({
  label,
  value,
  trend,
  trendValue,
  icon,
  className,
  sparklineData,
  sparklineColor,
  hoverDetail,
}: KpiCardProps) {
  const reducedMotion = useReducedMotion();
  const potatoMode = useUiStore((state) => state.potatoMode);
  const numericValue = typeof value === 'number' ? value : 0;
  const isNumeric = typeof value === 'number';
  const displayValue = useCountUp(numericValue, { enabled: isNumeric });

  // Track value changes for pulse effect
  const prevValue = useRef(numericValue);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prevValue.current !== numericValue && prevValue.current !== 0) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 300);
      prevValue.current = numericValue;
      return () => clearTimeout(timer);
    }
    prevValue.current = numericValue;
  }, [numericValue]);

  // Hover state for detail expansion
  const [hovered, setHovered] = useState(false);

  return (
    <SpotlightCard>
      <div
        className={cn(
          'rounded-lg border bg-card p-6 shadow-sm transition-all duration-200',
          !potatoMode && 'hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20',
          className,
        )}
        onMouseEnter={() => !potatoMode && setHovered(true)}
        onMouseLeave={() => !potatoMode && setHovered(false)}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className="flex items-center gap-2">
            {sparklineData && sparklineData.length >= 2 && (
              <KpiSparkline values={sparklineData} color={sparklineColor} />
            )}
            {icon && <div className="text-muted-foreground">{icon}</div>}
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <motion.p
            className="text-3xl font-bold tracking-tight"
            animate={
              pulse && !reducedMotion
                ? { scale: [1, 1.05, 1] }
                : { scale: 1 }
            }
            transition={{ duration: duration.base, ease: 'easeOut' }}
          >
            {isNumeric ? displayValue : value}
          </motion.p>
          {trend && (
            <motion.span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                trend === 'up' && 'text-emerald-600 dark:text-emerald-400',
                trend === 'down' && 'text-red-600 dark:text-red-400',
                trend === 'neutral' && 'text-muted-foreground',
              )}
              initial={reducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, ...spring.bouncy }}
            >
              {trend === 'up' && <TrendingUp className="h-3 w-3" />}
              {trend === 'down' && <TrendingDown className="h-3 w-3" />}
              {trend === 'neutral' && <Minus className="h-3 w-3" />}
              {trendValue}
            </motion.span>
          )}
        </div>

        {/* Hover detail expansion */}
        {hoverDetail && !potatoMode && (
          <div
            className={cn(
              'overflow-hidden transition-all duration-200',
              hovered ? 'mt-2 max-h-8 opacity-100' : 'max-h-0 opacity-0',
            )}
          >
            <p className="text-xs text-muted-foreground">{hoverDetail}</p>
          </div>
        )}
      </div>
    </SpotlightCard>
  );
}
